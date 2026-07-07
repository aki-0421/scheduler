use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use scheduler_core::db::SchedulerDb;
use scheduler_core::ipc::*;
use scheduler_core::model::*;
use scheduler_core::schedule::{
    compute_next_run_at, decide_overlap, retry_decision, select_missed_runs, MissedRunCursor,
    MissedRunOptions, OverlapDecision,
};
use scheduler_core::time::{format_utc_rfc3339, now_rfc3339, parse_utc_rfc3339};
use scheduler_core::util::sha256_hex;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{broadcast, Mutex, Notify};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, warn};

use crate::config::DaemonConfig;
use crate::executor::{
    ExecutionRequest, ExecutionResult, ExecutionStatus, FailureKind, RunExecutor,
};
use crate::rpc::parse_params;

const CAP_SCHEDULE_CREATE: &str = "schedule:create";
const CAP_SCHEDULE_UPDATE_CURRENT: &str = "schedule:update-current";
const CAP_SCHEDULE_UPDATE_ANY: &str = "schedule:update-any";
const CAP_SCHEDULE_PAUSE_CURRENT: &str = "schedule:pause-current";
const CAP_SCHEDULE_RUN_NOW: &str = "schedule:run-now";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonEvent {
    pub event_type: String,
    pub task_id: Option<String>,
    pub run_id: Option<String>,
    pub payload: Value,
}

#[derive(Debug)]
struct ActiveRun {
    task_id: String,
    cancel: CancellationToken,
}

#[derive(Debug, Clone, Default)]
struct RpcMetadata {
    token: Option<String>,
    current_task_id: Option<String>,
    current_run_id: Option<String>,
    reason: Option<String>,
}

impl RpcMetadata {
    fn from_value(value: Option<&Value>) -> Self {
        let Some(Value::Object(object)) = value else {
            return Self::default();
        };
        Self {
            token: string_field(object, "token"),
            current_task_id: string_field(object, "currentTaskId"),
            current_run_id: string_field(object, "currentRunId"),
            reason: string_field(object, "reason"),
        }
    }
}

pub(crate) struct DaemonState {
    config: DaemonConfig,
    db: SchedulerDb,
    executor: Arc<dyn RunExecutor>,
    notify_tick: Notify,
    shutdown: CancellationToken,
    accepting_runs: AtomicBool,
    active_runs: Mutex<HashMap<String, ActiveRun>>,
    events_tx: broadcast::Sender<DaemonEvent>,
}

pub struct DaemonHandle {
    state: Arc<DaemonState>,
    joins: Vec<JoinHandle<()>>,
}

impl DaemonHandle {
    pub fn db(&self) -> SchedulerDb {
        self.state.db.clone()
    }

