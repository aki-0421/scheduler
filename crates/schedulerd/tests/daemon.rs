use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use chrono::{Duration as ChronoDuration, Utc};
use scheduler_core::ipc::*;
use scheduler_core::model::*;
use scheduler_core::time::{format_utc_rfc3339, now_rfc3339};
use scheduler_core::util::sha256_hex;
use schedulerd::executor::{MockBehavior, MockExecutor};
use schedulerd::{rpc, start_daemon, CodexExecutor, DaemonConfig, DaemonHandle, ExecutionResult};
use serde_json::{json, Value};
use tempfile::TempDir;

async fn start_test_daemon(behavior: MockBehavior) -> (TempDir, DaemonHandle, MockExecutor) {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let config = DaemonConfig::for_data_dir(temp_dir.path())
        .with_tick_interval(Duration::from_secs(3600))
        .with_due_grace(Duration::from_secs(5))
        .with_shutdown_grace(Duration::from_millis(20));
    let executor = MockExecutor::new(behavior);
    let handle = start_daemon(config, Arc::new(executor.clone()))
        .await
        .expect("start daemon");
    (temp_dir, handle, executor)
}

fn sample_task_dto(slug: &str, kind: TaskKind) -> TaskDto {
    TaskDto {
        id: String::new(),
        slug: slug.to_owned(),
        name: slug.to_owned(),
        description: None,
        status: TaskStatus::Active,
        kind,
        cron_expr: (kind == TaskKind::Cron).then(|| "* * * * *".to_owned()),
        run_at: None,
        timezone: "UTC".to_owned(),
        next_run_at: None,
        target: TaskTargetDto {
            mode: RunTargetMode::Chat,
            project_id: None,
            repo_path: None,
            base_ref: None,
        },
        codex: TaskCodexDto {
            model: None,
            reasoning_effort: None,
            sandbox_mode: SandboxMode::ReadOnly,
            approval_policy: ApprovalPolicy::Never,
        },
        prompt: TaskPromptDto {
            body: "Check project status.".to_owned(),
            inject_scheduler_instructions: true,
        },
        policies: TaskPoliciesDto {
            allow_schedule_cli: true,
            missed_policy: MissedPolicy::LatestWithinWindow,
            overlap_policy: OverlapPolicy::Skip,
            max_runtime_sec: 7200,
            schedule_cli_capabilities: Some(vec![
                "schedule:create".to_owned(),
                "schedule:update-current".to_owned(),
                "schedule:list".to_owned(),
            ]),
            missed_window_days: Some(7),
            max_retries: Some(0),
            retry_backoff_sec: Some(300),
            cleanup_policy: Some(CleanupPolicy::Keep),
            cleanup_after_days: None,
        },
    }
}

fn codex_fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("codex-runner")
        .join("tests")
        .join("fixtures")
        .join(name)
}

fn sample_task_table(slug: &str, kind: TaskKind) -> Task {
    Task::try_from(sample_task_dto(slug, kind)).expect("task from dto")
}

fn with_invocation_metadata<T: serde::Serialize>(
    params: T,
    token: &str,
    task_id: &str,
    run_id: &str,
    reason: &str,
) -> Value {
    let mut value = serde_json::to_value(params).expect("params json");
    let object = value.as_object_mut().expect("params object");
    object.insert("token".to_owned(), json!(token));
    object.insert("currentTaskId".to_owned(), json!(task_id));
    object.insert("currentRunId".to_owned(), json!(run_id));
    object.insert("reason".to_owned(), json!(reason));
    value
}

async fn wait_for_skipped_run(handle: &DaemonHandle, task_id: &str, timeout: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let runs = handle.db().list_runs_for_task(task_id).await.expect("runs");
        if runs.iter().any(|run| {
            run.status == RunStatus::Skipped
                && run.status_reason.as_deref() == Some("previous_run_still_running")
        }) {
            return true;
        }
        let now = tokio::time::Instant::now();
        if now >= deadline {
            return false;
        }
        tokio::time::sleep((deadline - now).min(Duration::from_millis(10))).await;
    }
}

async fn wait_for_task_runs(
    handle: &DaemonHandle,
    task_id: &str,
    predicate: impl Fn(&[Run]) -> bool,
    timeout: Duration,
) -> Vec<Run> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let runs = handle.db().list_runs_for_task(task_id).await.expect("runs");
        if predicate(&runs) {
            return runs;
        }
        let now = tokio::time::Instant::now();
        if now >= deadline {
            return runs;
        }
        tokio::time::sleep((deadline - now).min(Duration::from_millis(10))).await;
    }
}

async fn source_token(
    handle: &DaemonHandle,
    executor: &MockExecutor,
    slug: &str,
    capabilities: Vec<String>,
) -> (TaskDto, String, String) {
    let mut task = sample_task_dto(slug, TaskKind::Cron);
    task.next_run_at = Some(now_rfc3339());
    task.policies.schedule_cli_capabilities = Some(capabilities);
    let created: TaskResult = rpc::call(
        &handle.socket_path(),
        METHOD_TASK_CREATE,
        TaskCreateParams { task, actor: None },
    )
    .await
    .expect("create source task");
    assert!(executor.wait_for_calls(1, Duration::from_secs(2)).await);
    let call = executor
        .calls()
        .await
        .into_iter()
        .find(|call| call.task.id == created.task.id)
        .expect("source call");
    (
        created.task,
        call.schedule_token.expect("schedule token"),
        call.run.id,
    )
}

fn sample_run(task: &Task, status: RunStatus) -> Run {
    let now = now_rfc3339();
    Run {
        id: new_run_id(),
        task_id: task.id.clone(),
        trigger_type: TriggerType::Schedule,
        scheduled_for: Some(now.clone()),
        attempt: 1,
        status,
        status_reason: None,
        queued_at: now.clone(),
        started_at: (status == RunStatus::Running).then(|| now.clone()),
        ended_at: None,
        duration_ms: None,
        target_mode: task.target_mode,
        workspace_path: None,
        worktree_path: None,
        branch_name: None,
        base_ref: None,
        commit_before: None,
        commit_after: None,
        codex_command_json: "{}".to_owned(),
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
    }
}

#[tokio::test]
async fn daemon_health_returns_shape_over_uds() {
    let (_temp, handle, _executor) =
        start_test_daemon(MockBehavior::succeed_after(Duration::from_millis(10))).await;

    let health: DaemonHealthResult = rpc::call(
        &handle.socket_path(),
        METHOD_DAEMON_HEALTH,
        DaemonHealthParams {},
    )
    .await
    .expect("health rpc");

    assert!(health.ok);
    assert_eq!(health.db_schema_version, 1);
    assert!(health.scheduler_enabled);
    assert_eq!(health.running_count, 0);
    assert_eq!(health.queued_count, 0);

    handle.shutdown().await;
}

#[tokio::test]
async fn cron_create_tick_enqueues_due_run_and_calls_executor() {
    let (_temp, handle, executor) =
        start_test_daemon(MockBehavior::succeed_after(Duration::from_millis(10))).await;

    let mut task = sample_task_dto("cron-due", TaskKind::Cron);
    task.next_run_at = Some(now_rfc3339());
    let created: TaskResult = rpc::call(
        &handle.socket_path(),
        METHOD_TASK_CREATE,
        TaskCreateParams { task, actor: None },
    )
    .await
    .expect("create task");

    assert!(executor.wait_for_calls(1, Duration::from_secs(2)).await);
    let runs = handle
        .db()
        .list_runs_for_task(&created.task.id)
        .await
        .expect("runs");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].trigger_type, TriggerType::Schedule);

    handle.shutdown().await;
}

#[tokio::test]
async fn once_task_becomes_completed_after_run_creation() {
    let (_temp, handle, executor) =
        start_test_daemon(MockBehavior::succeed_after(Duration::from_millis(10))).await;

    let now = now_rfc3339();
    let mut task = sample_task_dto("once-due", TaskKind::Once);
    task.run_at = Some(now.clone());
    task.next_run_at = Some(now);
    let created: TaskResult = rpc::call(
        &handle.socket_path(),
        METHOD_TASK_CREATE,
        TaskCreateParams { task, actor: None },
    )
    .await
    .expect("create once");

    assert!(executor.wait_for_calls(1, Duration::from_secs(2)).await);
    let stored = handle
        .db()
        .get_task(&created.task.id)
        .await
        .expect("get task")
        .expect("task");
    assert_eq!(stored.status, TaskStatus::Completed);

    handle.shutdown().await;
}