    pub fn socket_path(&self) -> PathBuf {
        self.state.config.paths.socket_path.clone()
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<DaemonEvent> {
        self.state.events_tx.subscribe()
    }

    pub fn request_tick(&self) {
        self.state.notify_tick.notify_waiters();
    }

    pub async fn shutdown(self) {
        graceful_shutdown(&self.state).await;
        for join in self.joins {
            let _ = join.await;
        }
        let _ = std::fs::remove_file(&self.state.config.paths.socket_path);
    }
}

pub async fn start_daemon(
    config: DaemonConfig,
    executor: Arc<dyn RunExecutor>,
) -> anyhow::Result<DaemonHandle> {
    config.paths.ensure_dirs()?;
    let db = SchedulerDb::connect(&config.paths.db_path).await?;
    recover_interrupted_runs(&db).await?;

    if config.paths.socket_path.exists() {
        let _ = std::fs::remove_file(&config.paths.socket_path);
    }
    let listener = UnixListener::bind(&config.paths.socket_path)?;
    set_private_file_permissions(&config.paths.socket_path)?;

    let (events_tx, _) = broadcast::channel(256);
    let state = Arc::new(DaemonState {
        config,
        db,
        executor,
        notify_tick: Notify::new(),
        shutdown: CancellationToken::new(),
        accepting_runs: AtomicBool::new(true),
        active_runs: Mutex::new(HashMap::new()),
        events_tx,
    });

    let scheduler_state = state.clone();
    let rpc_state = state.clone();
    let joins = vec![
        tokio::spawn(async move { scheduler_loop(scheduler_state).await }),
        tokio::spawn(async move { rpc_server_loop(rpc_state, listener).await }),
    ];

    state.notify_tick.notify_waiters();
    Ok(DaemonHandle { state, joins })
}

async fn scheduler_loop(state: Arc<DaemonState>) {
    if let Err(err) = perform_tick(&state).await {
        error!(error = %err, "scheduler tick failed");
    }

    loop {
        let delay = next_tick_delay(state.config.tick_interval);
        tokio::select! {
            () = state.shutdown.cancelled() => break,
            () = state.notify_tick.notified() => {}
            () = tokio::time::sleep(delay) => {}
        }

        if state.shutdown.is_cancelled() {
            break;
        }

        if let Err(err) = perform_tick(&state).await {
            error!(error = %err, "scheduler tick failed");
        }
    }
}

fn next_tick_delay(interval: Duration) -> Duration {
    if interval == Duration::from_secs(60) {
        let now = Utc::now();
        let second = now.timestamp() % 60;
        let nanos = now.timestamp_subsec_nanos();
        let mut remaining = 60 - second as u64;
        if second == 0 && nanos == 0 {
            remaining = 60;
        }
        return Duration::from_secs(remaining.max(1));
    }
    interval.max(Duration::from_millis(1))
}

async fn perform_tick(state: &Arc<DaemonState>) -> anyhow::Result<()> {
    if !scheduler_enabled(&state.db).await? {
        return Ok(());
    }
    enqueue_due_tasks(state).await?;
    start_available_runs(state).await?;
    Ok(())
}

async fn scheduler_enabled(db: &SchedulerDb) -> scheduler_core::Result<bool> {
    Ok(db
        .get_setting::<bool>("scheduler.enabled")
        .await?
        .unwrap_or(true))
}

async fn enqueue_due_tasks(state: &Arc<DaemonState>) -> anyhow::Result<()> {
    let now = Utc::now();
    let grace = chrono::Duration::from_std(state.config.due_grace)?;
    let due_until = now + grace;
    let due_until_rfc3339 = format_utc_rfc3339(due_until);
    let tasks = state.db.find_active_tasks_due(&due_until_rfc3339).await?;

    for task in tasks {
        if let Err(err) = process_due_task(state, task, now, due_until).await {
            warn!(error = %err, "failed to process due task");
        }
    }

    Ok(())
}

async fn process_due_task(
    state: &Arc<DaemonState>,
    mut task: Task,
    now: DateTime<Utc>,
    due_until: DateTime<Utc>,
) -> anyhow::Result<()> {
    match task.kind {
        TaskKind::Manual => Ok(()),
        TaskKind::Once => {
            let scheduled_for = task
                .next_run_at
                .as_deref()
                .or(task.run_at.as_deref())
                .ok_or_else(|| anyhow::anyhow!("once task missing run_at"))?;
            let run = new_run_for_task(
                &task,
                TriggerType::Schedule,
                Some(scheduled_for.to_owned()),
                1,
                now_rfc3339(),
                RunStatus::Queued,
                None,
            )?;
            let _ = state.db.create_run_idempotent(&run).await?;
            task.status = TaskStatus::Completed;
            task.last_scheduled_for = Some(scheduled_for.to_owned());
            task.next_run_at = None;
            task.updated_at = now_rfc3339();
            state.db.update_task(&task).await?;
            Ok(())
        }
        TaskKind::Cron => process_due_cron_task(state, task, now, due_until).await,
    }
}

async fn process_due_cron_task(
    state: &Arc<DaemonState>,
    mut task: Task,
    now: DateTime<Utc>,
    due_until: DateTime<Utc>,
) -> anyhow::Result<()> {
    let Some(previous_next_run_at) = task.next_run_at.as_deref() else {
        return recompute_task_schedule(state, &mut task, now).await;
    };
    let previous_next = parse_utc_rfc3339(previous_next_run_at)?;
    let grace = chrono::Duration::from_std(state.config.due_grace)?;
    let current_due_cutoff = now - grace;

    let mut enqueued_or_skipped = Vec::new();
    let next_run_at = if previous_next >= current_due_cutoff {
        enqueue_scheduled_run(state, &task, previous_next, TriggerType::Schedule).await?;
        enqueued_or_skipped.push(previous_next);
        compute_next_run_at(&task, previous_next)?
    } else {
        let selection = match select_missed_runs(
            &task,
            Some(MissedRunCursor::PreviousNextRunAt(previous_next)),
            now,
            MissedRunOptions {
                max_catchup_runs: state.config.max_catchup_runs,
            },
        ) {
            Ok(selection) => selection,
            Err(err) => {
                mark_schedule_invalid(state, &mut task, err.to_string()).await?;
                return Ok(());
            }
        };

        for skipped in &selection.skipped {
            create_task_audit(
                &state.db,
                Some(&task.id),
                RpcActor {
                    actor_type: AuditActorType::Daemon,
                    actor_id: None,
                },
                "run.skipped",
                None,
                Some(json!({ "scheduledFor": format_utc_rfc3339(*skipped) })),
                Some("missed_occurrence_skipped"),
            )
            .await?;
            enqueued_or_skipped.push(*skipped);
        }

        for occurrence in &selection.enqueue {
            enqueue_scheduled_run(state, &task, *occurrence, TriggerType::Catchup).await?;
            enqueued_or_skipped.push(*occurrence);
        }

        selection.next_run_at
    };

    task.next_run_at = next_run_at.map(format_utc_rfc3339);
    task.last_scheduled_for = enqueued_or_skipped
        .iter()
        .max()
        .copied()
        .map(format_utc_rfc3339);
    task.schedule_status = ScheduleStatus::Valid;
    task.schedule_error = None;
    task.updated_at = now_rfc3339();
    state.db.update_task(&task).await?;

    if due_until < now {
        debug!("unreachable due_until before now");
    }

    Ok(())
}

async fn recompute_task_schedule(
    state: &Arc<DaemonState>,
    task: &mut Task,
    now: DateTime<Utc>,
) -> anyhow::Result<()> {
    match compute_next_run_at(task, now) {
        Ok(next_run_at) => {
            task.next_run_at = next_run_at.map(format_utc_rfc3339);
            task.schedule_status = ScheduleStatus::Valid;
            task.schedule_error = None;
            task.updated_at = now_rfc3339();
            state.db.update_task(task).await?;
        }
        Err(err) => {
            mark_schedule_invalid(state, task, err.to_string()).await?;
        }
    }
    Ok(())
}

async fn mark_schedule_invalid(
    state: &Arc<DaemonState>,
    task: &mut Task,
    error_message: String,
) -> anyhow::Result<()> {
    task.schedule_status = ScheduleStatus::Invalid;
    task.schedule_error = Some(error_message.clone());
    task.updated_at = now_rfc3339();
    state.db.update_task(task).await?;
    publish_event(
        state,
        "task.schedule_invalid",
        Some(task.id.clone()),
        None,
        json!({ "error": error_message }),
    );
    Ok(())
}

async fn enqueue_scheduled_run(
    state: &Arc<DaemonState>,
    task: &Task,
    scheduled_for: DateTime<Utc>,
    trigger_type: TriggerType,
) -> anyhow::Result<()> {
    let run = new_run_for_task(
        task,
        trigger_type,
        Some(format_utc_rfc3339(scheduled_for)),
        1,
        now_rfc3339(),
        RunStatus::Queued,
        None,
    )?;
    let _ = state.db.create_run_idempotent(&run).await?;
    Ok(())
}

#[derive(Debug, Clone, Copy)]
struct ConcurrencyLimits {
    global: i64,
    per_project: i64,
    per_task: i64,
}

async fn load_concurrency_limits(db: &SchedulerDb) -> scheduler_core::Result<ConcurrencyLimits> {
    Ok(ConcurrencyLimits {
        global: db
            .get_setting::<i64>("daemon.global_concurrency")
            .await?
            .unwrap_or(2)
            .max(1),
        per_project: db
            .get_setting::<i64>("daemon.per_project_concurrency")
            .await?
            .unwrap_or(1)
            .max(1),
        per_task: db
            .get_setting::<i64>("daemon.per_task_concurrency")
            .await?
            .unwrap_or(1)
            .max(1),
    })
}

async fn start_available_runs(state: &Arc<DaemonState>) -> anyhow::Result<()> {
    if !state.accepting_runs.load(Ordering::SeqCst) {
        return Ok(());
    }

    let limits = load_concurrency_limits(&state.db).await?;
    let now = now_rfc3339();
    let queued = list_startable_queued_runs(&state.db, &now).await?;

    for run in queued {
        if !state.accepting_runs.load(Ordering::SeqCst) {
            break;
        }

        let Some(task) = state.db.get_task(&run.task_id).await? else {
            let run_id = run.id.clone();
            mark_run_terminal(
                &state.db,
                run,
                RunStatus::Failed,
                Some("task_not_found"),
                None,
                None,
            )
            .await?;
            create_run_event(
                &state.db,
                &run_id,
                "error",
                "run.setup_failed",
                Some("task_not_found".to_owned()),
                None,
            )
            .await?;
            continue;
        };

        let same_task_running =
            count_running_for_task(&state.db, &task.id, Some(&run.id)).await? > 0;
        if same_task_running {
            match decide_overlap(task.overlap_policy, true) {
                OverlapDecision::Skip { reason } => {
                    let mut skipped = run;
                    skipped.status = RunStatus::Skipped;
                    skipped.status_reason = Some(reason.as_str().to_owned());
                    skipped.ended_at = Some(now_rfc3339());
                    skipped.updated_at = now_rfc3339();
                    state.db.update_run(&skipped).await?;
                    create_run_event(
                        &state.db,
                        &skipped.id,
                        "warn",
                        "run.skipped",
                        Some(reason.as_str().to_owned()),
                        None,
                    )
                    .await?;
                    continue;
                }
                OverlapDecision::Queue => continue,
                OverlapDecision::CancelPrevious => {
                    cancel_active_runs_for_task(state, &task.id).await;
                }
                OverlapDecision::Start => {}
            }
        }

        if count_running(&state.db).await? >= limits.global {
            break;
        }
        if count_running_for_task(&state.db, &task.id, Some(&run.id)).await? >= limits.per_task {
            continue;
        }
        if count_running_for_project_key(&state.db, &task).await? >= limits.per_project {
            continue;
        }

        start_one_run(state, run, task).await?;
    }

    Ok(())
}

#[derive(Debug, Clone)]
struct IssuedRunToken {
    plaintext: String,
    capabilities: Vec<String>,
}

async fn issue_run_token(
    db: &SchedulerDb,
    run: &Run,
    task: &Task,
) -> scheduler_core::Result<Option<IssuedRunToken>> {
    if !task.allow_schedule_cli {
        return Ok(None);
    }

    let capabilities =
        serde_json::from_str::<Vec<String>>(&task.schedule_cli_capabilities).unwrap_or_default();
    if capabilities.is_empty() {
        return Ok(None);
    }

    let plaintext = new_schedule_capability_token_id();
    let now = Utc::now();
    let expires_at = now + ChronoDuration::seconds(task.max_runtime_sec.max(0) + 3600);
    let token = ScheduleCapabilityToken {
        id: new_schedule_capability_token_id(),
        run_id: run.id.clone(),
        task_id: task.id.clone(),
        token_hash: sha256_hex(plaintext.as_bytes()),
        capabilities_json: serde_json::to_string(&capabilities)?,
        expires_at: format_utc_rfc3339(expires_at),
        max_creates: 5,
        create_count: 0,
        revoked_at: None,
        created_at: format_utc_rfc3339(now),
    };
    db.create_schedule_capability_token(&token).await?;

    Ok(Some(IssuedRunToken {
        plaintext,
        capabilities,
    }))
}

async fn expire_run_tokens(
    db: &SchedulerDb,
    run_id: &str,
    expires_at: DateTime<Utc>,
) -> scheduler_core::Result<()> {
    sqlx::query("UPDATE schedule_capability_tokens SET expires_at = ? WHERE run_id = ?")
        .bind(format_utc_rfc3339(expires_at))
        .bind(run_id)
        .execute(db.pool())
        .await?;
    Ok(())
}

async fn revoke_run_tokens(
    db: &SchedulerDb,
    run_id: &str,
    revoked_at: &str,
) -> scheduler_core::Result<()> {
    sqlx::query(
        "UPDATE schedule_capability_tokens
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE run_id = ?",
    )
    .bind(revoked_at)
    .bind(run_id)
    .execute(db.pool())
    .await?;
    Ok(())
}

async fn start_one_run(state: &Arc<DaemonState>, mut run: Run, task: Task) -> anyhow::Result<()> {
    let run_dir = state.config.paths.logs_dir.join(&run.id);
    tokio::fs::create_dir_all(&run_dir).await?;
    let stdout_log_path = run_dir.join("stdout.log");
    let stderr_log_path = run_dir.join("stderr.log");
    let events_jsonl_path = run_dir.join("events.jsonl");
    let last_message_path = run_dir.join("last-message.md");

    run.status = RunStatus::Starting;
    run.stdout_log_path = Some(path_to_string(&stdout_log_path));
    run.stderr_log_path = Some(path_to_string(&stderr_log_path));
    run.events_jsonl_path = Some(path_to_string(&events_jsonl_path));
    run.last_message_path = Some(path_to_string(&last_message_path));
    run.updated_at = now_rfc3339();
    state.db.update_run(&run).await?;

    run.status = RunStatus::Running;
    run.started_at = Some(now_rfc3339());
    run.updated_at = now_rfc3339();
    state.db.update_run(&run).await?;

    if let Err(err) = create_run_event(
        &state.db,
        &run.id,
        "info",
        "run.started",
        Some("run started".to_owned()),
        None,
    )
    .await
    {
        mark_run_setup_failure(&state.db, &run.id, err.to_string()).await?;
        return Err(err.into());
    }
    publish_event(
        state,
        "run.started",
        Some(task.id.clone()),
        Some(run.id.clone()),
        json!({}),
    );

    let cancel = state.shutdown.child_token();
    state.active_runs.lock().await.insert(
        run.id.clone(),
        ActiveRun {
            task_id: task.id.clone(),
            cancel: cancel.clone(),
        },
    );

    let token = match issue_run_token(&state.db, &run, &task).await {
        Ok(token) => token,
        Err(err) => {
            state.active_runs.lock().await.remove(&run.id);
            mark_run_setup_failure(&state.db, &run.id, err.to_string()).await?;
            return Err(err.into());
        }
    };
    let request = ExecutionRequest {
        run: run.clone(),
        task: task.clone(),
        stdout_log_path,
        stderr_log_path,
        events_jsonl_path,
        schedule_token: token.as_ref().map(|token| token.plaintext.clone()),
        schedule_capabilities: token
            .as_ref()
            .map(|token| token.capabilities.clone())
            .unwrap_or_default(),
    };

    let state_for_task = state.clone();
    tokio::spawn(async move {
        let result = state_for_task.executor.execute(request, cancel).await;
        if let Err(err) = finish_run(&state_for_task, run.id.clone(), task, result).await {
            error!(run_id = %run.id, error = %err, "failed to finish run");
        }
    });

    Ok(())
}

async fn finish_run(
    state: &Arc<DaemonState>,
    run_id: String,
    task: Task,
    result: ExecutionResult,
) -> anyhow::Result<()> {
    state.active_runs.lock().await.remove(&run_id);
    let Some(mut run) = state.db.get_run(&run_id).await? else {
        return Ok(());
    };
    if is_terminal(run.status) {
        return Ok(());
    }

    let ended_at = Utc::now();
    run.status = match result.status {
        ExecutionStatus::Succeeded => RunStatus::Succeeded,
        ExecutionStatus::Failed => RunStatus::Failed,
        ExecutionStatus::TimedOut => RunStatus::TimedOut,
        ExecutionStatus::Canceled => RunStatus::Canceled,
    };
    run.status_reason = match result.status {
        ExecutionStatus::Canceled => Some("canceled".to_owned()),
        ExecutionStatus::TimedOut => Some("max_runtime_exceeded".to_owned()),
        ExecutionStatus::Failed => Some("executor_failed".to_owned()),
        ExecutionStatus::Succeeded => None,
    };
    run.ended_at = Some(format_utc_rfc3339(ended_at));
    run.duration_ms = run
        .started_at
        .as_deref()
        .and_then(|started| parse_utc_rfc3339(started).ok())
        .map(|started| (ended_at - started).num_milliseconds().max(0));
    run.exit_code = result.exit_code;
    run.signal = result.signal;
    run.stdout_tail = result.stdout_tail;
    run.stderr_tail = result.stderr_tail;
    run.result_summary = result.result_summary;
    run.updated_at = now_rfc3339();
    state.db.update_run(&run).await?;
    if run.status == RunStatus::Canceled {
        revoke_run_tokens(&state.db, &run.id, &format_utc_rfc3339(ended_at)).await?;
    } else {
        expire_run_tokens(&state.db, &run.id, ended_at + ChronoDuration::hours(1)).await?;
    }

    let event_type = match run.status {
        RunStatus::Succeeded => "run.succeeded",
        RunStatus::Failed => "run.failed",
        RunStatus::TimedOut => "run.timed_out",
        RunStatus::Canceled => "run.canceled",
        _ => "run.finished",
    };
    create_run_event(
        &state.db,
        &run.id,
        if run.status == RunStatus::Succeeded {
            "info"
        } else {
            "warn"
        },
        event_type,
        run.status_reason.clone(),
        None,
    )
    .await?;
    publish_event(
        state,
        event_type,
        Some(task.id.clone()),
        Some(run.id.clone()),
        json!({ "status": run.status.as_str() }),
    );

    if matches!(run.status, RunStatus::Failed | RunStatus::TimedOut)
        && result.failure_kind != Some(FailureKind::Permanent)
    {
        schedule_retry_if_needed(state, &task, &run, ended_at).await?;
    }

    state.notify_tick.notify_waiters();
    Ok(())
}

async fn schedule_retry_if_needed(
    state: &Arc<DaemonState>,
    task: &Task,
    run: &Run,
    failed_at: DateTime<Utc>,
) -> anyhow::Result<()> {
    let decision = retry_decision(
        task.max_retries,
        task.retry_backoff_sec,
        run.attempt,
        failed_at,
    )?;
    if !decision.should_retry {
        return Ok(());
    }

    let retry = new_run_for_task(
        task,
        TriggerType::Retry,
        run.scheduled_for.clone(),
        decision.next_attempt.unwrap_or(run.attempt + 1),
        format_utc_rfc3339(decision.retry_at.unwrap_or(failed_at)),
        RunStatus::Queued,
        Some("retry_backoff"),
    )?;

    match state.db.create_run(&retry).await {
        Ok(()) => {
            create_run_event(
                &state.db,
                &run.id,
                "info",
                "run.retry_scheduled",
                Some(format!("retry {}", retry.attempt)),
                Some(json!({ "retryRunId": retry.id, "queuedAt": retry.queued_at })),
            )
            .await?;
        }
        Err(err) => {
            warn!(error = %err, run_id = %run.id, "failed to schedule retry");
        }
    }

    Ok(())
}

async fn graceful_shutdown(state: &Arc<DaemonState>) {
    state.accepting_runs.store(false, Ordering::SeqCst);
    state.shutdown.cancel();
    let cancels = {
        let active = state.active_runs.lock().await;
        active
            .values()
            .map(|active| active.cancel.clone())
            .collect::<Vec<_>>()
    };
    for cancel in cancels {
        cancel.cancel();
    }

    tokio::time::sleep(state.config.shutdown_grace).await;
    if let Err(err) = interrupt_remaining_running(&state.db, "daemon_shutdown").await {
        warn!(error = %err, "failed to interrupt remaining runs during shutdown");
    }
}

async fn recover_interrupted_runs(db: &SchedulerDb) -> scheduler_core::Result<()> {
    interrupt_statuses(
        db,
        "daemon_crash_recovery",
        &["queued", "starting", "running"],
    )
    .await
}

async fn interrupt_remaining_running(db: &SchedulerDb, reason: &str) -> scheduler_core::Result<()> {
    interrupt_statuses(db, reason, &["starting", "running"]).await
}

async fn interrupt_statuses(
    db: &SchedulerDb,
    reason: &str,
    statuses: &[&str],
) -> scheduler_core::Result<()> {
    let now = now_rfc3339();
    let placeholders = statuses.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let select_sql = format!("{RUN_SELECT} WHERE status IN ({placeholders})");
    let mut query = sqlx::query_as::<_, Run>(&select_sql);
    for status in statuses {
        query = query.bind(*status);
    }
    let mut runs = query.fetch_all(db.pool()).await?;
    for run in &mut runs {
        run.status = RunStatus::Interrupted;
        run.status_reason = Some(reason.to_owned());
        run.ended_at = run.ended_at.clone().or_else(|| Some(now.clone()));
        run.updated_at = now.clone();
        db.update_run(run).await?;
        revoke_run_tokens(db, &run.id, &now).await?;
        create_run_event(
            db,
            &run.id,
            "warn",
            "run.interrupted",
            Some(reason.to_owned()),
            None,
        )
        .await?;
    }
    Ok(())
}

async fn rpc_server_loop(state: Arc<DaemonState>, listener: UnixListener) {
    loop {
        tokio::select! {
            () = state.shutdown.cancelled() => break,
            accepted = listener.accept() => {
                match accepted {
                    Ok((stream, _)) => {
                        let state_for_conn = state.clone();
                        tokio::spawn(async move {
                            if let Err(err) = handle_connection(state_for_conn, stream).await {
                                debug!(error = %err, "rpc connection ended");
                            }
                        });
                    }
                    Err(err) => {
                        if !state.shutdown.is_cancelled() {
                            warn!(error = %err, "failed to accept rpc connection");
                        }
                    }
                }
            }
        }
    }
}

async fn handle_connection(state: Arc<DaemonState>, stream: UnixStream) -> anyhow::Result<()> {
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read).lines();