#[tokio::test]
async fn missed_latest_catchup_creates_one_run_and_skipped_audit() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let config = DaemonConfig::for_data_dir(temp_dir.path())
        .with_tick_interval(Duration::from_secs(3600))
        .with_shutdown_grace(Duration::from_millis(20));
    let db = scheduler_core::db::SchedulerDb::connect(&config.paths.db_path)
        .await
        .expect("db");
    let mut task = sample_task_table("missed-catchup", TaskKind::Cron);
    task.cron_expr = Some("* * * * *".to_owned());
    task.next_run_at = Some(format_utc_rfc3339(Utc::now() - ChronoDuration::minutes(5)));
    task.missed_policy = MissedPolicy::LatestWithinWindow;
    task.missed_window_days = 7;
    db.create_task(&task).await.expect("create task");
    drop(db);

    let executor = MockExecutor::new(MockBehavior::succeed_after(Duration::from_millis(50)));
    let handle = start_daemon(config, Arc::new(executor.clone()))
        .await
        .expect("start");
    assert!(executor.wait_for_calls(1, Duration::from_secs(2)).await);

    let runs = handle
        .db()
        .list_runs_for_task(&task.id)
        .await
        .expect("runs");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].trigger_type, TriggerType::Catchup);

    let audits = handle
        .db()
        .list_task_audit_events(&task.id)
        .await
        .expect("audits");
    assert!(audits.iter().any(|audit| audit.action == "run.skipped"
        && audit.reason.as_deref() == Some("missed_occurrence_skipped")));

    handle.shutdown().await;
    drop(temp_dir);
}

#[tokio::test]
async fn overlap_skip_records_skipped_run_when_previous_is_running() {
    let (_temp, handle, executor) = start_test_daemon(MockBehavior::hold_until_cancel()).await;

    let mut task = sample_task_dto("overlap-skip", TaskKind::Cron);
    task.next_run_at = Some(now_rfc3339());
    let created: TaskResult = rpc::call(
        &handle.socket_path(),
        METHOD_TASK_CREATE,
        TaskCreateParams { task, actor: None },
    )
    .await
    .expect("create task");
    assert!(executor.wait_for_calls(1, Duration::from_secs(2)).await);

    let mut stored = handle
        .db()
        .get_task(&created.task.id)
        .await
        .expect("get task")
        .expect("task");
    stored.next_run_at = Some(format_utc_rfc3339(Utc::now() + ChronoDuration::seconds(1)));
    stored.updated_at = now_rfc3339();
    handle.db().update_task(&stored).await.expect("update task");
    handle.request_tick();

    assert!(wait_for_skipped_run(&handle, &created.task.id, Duration::from_secs(2)).await);

    handle.shutdown().await;
}

#[tokio::test]
async fn crash_recovery_marks_stale_running_run_interrupted() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let config = DaemonConfig::for_data_dir(temp_dir.path())
        .with_tick_interval(Duration::from_secs(3600))
        .with_shutdown_grace(Duration::from_millis(20));
    let db = scheduler_core::db::SchedulerDb::connect(&config.paths.db_path)
        .await
        .expect("db");
    let task = sample_task_table("stale-running", TaskKind::Manual);
    db.create_task(&task).await.expect("create task");
    let run = sample_run(&task, RunStatus::Running);
    db.create_run(&run).await.expect("create run");
    let token_value = "recover_revokes_token";
    db.create_schedule_capability_token(&ScheduleCapabilityToken {
        id: new_schedule_capability_token_id(),
        run_id: run.id.clone(),
        task_id: task.id.clone(),
        token_hash: sha256_hex(token_value.as_bytes()),
        capabilities_json: serde_json::to_string(&vec!["schedule:create".to_owned()])
            .expect("capabilities"),
        expires_at: format_utc_rfc3339(Utc::now() + ChronoDuration::hours(1)),
        max_creates: 5,
        create_count: 0,
        revoked_at: None,
        created_at: now_rfc3339(),
    })
    .await
    .expect("create token");
    drop(db);

    let executor = MockExecutor::succeeding();
    let handle = start_daemon(config, Arc::new(executor.clone()))
        .await
        .expect("start");
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(executor.calls().await.is_empty());

    let recovered = handle
        .db()
        .get_run(&run.id)
        .await
        .expect("get run")
        .expect("run");
    assert_eq!(recovered.status, RunStatus::Interrupted);
    assert_eq!(
        recovered.status_reason.as_deref(),
        Some("daemon_crash_recovery")
    );
    let token = handle
        .db()
        .get_schedule_capability_token_by_hash(&sha256_hex(token_value.as_bytes()))
        .await
        .expect("get token")
        .expect("token");
    assert!(token.revoked_at.is_some());

    handle.shutdown().await;
    drop(temp_dir);
}

#[tokio::test]
async fn graceful_shutdown_cancels_or_interrupts_running_run() {
    let (_temp, handle, executor) = start_test_daemon(MockBehavior::hold_until_cancel()).await;

    let mut task = sample_task_dto("shutdown-running", TaskKind::Cron);
    task.next_run_at = Some(now_rfc3339());
    let created: TaskResult = rpc::call(
        &handle.socket_path(),
        METHOD_TASK_CREATE,
        TaskCreateParams { task, actor: None },
    )
    .await
    .expect("create task");
    assert!(executor.wait_for_calls(1, Duration::from_secs(2)).await);
    let call = executor
        .calls()
        .await
        .into_iter()
        .find(|call| call.task.id == created.task.id)
        .expect("executor call");
    let schedule_token = call.schedule_token.expect("schedule token");

    let db = handle.db();
    handle.shutdown().await;

    let runs = db.list_runs_for_task(&created.task.id).await.expect("runs");
    assert!(runs
        .iter()
        .any(|run| matches!(run.status, RunStatus::Canceled | RunStatus::Interrupted)));
    let token = db
        .get_schedule_capability_token_by_hash(&sha256_hex(schedule_token.as_bytes()))
        .await
        .expect("get token")
        .expect("token");
    assert!(token.revoked_at.is_some());
}

#[tokio::test]
async fn scheduler_disabled_keeps_manual_run_now_queued() {
    let (_temp, handle, executor) =
        start_test_daemon(MockBehavior::succeed_after(Duration::from_millis(10))).await;
    handle
        .db()
        .set_setting("scheduler.enabled", &false)
        .await
        .expect("disable scheduler");

    let task = sample_task_dto("manual-disabled", TaskKind::Manual);
    let created: TaskResult = rpc::call(
        &handle.socket_path(),
        METHOD_TASK_CREATE,
        TaskCreateParams { task, actor: None },
    )
    .await
    .expect("create task");
    let run: RunResult = rpc::call(
        &handle.socket_path(),
        METHOD_TASK_RUN_NOW,
        TaskIdParams {
            id: created.task.id.clone(),
            actor: None,
        },
    )
    .await
    .expect("run now");

    assert!(!executor.wait_for_calls(1, Duration::from_millis(150)).await);
    let stored = handle
        .db()
        .get_run(&run.run.id)
        .await
        .expect("get run")
        .expect("run");
    assert_eq!(stored.status, RunStatus::Queued);

    handle.shutdown().await;
}

#[tokio::test]
async fn setup_failure_marks_run_failed() {
    let (temp, handle, executor) =
        start_test_daemon(MockBehavior::succeed_after(Duration::from_millis(10))).await;
    let logs_dir = temp.path().join("logs");
    std::fs::remove_dir_all(&logs_dir).expect("remove logs dir");
    std::fs::write(&logs_dir, b"not a directory").expect("write logs file");

    let task = sample_task_dto("setup-failure", TaskKind::Manual);
    let created: TaskResult = rpc::call(
        &handle.socket_path(),
        METHOD_TASK_CREATE,
        TaskCreateParams { task, actor: None },
    )
    .await
    .expect("create task");
    let run: RunResult = rpc::call(
        &handle.socket_path(),
        METHOD_TASK_RUN_NOW,
        TaskIdParams {
            id: created.task.id.clone(),
            actor: None,
        },
    )
    .await
    .expect("run now");

    let runs = wait_for_task_runs(
        &handle,
        &created.task.id,
        |runs| {
            runs.iter().any(|stored| {
                stored.id == run.run.id
                    && stored.status == RunStatus::Failed
                    && stored.status_reason.as_deref() == Some("setup_failure")
            })
        },
        Duration::from_secs(2),
    )
    .await;
    assert!(runs.iter().any(|stored| stored.id == run.run.id
        && stored.status == RunStatus::Failed
        && stored.status_reason.as_deref() == Some("setup_failure")));
    assert!(executor.calls().await.is_empty());
    let events = handle
        .db()
        .list_run_events(&run.run.id)
        .await
        .expect("events");
    assert!(events
        .iter()
        .any(|event| event.event_type == "run.setup_failed"));

    handle.shutdown().await;
}