    while let Some(line) = lines.next_line().await? {
        let response = match serde_json::from_str::<JsonRpcRequest>(&line) {
            Ok(request) => handle_rpc_request(&state, request).await,
            Err(err) => JsonRpcResponse::failure(
                None,
                JsonRpcError::new(JsonRpcErrorCode::ParseError, format!("parse error: {err}")),
            ),
        };
        write
            .write_all(serde_json::to_string(&response)?.as_bytes())
            .await?;
        write.write_all(b"\n").await?;
        write.flush().await?;
    }

    Ok(())
}

async fn handle_rpc_request(state: &Arc<DaemonState>, request: JsonRpcRequest) -> JsonRpcResponse {
    let id = request.id.clone();
    if request.jsonrpc != JSONRPC_VERSION {
        return JsonRpcResponse::failure(
            id,
            JsonRpcError::new(JsonRpcErrorCode::InvalidRequest, "invalid jsonrpc version"),
        );
    }

    match route_rpc(state, request).await {
        Ok(result) => JsonRpcResponse {
            jsonrpc: JSONRPC_VERSION.to_owned(),
            id,
            result: Some(result),
            error: None,
        },
        Err(error) => JsonRpcResponse::failure(id, error),
    }
}

async fn route_rpc(
    state: &Arc<DaemonState>,
    request: JsonRpcRequest,
) -> Result<Value, JsonRpcError> {
    match request.method.as_str() {
        METHOD_DAEMON_HEALTH => to_value(rpc_health(state).await),
        METHOD_TASK_LIST => {
            let params: TaskListParams = parse_params(request.params)?;
            to_value(rpc_task_list(state, params).await?)
        }
        METHOD_TASK_GET => {
            let params: TaskGetParams = parse_params(request.params)?;
            to_value(rpc_task_get(state, params).await?)
        }
        METHOD_TASK_CREATE => {
            let metadata = RpcMetadata::from_value(request.params.as_ref());
            let params: TaskCreateParams = parse_params(request.params)?;
            to_value(rpc_task_create(state, params, metadata).await?)
        }
        METHOD_TASK_UPDATE => {
            let metadata = RpcMetadata::from_value(request.params.as_ref());
            let params: TaskUpdateParams = parse_params(request.params)?;
            to_value(rpc_task_update(state, params, metadata).await?)
        }
        METHOD_TASK_DELETE => {
            let metadata = RpcMetadata::from_value(request.params.as_ref());
            let params: TaskIdParams = parse_params(request.params)?;
            to_value(rpc_task_delete(state, params, metadata).await?)
        }
        METHOD_TASK_PAUSE => {
            let metadata = RpcMetadata::from_value(request.params.as_ref());
            let params: TaskIdParams = parse_params(request.params)?;
            to_value(
                rpc_task_status(state, params, metadata, TaskStatus::Paused, "task.pause").await?,
            )
        }
        METHOD_TASK_RESUME => {
            let metadata = RpcMetadata::from_value(request.params.as_ref());
            let params: TaskIdParams = parse_params(request.params)?;
            to_value(
                rpc_task_status(state, params, metadata, TaskStatus::Active, "task.resume").await?,
            )
        }
        METHOD_TASK_RUN_NOW => {
            let metadata = RpcMetadata::from_value(request.params.as_ref());
            let params: TaskIdParams = parse_params(request.params)?;
            to_value(rpc_task_run_now(state, params, metadata).await?)
        }
        METHOD_RUN_LIST => {
            let params: RunListParams = parse_params(request.params)?;
            to_value(rpc_run_list(state, params).await?)
        }
        METHOD_RUN_GET => {
            let params: RunGetParams = parse_params(request.params)?;
            to_value(rpc_run_get(state, params).await?)
        }
        METHOD_RUN_CANCEL => {
            let metadata = RpcMetadata::from_value(request.params.as_ref());
            let params: RunCancelParams = parse_params(request.params)?;
            to_value(rpc_run_cancel(state, params, metadata).await?)
        }
        METHOD_RUN_TAIL_LOG => {
            let params: RunTailLogParams = parse_params(request.params)?;
            to_value(rpc_run_tail_log(state, params).await?)
        }
        METHOD_PROJECT_LIST => to_value(ProjectListResult {
            projects: state.db.list_projects().await.map_err(map_core_error)?,
        }),
        METHOD_PROJECT_TRUST => {
            let metadata = RpcMetadata::from_value(request.params.as_ref());
            let params: ProjectTrustParams = parse_params(request.params)?;
            to_value(rpc_project_trust(state, params, metadata).await?)
        }
        METHOD_SETTINGS_GET => {
            let params: SettingsGetParams = parse_params(request.params)?;
            to_value(rpc_settings_get(state, params).await?)
        }
        METHOD_SETTINGS_SET => {
            let metadata = RpcMetadata::from_value(request.params.as_ref());
            let params: SettingsSetParams = parse_params(request.params)?;
            to_value(rpc_settings_set(state, params, metadata).await?)
        }
        _ => Err(JsonRpcError::new(
            JsonRpcErrorCode::MethodNotFound,
            format!("method not found: {}", request.method),
        )),
    }
}

async fn rpc_health(state: &Arc<DaemonState>) -> DaemonHealthResult {
    let scheduler_enabled = scheduler_enabled(&state.db).await.unwrap_or(true);
    DaemonHealthResult {
        ok: true,
        version: state.config.version.clone(),
        db_schema_version: scheduler_core::db::migrations::SCHEMA_VERSION,
        scheduler_enabled,
        running_count: count_running(&state.db).await.unwrap_or_default(),
        queued_count: count_queued(&state.db).await.unwrap_or_default(),
    }
}

async fn rpc_task_list(
    state: &Arc<DaemonState>,
    params: TaskListParams,
) -> Result<TaskListResult, JsonRpcError> {
    let tasks = state.db.list_tasks().await.map_err(map_core_error)?;
    Ok(TaskListResult {
        tasks: tasks
            .iter()
            .filter(|task| {
                params
                    .status
                    .map(|status| task.status == status)
                    .unwrap_or(true)
            })
            .map(TaskDto::from)
            .collect(),
    })
}

async fn rpc_task_get(
    state: &Arc<DaemonState>,
    params: TaskGetParams,
) -> Result<TaskResult, JsonRpcError> {
    let task = state
        .db
        .get_task(&params.id)
        .await
        .map_err(map_core_error)?
        .ok_or_else(task_not_found)?;
    Ok(TaskResult {
        task: TaskDto::from(&task),
    })
}

#[derive(Debug, Clone)]
struct AuthorizedWrite {
    actor: RpcActor,
    token: Option<ScheduleCapabilityToken>,
}

async fn authorize_write(
    state: &Arc<DaemonState>,
    actor: Option<RpcActor>,
    metadata: &RpcMetadata,
) -> Result<AuthorizedWrite, JsonRpcError> {
    if let Some(token_value) = metadata.token.as_deref() {
        let token = validate_run_token(state, token_value, metadata).await?;
        return Ok(AuthorizedWrite {
            actor: scheduled_run_actor(&token),
            token: Some(token),
        });
    }

    let actor = actor.unwrap_or_default();
    if actor.actor_type == AuditActorType::ScheduledRun
        || metadata.current_task_id.is_some()
        || metadata.current_run_id.is_some()
    {
        return Err(JsonRpcError::new(
            JsonRpcErrorCode::PermissionDenied,
            "scheduled-run writes require a capability token",
        ));
    }

    Ok(AuthorizedWrite { actor, token: None })
}

fn reject_scheduled_control_write(
    actor: Option<RpcActor>,
    metadata: &RpcMetadata,
    operation: &str,
) -> Result<RpcActor, JsonRpcError> {
    let actor = actor.unwrap_or_default();
    if actor.actor_type == AuditActorType::ScheduledRun
        || metadata.token.is_some()
        || metadata.current_task_id.is_some()
        || metadata.current_run_id.is_some()
    {
        return Err(JsonRpcError::new(
            JsonRpcErrorCode::PermissionDenied,
            format!("{operation} is only allowed for user initiated requests"),
        ));
    }
    Ok(actor)
}