#[tokio::test]
async fn token_create_succeeds_and_max_create_limit_is_enforced() {
    let (_temp, handle, executor) = start_test_daemon(MockBehavior::hold_until_cancel()).await;
    let (source_task, token, run_id) = source_token(
        &handle,
        &executor,
        "token-source",
        vec![
            "schedule:create".to_owned(),
            "schedule:update-current".to_owned(),
        ],
    )
    .await;

    let create = sample_task_dto("token-created", TaskKind::Manual);
    let created: TaskResult = rpc::call(
        &handle.socket_path(),
        METHOD_TASK_CREATE,
        with_invocation_metadata(
            TaskCreateParams {
                task: create,
                actor: Some(RpcActor {
                    actor_type: AuditActorType::ScheduledRun,
                    actor_id: Some(run_id.clone()),
                }),
            },
            &token,
            &source_task.id,
            &run_id,
            "create from run",
        ),
    )
    .await
    .expect("token create");
    let stored = handle
        .db()
        .get_task(&created.task.id)
        .await
        .expect("get created")
        .expect("created");
    assert_eq!(stored.created_by, "codex");
    assert_eq!(stored.created_by_run_id.as_deref(), Some(run_id.as_str()));

    let mut token_row = handle
        .db()
        .get_schedule_capability_token_by_hash(&sha256_hex(token.as_bytes()))
        .await
        .expect("get token")
        .expect("token row");
    assert_eq!(token_row.create_count, 1);
    token_row.max_creates = 1;
    handle
        .db()
        .update_schedule_capability_token(&token_row)
        .await
        .expect("limit token");

    let denied = rpc::call_raw(
        &handle.socket_path(),
        METHOD_TASK_CREATE,
        with_invocation_metadata(
            TaskCreateParams {
                task: sample_task_dto("token-created-2", TaskKind::Manual),
                actor: Some(RpcActor {
                    actor_type: AuditActorType::ScheduledRun,
                    actor_id: Some(run_id.clone()),
                }),
            },
            &token,
            &source_task.id,
            &run_id,
            "second create",
        ),
    )
    .await
    .expect("denied response");
    let error = denied.error.expect("rpc error");
    assert_eq!(error.code, JsonRpcErrorCode::PermissionDenied.code());

    handle.shutdown().await;
}

#[tokio::test]
async fn token_create_without_capability_is_denied() {
    let (_temp, handle, executor) = start_test_daemon(MockBehavior::hold_until_cancel()).await;
    let (source_task, token, run_id) = source_token(
        &handle,
        &executor,
        "token-no-create",
        vec!["schedule:update-current".to_owned()],
    )
    .await;

    let denied = rpc::call_raw(
        &handle.socket_path(),
        METHOD_TASK_CREATE,
        with_invocation_metadata(
            TaskCreateParams {
                task: sample_task_dto("denied-create", TaskKind::Manual),
                actor: Some(RpcActor {
                    actor_type: AuditActorType::ScheduledRun,
                    actor_id: Some(run_id.clone()),
                }),
            },
            &token,
            &source_task.id,
            &run_id,
            "missing capability",
        ),
    )
    .await
    .expect("denied response");
    let error = denied.error.expect("rpc error");
    assert_eq!(error.code, JsonRpcErrorCode::PermissionDenied.code());

    handle.shutdown().await;
}

#[tokio::test]
async fn run_token_can_only_cancel_own_run_and_revokes_immediately() {
    let (_temp, handle, executor) = start_test_daemon(MockBehavior::hold_until_cancel()).await;
    let (source_task, token, run_id) = source_token(
        &handle,
        &executor,
        "token-cancel-source",
        vec!["schedule:update-any".to_owned()],
    )
    .await;

    let source_table = handle
        .db()
        .get_task(&source_task.id)
        .await
        .expect("get task")
        .expect("task");
    let mut other_run = sample_run(&source_table, RunStatus::Queued);
    other_run.scheduled_for = Some(format_utc_rfc3339(Utc::now() + ChronoDuration::hours(1)));
    handle
        .db()
        .create_run(&other_run)
        .await
        .expect("create other run");

    let denied = rpc::call_raw(
        &handle.socket_path(),
        METHOD_RUN_CANCEL,
        with_invocation_metadata(
            RunCancelParams {
                id: other_run.id.clone(),
                actor: Some(RpcActor {
                    actor_type: AuditActorType::ScheduledRun,
                    actor_id: Some(run_id.clone()),
                }),
            },
            &token,
            &source_task.id,
            &run_id,
            "cancel other run",
        ),
    )
    .await
    .expect("denied cancel response");
    let error = denied.error.expect("rpc error");
    assert_eq!(error.code, JsonRpcErrorCode::PermissionDenied.code());

    let canceled: RunResult = rpc::call(
        &handle.socket_path(),
        METHOD_RUN_CANCEL,
        with_invocation_metadata(
            RunCancelParams {
                id: run_id.clone(),
                actor: Some(RpcActor {
                    actor_type: AuditActorType::ScheduledRun,
                    actor_id: Some(run_id.clone()),
                }),
            },
            &token,
            &source_task.id,
            &run_id,
            "cancel own run",
        ),
    )
    .await
    .expect("cancel own run");
    assert_eq!(canceled.run.id, run_id);
    let token_row = handle
        .db()
        .get_schedule_capability_token_by_hash(&sha256_hex(token.as_bytes()))
        .await
        .expect("get token")
        .expect("token");
    assert!(token_row.revoked_at.is_some());

    handle.shutdown().await;
}

#[tokio::test]
async fn scheduled_run_untrusted_repo_path_create_is_saved_paused() {
    let (temp, handle, executor) = start_test_daemon(MockBehavior::hold_until_cancel()).await;
    let repo_path = temp.path().join("untrusted-repo");
    std::fs::create_dir_all(&repo_path).expect("repo dir");
    let (source_task, token, run_id) = source_token(
        &handle,
        &executor,
        "token-untrusted",
        vec!["schedule:create".to_owned()],
    )
    .await;

    let mut task = sample_task_dto("untrusted-created", TaskKind::Manual);
    task.target.mode = RunTargetMode::RepoLocal;
    task.target.repo_path = Some(repo_path.to_string_lossy().into_owned());
    let created: TaskResult = rpc::call(
        &handle.socket_path(),
        METHOD_TASK_CREATE,
        with_invocation_metadata(
            TaskCreateParams {
                task,
                actor: Some(RpcActor {
                    actor_type: AuditActorType::ScheduledRun,
                    actor_id: Some(run_id.clone()),
                }),
            },
            &token,
            &source_task.id,
            &run_id,
            "create untrusted",
        ),
    )
    .await
    .expect("create paused");

    let stored = handle
        .db()
        .get_task(&created.task.id)
        .await
        .expect("get task")
        .expect("task");
    assert_eq!(stored.status, TaskStatus::Paused);
    assert_eq!(
        stored.repo_path.as_deref(),
        Some(
            repo_path
                .canonicalize()
                .expect("canonical")
                .to_str()
                .unwrap()
        )
    );
    let audits = handle
        .db()
        .list_task_audit_events(&stored.id)
        .await
        .expect("audits");
    assert!(audits
        .iter()
        .any(|audit| audit.action == "task.review_required"
            && audit.reason.as_deref() == Some("untrusted_repo_path")));

    handle.shutdown().await;
}

#[tokio::test]
async fn human_untrusted_repo_path_create_is_validation_error() {
    let (temp, handle, _executor) =
        start_test_daemon(MockBehavior::succeed_after(Duration::from_millis(10))).await;
    let repo_path = temp.path().join("human-untrusted-repo");
    std::fs::create_dir_all(&repo_path).expect("repo dir");

    let mut task = sample_task_dto("human-untrusted", TaskKind::Manual);
    task.target.mode = RunTargetMode::RepoLocal;
    task.target.repo_path = Some(repo_path.to_string_lossy().into_owned());
    let denied = rpc::call_raw(
        &handle.socket_path(),
        METHOD_TASK_CREATE,
        TaskCreateParams {
            task,
            actor: Some(RpcActor {
                actor_type: AuditActorType::Cli,
                actor_id: None,
            }),
        },
    )
    .await
    .expect("denied response");
    let error = denied.error.expect("rpc error");
    assert_eq!(error.code, JsonRpcErrorCode::ValidationFailed.code());
    assert!(error.message.contains("project.trust is required"));

    handle.shutdown().await;
}