async fn authorize_task_create(
    state: &Arc<DaemonState>,
    actor: Option<RpcActor>,
    metadata: &RpcMetadata,
) -> Result<AuthorizedWrite, JsonRpcError> {
    let write = authorize_write(state, actor, metadata).await?;
    if let Some(token) = &write.token {
        ensure_capability(token, CAP_SCHEDULE_CREATE)?;
    }
    Ok(write)
}

async fn authorize_task_update(
    state: &Arc<DaemonState>,
    actor: Option<RpcActor>,
    metadata: &RpcMetadata,
    target_task_id: &str,
) -> Result<AuthorizedWrite, JsonRpcError> {
    let write = authorize_write(state, actor, metadata).await?;
    if let Some(token) = &write.token {
        if target_task_id == token.task_id {
            if !token_has_capability(token, CAP_SCHEDULE_UPDATE_CURRENT)
                && !token_has_capability(token, CAP_SCHEDULE_UPDATE_ANY)
            {
                return Err(JsonRpcError::new(
                    JsonRpcErrorCode::PermissionDenied,
                    format!("missing capability: {CAP_SCHEDULE_UPDATE_CURRENT}"),
                ));
            }
        } else {
            ensure_capability(token, CAP_SCHEDULE_UPDATE_ANY)?;
        }
    }
    Ok(write)
}

async fn validate_run_token(
    state: &Arc<DaemonState>,
    token_value: &str,
    metadata: &RpcMetadata,
) -> Result<ScheduleCapabilityToken, JsonRpcError> {
    let token_hash = sha256_hex(token_value.as_bytes());
    let token = state
        .db
        .get_schedule_capability_token_by_hash(&token_hash)
        .await
        .map_err(map_core_error)?
        .ok_or_else(|| {
            JsonRpcError::new(JsonRpcErrorCode::PermissionDenied, "invalid run token")
        })?;

    if token.revoked_at.is_some() {
        return Err(JsonRpcError::new(
            JsonRpcErrorCode::PermissionDenied,
            "run token has been revoked",
        ));
    }
    let expires_at = parse_utc_rfc3339(&token.expires_at).map_err(|err| {
        JsonRpcError::new(
            JsonRpcErrorCode::PermissionDenied,
            format!("invalid token expiry: {err}"),
        )
    })?;
    if expires_at <= Utc::now() {
        return Err(JsonRpcError::new(
            JsonRpcErrorCode::PermissionDenied,
            "run token has expired",
        ));
    }
    if metadata
        .current_run_id
        .as_deref()
        .map(|run_id| run_id != token.run_id)
        .unwrap_or(false)
    {
        return Err(JsonRpcError::new(
            JsonRpcErrorCode::PermissionDenied,
            "currentRunId does not match token run",
        ));
    }
    if metadata
        .current_task_id
        .as_deref()
        .map(|task_id| task_id != token.task_id)
        .unwrap_or(false)
    {
        return Err(JsonRpcError::new(
            JsonRpcErrorCode::PermissionDenied,
            "currentTaskId does not match token task",
        ));
    }

    Ok(token)
}

fn scheduled_run_actor(token: &ScheduleCapabilityToken) -> RpcActor {
    RpcActor {
        actor_type: AuditActorType::ScheduledRun,
        actor_id: Some(token.run_id.clone()),
    }
}

fn token_capabilities(token: &ScheduleCapabilityToken) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(&token.capabilities_json).unwrap_or_default()
}

fn token_has_capability(token: &ScheduleCapabilityToken, capability: &str) -> bool {
    token_capabilities(token)
        .iter()
        .any(|candidate| candidate == capability)
}

fn ensure_capability(
    token: &ScheduleCapabilityToken,
    capability: &str,
) -> Result<(), JsonRpcError> {
    if token_has_capability(token, capability) {
        Ok(())
    } else {
        Err(JsonRpcError::new(
            JsonRpcErrorCode::PermissionDenied,
            format!("missing capability: {capability}"),
        ))
    }
}

async fn reserve_token_create_slot(
    db: &SchedulerDb,
    token: &ScheduleCapabilityToken,
) -> Result<(), JsonRpcError> {
    let result = sqlx::query(
        r#"
        UPDATE schedule_capability_tokens
        SET create_count = create_count + 1
        WHERE id = ?
          AND create_count < max_creates
          AND revoked_at IS NULL
        "#,
    )
    .bind(&token.id)
    .execute(db.pool())
    .await
    .map_err(|err| map_core_error(scheduler_core::SchedulerError::Database(err)))?;

    if result.rows_affected() == 0 {
        return Err(JsonRpcError::new(
            JsonRpcErrorCode::PermissionDenied,
            "schedule:create limit exceeded",
        ));
    }
    Ok(())
}

async fn release_token_create_slot(db: &SchedulerDb, token_id: &str) -> scheduler_core::Result<()> {
    sqlx::query(
        r#"
        UPDATE schedule_capability_tokens
        SET create_count = CASE
            WHEN create_count > 0 THEN create_count - 1
            ELSE 0
        END
        WHERE id = ?
        "#,
    )
    .bind(token_id)
    .execute(db.pool())
    .await?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum TrustOutcome {
    NoRepoPath,
    Trusted,
    ScheduledReviewRequired { path: String },
}

async fn apply_repo_path_trust_policy(
    db: &SchedulerDb,
    task: &mut Task,
    actor_type: AuditActorType,
) -> Result<TrustOutcome, JsonRpcError> {
    let Some(repo_path) = task.repo_path.clone() else {
        return Ok(TrustOutcome::NoRepoPath);
    };
    let canonical = std::fs::canonicalize(&repo_path).map_err(|err| {
        JsonRpcError::new(
            JsonRpcErrorCode::ValidationFailed,
            format!("unable to canonicalize repo_path `{repo_path}`: {err}"),
        )
    })?;
    let canonical_str = path_to_string(&canonical);
    task.repo_path = Some(canonical_str.clone());

    if path_is_under_trusted_project(db, &canonical)
        .await
        .map_err(map_core_error)?
    {
        return Ok(TrustOutcome::Trusted);
    }

    if actor_type == AuditActorType::ScheduledRun {
        task.status = TaskStatus::Paused;
        task.next_run_at = None;
        Ok(TrustOutcome::ScheduledReviewRequired {
            path: canonical_str,
        })
    } else {
        Err(JsonRpcError::new(
            JsonRpcErrorCode::ValidationFailed,
            format!("project.trust is required before scheduling repo_path `{canonical_str}`"),
        ))
    }
}

async fn path_is_under_trusted_project(
    db: &SchedulerDb,
    path: &Path,
) -> scheduler_core::Result<bool> {
    let projects = db.list_projects().await?;
    Ok(projects
        .iter()
        .filter(|project| project.trusted_at.is_some())
        .any(|project| {
            let root = project.git_root.as_deref().unwrap_or(&project.path);
            path.starts_with(Path::new(root))
        }))
}

async fn record_trust_audit(
    db: &SchedulerDb,
    task: &Task,
    trust: TrustOutcome,
    _metadata: &RpcMetadata,
) -> Result<(), JsonRpcError> {
    match trust {
        TrustOutcome::NoRepoPath | TrustOutcome::Trusted => Ok(()),
        TrustOutcome::ScheduledReviewRequired { path } => create_task_audit(
            db,
            Some(&task.id),
            RpcActor {
                actor_type: AuditActorType::Daemon,
                actor_id: None,
            },
            "task.review_required",
            None,
            Some(json!({ "path": path })),
            Some("untrusted_repo_path"),
        )
        .await
        .map_err(map_core_error),
    }
}

async fn rpc_task_create(
    state: &Arc<DaemonState>,
    params: TaskCreateParams,
    metadata: RpcMetadata,
) -> Result<TaskResult, JsonRpcError> {
    let authorization = authorize_task_create(state, params.actor, &metadata).await?;
    let actor = authorization.actor.clone();
    let mut task = Task::try_from(params.task).map_err(map_core_error)?;
    let trust = apply_repo_path_trust_policy(&state.db, &mut task, actor.actor_type).await?;
    prepare_task_schedule(&mut task);
    if let Some(token) = &authorization.token {
        task.created_by = "codex".to_owned();
        task.created_by_run_id = Some(token.run_id.clone());
    } else {
        task.created_by = actor.actor_type.as_str().to_owned();
    }
    task.updated_at = now_rfc3339();
    let reserved_token_id = if let Some(token) = authorization.token.as_ref() {
        reserve_token_create_slot(&state.db, token).await?;
        Some(token.id.clone())
    } else {
        None
    };
    if let Err(err) = state.db.create_task(&task).await {
        if let Some(token_id) = reserved_token_id.as_deref() {
            let _ = release_token_create_slot(&state.db, token_id).await;
        }
        return Err(map_core_error(err));
    }
    create_task_audit(
        &state.db,
        Some(&task.id),
        actor,
        "task.create",
        None,
        Some(serde_json::to_value(TaskDto::from(&task)).map_err(map_json_error)?),
        metadata.reason.as_deref(),
    )
    .await
    .map_err(map_core_error)?;
    record_trust_audit(&state.db, &task, trust, &metadata).await?;
    state.notify_tick.notify_waiters();
    Ok(TaskResult {
        task: TaskDto::from(&task),
    })
}

async fn rpc_task_update(
    state: &Arc<DaemonState>,
    params: TaskUpdateParams,
    metadata: RpcMetadata,
) -> Result<TaskResult, JsonRpcError> {
    let authorization =
        authorize_task_update(state, params.actor, &metadata, &params.task.id).await?;
    let actor = authorization.actor;
    let before = state
        .db
        .get_task(&params.task.id)
        .await
        .map_err(map_core_error)?
        .ok_or_else(task_not_found)?;
    let before_json = serde_json::to_value(TaskDto::from(&before)).map_err(map_json_error)?;
    let mut task = Task::try_from(params.task).map_err(map_core_error)?;
    task.created_at = before.created_at.clone();
    task.created_by = before.created_by.clone();
    task.created_by_run_id = before.created_by_run_id.clone();
    task.deleted_at = before.deleted_at.clone();
    task.updated_at = now_rfc3339();
    let trust = apply_repo_path_trust_policy(&state.db, &mut task, actor.actor_type).await?;
    prepare_task_schedule(&mut task);
    state.db.update_task(&task).await.map_err(map_core_error)?;
    create_task_audit(
        &state.db,
        Some(&task.id),
        actor,
        "task.update",
        Some(before_json),
        Some(serde_json::to_value(TaskDto::from(&task)).map_err(map_json_error)?),
        metadata.reason.as_deref(),
    )
    .await
    .map_err(map_core_error)?;
    record_trust_audit(&state.db, &task, trust, &metadata).await?;
    state.notify_tick.notify_waiters();
    Ok(TaskResult {
        task: TaskDto::from(&task),
    })
}

async fn rpc_task_delete(
    state: &Arc<DaemonState>,
    params: TaskIdParams,
    metadata: RpcMetadata,
) -> Result<TaskDeleteResult, JsonRpcError> {
    let authorization = authorize_write(state, params.actor, &metadata).await?;
    if let Some(token) = &authorization.token {
        ensure_capability(token, CAP_SCHEDULE_UPDATE_ANY)?;
    }
    let actor = authorization.actor;
    let before = state
        .db
        .get_task(&params.id)
        .await
        .map_err(map_core_error)?
        .ok_or_else(task_not_found)?;
    let deleted = state
        .db
        .delete_task(&params.id, &now_rfc3339())
        .await
        .map_err(map_core_error)?;
    create_task_audit(
        &state.db,
        Some(&params.id),
        actor,
        "task.delete",
        Some(serde_json::to_value(TaskDto::from(&before)).map_err(map_json_error)?),
        None,
        metadata.reason.as_deref(),
    )
    .await
    .map_err(map_core_error)?;
    Ok(TaskDeleteResult { deleted })
}

async fn rpc_task_status(
    state: &Arc<DaemonState>,
    params: TaskIdParams,
    metadata: RpcMetadata,
    status: TaskStatus,
    action: &str,
) -> Result<TaskResult, JsonRpcError> {
    let authorization = authorize_write(state, params.actor, &metadata).await?;
    if let Some(token) = &authorization.token {
        let is_pause_current = action == "task.pause" && params.id == token.task_id;
        if is_pause_current {
            if !token_has_capability(token, CAP_SCHEDULE_PAUSE_CURRENT)
                && !token_has_capability(token, CAP_SCHEDULE_UPDATE_ANY)
            {
                return Err(JsonRpcError::new(
                    JsonRpcErrorCode::PermissionDenied,
                    format!("missing capability: {CAP_SCHEDULE_PAUSE_CURRENT}"),
                ));
            }
        } else {
            ensure_capability(token, CAP_SCHEDULE_UPDATE_ANY)?;
        }
    }
    let actor = authorization.actor;
    let mut task = state
        .db
        .get_task(&params.id)
        .await
        .map_err(map_core_error)?
        .ok_or_else(task_not_found)?;
    let before_json = serde_json::to_value(TaskDto::from(&task)).map_err(map_json_error)?;
    task.status = status;
    if status == TaskStatus::Active && task.next_run_at.is_none() {
        prepare_task_schedule(&mut task);
    }
    task.updated_at = now_rfc3339();
    state.db.update_task(&task).await.map_err(map_core_error)?;
    create_task_audit(
        &state.db,
        Some(&task.id),
        actor,
        action,
        Some(before_json),
        Some(serde_json::to_value(TaskDto::from(&task)).map_err(map_json_error)?),
        metadata.reason.as_deref(),
    )
    .await
    .map_err(map_core_error)?;
    state.notify_tick.notify_waiters();
    Ok(TaskResult {
        task: TaskDto::from(&task),
    })
}

async fn rpc_task_run_now(
    state: &Arc<DaemonState>,
    params: TaskIdParams,
    metadata: RpcMetadata,
) -> Result<RunResult, JsonRpcError> {
    let authorization = authorize_write(state, params.actor, &metadata).await?;
    if let Some(token) = &authorization.token {
        ensure_capability(token, CAP_SCHEDULE_RUN_NOW)?;
    }
    let actor = authorization.actor;
    let task = state
        .db
        .get_task(&params.id)
        .await
        .map_err(map_core_error)?
        .ok_or_else(task_not_found)?;
    let run = new_run_for_task(
        &task,
        TriggerType::Manual,
        None,
        1,
        now_rfc3339(),
        RunStatus::Queued,
        None,
    )
    .map_err(map_anyhow_error)?;
    state.db.create_run(&run).await.map_err(map_core_error)?;
    create_task_audit(
        &state.db,
        Some(&task.id),
        actor,
        "task.runNow",
        None,
        Some(json!({ "runId": run.id })),
        metadata.reason.as_deref(),
    )
    .await
    .map_err(map_core_error)?;
    state.notify_tick.notify_waiters();
    Ok(RunResult {
        run: RunDto::from(&run),
    })
}

async fn rpc_run_list(
    state: &Arc<DaemonState>,
    params: RunListParams,
) -> Result<RunListResult, JsonRpcError> {
    let runs = list_runs(&state.db, params.task_id.as_deref(), params.status).await?;
    Ok(RunListResult {
        runs: runs.iter().map(RunDto::from).collect(),
    })
}

async fn rpc_run_get(
    state: &Arc<DaemonState>,
    params: RunGetParams,
) -> Result<RunResult, JsonRpcError> {
    let run = state
        .db
        .get_run(&params.id)
        .await
        .map_err(map_core_error)?
        .ok_or_else(run_not_found)?;
    Ok(RunResult {
        run: RunDto::from(&run),
    })
}

async fn rpc_run_cancel(
    state: &Arc<DaemonState>,
    params: RunCancelParams,
    metadata: RpcMetadata,
) -> Result<RunResult, JsonRpcError> {
    let authorization = authorize_write(state, params.actor, &metadata).await?;
    if let Some(token) = &authorization.token {
        if params.id != token.run_id {
            ensure_capability(token, CAP_SCHEDULE_UPDATE_ANY)?;
        }
    }
    let actor = authorization.actor;
    cancel_run(state, &params.id, actor, metadata.reason.as_deref()).await
}

async fn rpc_run_tail_log(
    state: &Arc<DaemonState>,
    params: RunTailLogParams,
) -> Result<RunTailLogResult, JsonRpcError> {
    let run = state
        .db
        .get_run(&params.run_id)
        .await
        .map_err(map_core_error)?
        .ok_or_else(run_not_found)?;
    let path = match params.stream {
        LogStream::Stdout => run.stdout_log_path,
        LogStream::Stderr => run.stderr_log_path,
    }
    .ok_or_else(|| JsonRpcError::new(JsonRpcErrorCode::RunNotFound, "log path not available"))?;
    tail_log_file(
        &params.run_id,
        params.stream,
        Path::new(&path),
        params.cursor.unwrap_or(0),
        params.limit.unwrap_or(8192).min(64 * 1024),
    )
    .await
}

async fn rpc_project_trust(
    state: &Arc<DaemonState>,
    params: ProjectTrustParams,
    metadata: RpcMetadata,
) -> Result<ProjectTrustResult, JsonRpcError> {
    let actor = reject_scheduled_control_write(params.actor, &metadata, "project.trust")?;
    let canonical = std::fs::canonicalize(&params.path).map_err(|err| {
        JsonRpcError::new(
            JsonRpcErrorCode::ValidationFailed,
            format!("unable to canonicalize project path: {err}"),
        )
    })?;
    let path = path_to_string(&canonical);
    let git_root = detect_git_root(&canonical);
    let now = now_rfc3339();
    let mut existing = state
        .db
        .list_projects()
        .await
        .map_err(map_core_error)?
        .into_iter()
        .find(|project| project.path == path);

    let project = if let Some(mut project) = existing.take() {
        project.kind = if git_root.is_some() {
            ProjectKind::Git
        } else {
            ProjectKind::Folder
        };
        project.git_root = git_root.clone();
        project.trusted_at = Some(now.clone());
        project.updated_at = now.clone();
        state
            .db
            .update_project(&project)
            .await
            .map_err(map_core_error)?;
        project
    } else {
        let project = Project {
            id: new_project_id(),
            name: canonical
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("Project")
                .to_owned(),
            path: path.clone(),
            kind: if git_root.is_some() {
                ProjectKind::Git
            } else {
                ProjectKind::Folder
            },
            git_root,
            git_remote_url: None,
            default_branch: None,
            trusted_at: Some(now.clone()),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        state
            .db
            .create_project(&project)
            .await
            .map_err(map_core_error)?;
        project
    };

    create_task_audit(
        &state.db,
        None,
        actor,
        "project.trust",
        None,
        Some(json!({ "projectId": project.id, "path": project.path })),
        metadata.reason.as_deref(),
    )
    .await
    .map_err(map_core_error)?;
    Ok(ProjectTrustResult { project })
}

async fn rpc_settings_get(
    state: &Arc<DaemonState>,
    params: SettingsGetParams,
) -> Result<SettingsGetResult, JsonRpcError> {
    let settings = if let Some(key) = params.key {
        state
            .db
            .get_setting_row(&key)
            .await
            .map_err(map_core_error)?
            .into_iter()
            .collect()
    } else {
        state.db.list_settings().await.map_err(map_core_error)?
    };
    Ok(SettingsGetResult { settings })
}

async fn rpc_settings_set(
    state: &Arc<DaemonState>,
    params: SettingsSetParams,
    metadata: RpcMetadata,
) -> Result<SettingsSetResult, JsonRpcError> {
    let actor = reject_scheduled_control_write(params.actor, &metadata, "settings.set")?;
    state
        .db
        .set_setting(&params.key, &params.value)
        .await
        .map_err(map_core_error)?;
    let setting = state
        .db
        .get_setting_row(&params.key)
        .await
        .map_err(map_core_error)?
        .ok_or_else(|| JsonRpcError::new(JsonRpcErrorCode::InternalError, "setting not found"))?;
    create_task_audit(
        &state.db,
        None,
        actor,
        "settings.set",
        None,
        Some(json!({ "key": params.key })),
        metadata.reason.as_deref(),
    )
    .await
    .map_err(map_core_error)?;
    state.notify_tick.notify_waiters();
    Ok(SettingsSetResult { setting })
}

async fn cancel_run(
    state: &Arc<DaemonState>,
    run_id: &str,
    actor: RpcActor,
    reason: Option<&str>,
) -> Result<RunResult, JsonRpcError> {
    if let Some(active) = state.active_runs.lock().await.get(run_id) {
        active.cancel.cancel();
    }

    let mut run = state
        .db
        .get_run(run_id)
        .await
        .map_err(map_core_error)?
        .ok_or_else(run_not_found)?;
    if run.status == RunStatus::Queued {
        run.status = RunStatus::Canceled;
        run.status_reason = Some("canceled".to_owned());
        run.ended_at = Some(now_rfc3339());
        run.updated_at = now_rfc3339();
        state.db.update_run(&run).await.map_err(map_core_error)?;
    }
    create_task_audit(
        &state.db,
        Some(&run.task_id),
        actor,
        "run.cancel",
        None,
        Some(json!({ "runId": run.id })),
        reason,
    )
    .await
    .map_err(map_core_error)?;
    Ok(RunResult {
        run: RunDto::from(&run),
    })
}

async fn cancel_active_runs_for_task(state: &Arc<DaemonState>, task_id: &str) {
    let active = state.active_runs.lock().await;
    for run in active.values().filter(|run| run.task_id == task_id) {
        run.cancel.cancel();
    }
}

fn prepare_task_schedule(task: &mut Task) {
    if task.status != TaskStatus::Active {
        return;
    }
    if task.next_run_at.is_some() {
        return;
    }
    match compute_next_run_at(task, Utc::now()) {
        Ok(next_run_at) => {
            task.next_run_at = next_run_at.map(format_utc_rfc3339);
            task.schedule_status = ScheduleStatus::Valid;
            task.schedule_error = None;
        }
        Err(err) => {
            task.schedule_status = ScheduleStatus::Invalid;
            task.schedule_error = Some(err.to_string());
        }
    }
}

fn new_run_for_task(
    task: &Task,
    trigger_type: TriggerType,
    scheduled_for: Option<String>,
    attempt: i64,
    queued_at: String,
    status: RunStatus,
    status_reason: Option<&str>,
) -> anyhow::Result<Run> {
    let now = now_rfc3339();
    Ok(Run {
        id: new_run_id(),
        task_id: task.id.clone(),
        trigger_type,
        scheduled_for,
        attempt,
        status,
        status_reason: status_reason.map(str::to_owned),
        queued_at,
        started_at: None,
        ended_at: None,
        duration_ms: None,
        target_mode: task.target_mode,
        workspace_path: task.repo_path.clone(),
        worktree_path: None,
        branch_name: None,
        base_ref: task.base_ref.clone(),
        commit_before: None,
        commit_after: None,
        codex_command_json: serde_json::to_string(&json!({
            "executor": "mockable",
            "taskId": task.id,
            "triggerType": trigger_type.as_str(),
        }))?,
        codex_session_id: None,
        pid: None,
        exit_code: None,
        signal: None,
        stdout_log_path: None,
        stderr_log_path: None,
        events_jsonl_path: None,
        last_message_path: None,
        stdout_tail: None,
        stderr_tail: None,
        result_summary: None,
        findings_count: Some(0),
        created_schedule_count: Some(0),
        created_at: now.clone(),
        updated_at: now,
    })
}

async fn mark_run_terminal(
    db: &SchedulerDb,
    mut run: Run,
    status: RunStatus,
    reason: Option<&str>,
    exit_code: Option<i64>,
    signal: Option<&str>,
) -> scheduler_core::Result<()> {
    run.status = status;
    run.status_reason = reason.map(str::to_owned);
    run.exit_code = exit_code;
    run.signal = signal.map(str::to_owned);
    run.ended_at = Some(now_rfc3339());
    run.updated_at = now_rfc3339();
    db.update_run(&run).await?;
    Ok(())
}

async fn mark_run_setup_failure(
    db: &SchedulerDb,
    run_id: &str,
    message: String,
) -> scheduler_core::Result<()> {
    let Some(mut run) = db.get_run(run_id).await? else {
        return Ok(());
    };
    run.status = RunStatus::Failed;
    run.status_reason = Some("setup_failure".to_owned());
    run.ended_at = Some(now_rfc3339());
    run.updated_at = now_rfc3339();
    run.stderr_tail = Some(message.clone());
    db.update_run(&run).await?;
    create_run_event(
        db,
        run_id,
        "error",
        "run.setup_failed",
        Some(message),
        Some(json!({ "failureKind": "permanent" })),
    )
    .await?;
    Ok(())
}

fn is_terminal(status: RunStatus) -> bool {
    matches!(
        status,
        RunStatus::Succeeded
            | RunStatus::Failed
            | RunStatus::Canceled
            | RunStatus::Skipped
            | RunStatus::Interrupted
            | RunStatus::TimedOut
    )
}

async fn create_run_event(
    db: &SchedulerDb,
    run_id: &str,
    level: &str,
    event_type: &str,
    message: Option<String>,
    payload: Option<Value>,
) -> scheduler_core::Result<()> {
    let next_index: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(event_index), -1) + 1 FROM run_events WHERE run_id = ?",
    )
    .bind(run_id)
    .fetch_one(db.pool())
    .await?;
    let event = RunEvent {
        id: new_run_event_id(),
        run_id: run_id.to_owned(),
        event_index: next_index,
        source: RunEventSource::Daemon,
        level: level.to_owned(),
        event_type: event_type.to_owned(),
        message,
        payload_json: payload
            .map(|payload| serde_json::to_string(&payload))
            .transpose()?,
        created_at: now_rfc3339(),
    };
    db.create_run_event(&event).await
}