#[tokio::test]
async fn permanent_failure_is_not_retried() {
    let (_temp, handle, _executor) = start_test_daemon(MockBehavior {
        delay: Duration::from_millis(10),
        result: ExecutionResult::permanent_failed(),
        hold_until_cancel: false,
    })
    .await;

    let mut task = sample_task_dto("permanent-fail", TaskKind::Cron);
    task.next_run_at = Some(now_rfc3339());
    task.policies.max_retries = Some(1);
    let created: TaskResult = rpc::call(
        &handle.socket_path(),
        METHOD_TASK_CREATE,
        TaskCreateParams { task, actor: None },
    )
    .await
    .expect("create task");

    let runs = wait_for_task_runs(
        &handle,
        &created.task.id,
        |runs| runs.iter().any(|run| run.status == RunStatus::Failed),
        Duration::from_secs(2),
    )
    .await;
    assert!(runs.iter().any(|run| run.status == RunStatus::Failed));
    assert!(!runs
        .iter()
        .any(|run| run.trigger_type == TriggerType::Retry));

    handle.shutdown().await;
}

#[tokio::test]
async fn codex_executor_run_now_persists_runner_outcome_end_to_end() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let config = DaemonConfig::for_data_dir(temp_dir.path())
        .with_tick_interval(Duration::from_secs(3600))
        .with_due_grace(Duration::from_secs(5))
        .with_shutdown_grace(Duration::from_millis(20));
    let db = scheduler_core::db::SchedulerDb::connect(&config.paths.db_path)
        .await
        .expect("db");
    db.set_setting(
        "runner.codex_path",
        &codex_fixture("dummy-codex-success.sh")
            .to_string_lossy()
            .to_string(),
    )
    .await
    .expect("set codex path");
    drop(db);

    let executor_db = scheduler_core::db::SchedulerDb::connect(&config.paths.db_path)
        .await
        .expect("executor db");
    let executor =
        CodexExecutor::new(executor_db, config.paths.clone(), "0.1.0-test").with_app_cli_dir(None);
    let handle = start_daemon(config, Arc::new(executor))
        .await
        .expect("start daemon");

    let task = sample_task_dto("codex-e2e", TaskKind::Manual);
    let created: TaskResult = rpc::call(
        &handle.socket_path(),
        METHOD_TASK_CREATE,
        TaskCreateParams { task, actor: None },
    )
    .await
    .expect("create task");
    let queued: RunResult = rpc::call(
        &handle.socket_path(),
        METHOD_TASK_RUN_NOW,
        TaskIdParams {
            id: created.task.id.clone(),
            actor: None,
        },
    )
    .await
    .expect("run now");

    let runs = wait_for_task_runs(
        &handle,
        &created.task.id,
        |runs| {
            runs.iter()
                .any(|run| run.id == queued.run.id && run.status == RunStatus::Succeeded)
        },
        Duration::from_secs(5),
    )
    .await;
    let run = runs
        .into_iter()
        .find(|run| run.id == queued.run.id)
        .expect("stored run");
    assert_eq!(run.status, RunStatus::Succeeded);
    assert_eq!(run.exit_code, Some(0));
    assert_eq!(run.codex_session_id.as_deref(), Some("sess_dummy_success"));
    assert_eq!(run.result_summary.as_deref(), Some("done\n"));
    assert!(run
        .stdout_tail
        .as_deref()
        .unwrap_or_default()
        .contains("done"));
    assert!(run
        .stderr_tail
        .as_deref()
        .unwrap_or_default()
        .contains("prompt: Check project status."));
    assert!(run
        .last_message_path
        .as_deref()
        .is_some_and(|path| std::fs::read_to_string(path).unwrap_or_default() == "done\n"));

    let events = handle
        .db()
        .list_run_events(&run.id)
        .await
        .expect("run events");
    assert!(events.iter().any(|event| {
        event.source == RunEventSource::Daemon && event.event_type == "runner.process_started"
    }));
    assert!(events.iter().any(|event| {
        event.source == RunEventSource::CodexJsonl && event.event_type == "codex.json_event"
    }));

    handle.shutdown().await;
}