async fn create_task_audit(
    db: &SchedulerDb,
    task_id: Option<&str>,
    actor: RpcActor,
    action: &str,
    before: Option<Value>,
    after: Option<Value>,
    reason: Option<&str>,
) -> scheduler_core::Result<()> {
    let event = TaskAuditEvent {
        id: new_task_audit_event_id(),
        task_id: task_id.map(str::to_owned),
        actor_type: actor.actor_type,
        actor_id: actor.actor_id,
        action: action.to_owned(),
        before_json: before
            .map(|value| serde_json::to_string(&value))
            .transpose()?,
        after_json: after
            .map(|value| serde_json::to_string(&value))
            .transpose()?,
        reason: reason.map(str::to_owned),
        created_at: now_rfc3339(),
    };
    db.create_task_audit_event(&event).await
}

fn publish_event(
    state: &Arc<DaemonState>,
    event_type: &str,
    task_id: Option<String>,
    run_id: Option<String>,
    payload: Value,
) {
    let _ = state.events_tx.send(DaemonEvent {
        event_type: event_type.to_owned(),
        task_id,
        run_id,
        payload,
    });
}

async fn list_startable_queued_runs(
    db: &SchedulerDb,
    now: &str,
) -> scheduler_core::Result<Vec<Run>> {
    Ok(sqlx::query_as::<_, Run>(&format!(
        "{RUN_SELECT} WHERE status = 'queued' AND queued_at <= ? ORDER BY queued_at ASC, created_at ASC, id ASC"
    ))
    .bind(now)
    .fetch_all(db.pool())
    .await?)
}

async fn list_runs(
    db: &SchedulerDb,
    task_id: Option<&str>,
    status: Option<RunStatus>,
) -> Result<Vec<Run>, JsonRpcError> {
    let runs = match (task_id, status) {
        (Some(task_id), Some(status)) => {
            sqlx::query_as::<_, Run>(&format!(
                "{RUN_SELECT} WHERE task_id = ? AND status = ? ORDER BY created_at DESC, id DESC"
            ))
            .bind(task_id)
            .bind(status)
            .fetch_all(db.pool())
            .await
        }
        (Some(task_id), None) => {
            sqlx::query_as::<_, Run>(&format!(
                "{RUN_SELECT} WHERE task_id = ? ORDER BY created_at DESC, id DESC"
            ))
            .bind(task_id)
            .fetch_all(db.pool())
            .await
        }
        (None, Some(status)) => {
            sqlx::query_as::<_, Run>(&format!(
                "{RUN_SELECT} WHERE status = ? ORDER BY created_at DESC, id DESC"
            ))
            .bind(status)
            .fetch_all(db.pool())
            .await
        }
        (None, None) => {
            sqlx::query_as::<_, Run>(&format!("{RUN_SELECT} ORDER BY created_at DESC, id DESC"))
                .fetch_all(db.pool())
                .await
        }
    };
    runs.map_err(|err| map_core_error(scheduler_core::SchedulerError::Database(err)))
}

async fn count_running(db: &SchedulerDb) -> scheduler_core::Result<i64> {
    Ok(
        sqlx::query_scalar("SELECT COUNT(*) FROM runs WHERE status IN ('starting', 'running')")
            .fetch_one(db.pool())
            .await?,
    )
}

async fn count_queued(db: &SchedulerDb) -> scheduler_core::Result<i64> {
    Ok(
        sqlx::query_scalar("SELECT COUNT(*) FROM runs WHERE status = 'queued'")
            .fetch_one(db.pool())
            .await?,
    )
}

async fn count_running_for_task(
    db: &SchedulerDb,
    task_id: &str,
    exclude_run_id: Option<&str>,
) -> scheduler_core::Result<i64> {
    let count = if let Some(exclude_run_id) = exclude_run_id {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM runs
             WHERE task_id = ? AND id != ? AND status IN ('starting', 'running')",
        )
        .bind(task_id)
        .bind(exclude_run_id)
        .fetch_one(db.pool())
        .await?
    } else {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM runs WHERE task_id = ? AND status IN ('starting', 'running')",
        )
        .bind(task_id)
        .fetch_one(db.pool())
        .await?
    };
    Ok(count)
}

async fn count_running_for_project_key(
    db: &SchedulerDb,
    task: &Task,
) -> scheduler_core::Result<i64> {
    if let Some(project_id) = task.project_id.as_deref() {
        return Ok(sqlx::query_scalar(
            "SELECT COUNT(*)
             FROM runs r
             JOIN tasks t ON t.id = r.task_id
             WHERE t.project_id = ? AND r.status IN ('starting', 'running')",
        )
        .bind(project_id)
        .fetch_one(db.pool())
        .await?);
    }

    if let Some(repo_path) = task.repo_path.as_deref() {
        return Ok(sqlx::query_scalar(
            "SELECT COUNT(*)
             FROM runs r
             JOIN tasks t ON t.id = r.task_id
             WHERE t.project_id IS NULL AND t.repo_path = ? AND r.status IN ('starting', 'running')",
        )
        .bind(repo_path)
        .fetch_one(db.pool())
        .await?);
    }

    Ok(0)
}

async fn tail_log_file(
    run_id: &str,
    stream: LogStream,
    path: &Path,
    cursor: u64,
    limit: usize,
) -> Result<RunTailLogResult, JsonRpcError> {
    let bytes = tokio::fs::read(path).await.map_err(|err| {
        JsonRpcError::new(
            JsonRpcErrorCode::RunNotFound,
            format!("unable to read log file: {err}"),
        )
    })?;
    let start = cursor.min(bytes.len() as u64) as usize;
    let end = (start + limit).min(bytes.len());
    Ok(RunTailLogResult {
        run_id: run_id.to_owned(),
        stream,
        cursor,
        next_cursor: end as u64,
        eof: end >= bytes.len(),
        data: String::from_utf8_lossy(&bytes[start..end]).into_owned(),
    })
}

fn detect_git_root(path: &Path) -> Option<String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let root = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if root.is_empty() {
        None
    } else {
        Some(root)
    }
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn string_field(object: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn to_value<T: Serialize>(value: T) -> Result<Value, JsonRpcError> {
    serde_json::to_value(value).map_err(map_json_error)
}

fn map_json_error(err: serde_json::Error) -> JsonRpcError {
    JsonRpcError::new(
        JsonRpcErrorCode::InternalError,
        format!("json error: {err}"),
    )
}

fn map_anyhow_error(err: anyhow::Error) -> JsonRpcError {
    JsonRpcError::new(JsonRpcErrorCode::InternalError, err.to_string())
}

fn map_core_error(err: scheduler_core::SchedulerError) -> JsonRpcError {
    match err {
        scheduler_core::SchedulerError::Validation(validation) => {
            JsonRpcError::new(JsonRpcErrorCode::ValidationFailed, validation.to_string())
        }
        scheduler_core::SchedulerError::Database(sqlx::Error::RowNotFound) => {
            JsonRpcError::new(JsonRpcErrorCode::RunNotFound, "row not found")
        }
        other => JsonRpcError::new(JsonRpcErrorCode::InternalError, other.to_string()),
    }
}

fn task_not_found() -> JsonRpcError {
    JsonRpcError::new(JsonRpcErrorCode::TaskNotFound, "task not found")
}

fn run_not_found() -> JsonRpcError {
    JsonRpcError::new(JsonRpcErrorCode::RunNotFound, "run not found")
}

const RUN_SELECT: &str = "SELECT id, task_id, trigger_type, scheduled_for, attempt, status,
    status_reason, queued_at, started_at, ended_at, duration_ms, target_mode, workspace_path,
    worktree_path, branch_name, base_ref, commit_before, commit_after, codex_command_json,
    codex_session_id, pid, exit_code, signal, stdout_log_path, stderr_log_path, events_jsonl_path,
    last_message_path, stdout_tail, stderr_tail, result_summary, findings_count,
    created_schedule_count, created_at, updated_at
    FROM runs";

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}
