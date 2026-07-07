use std::sync::Arc;
use std::time::Duration;

use chrono::{Duration as ChronoDuration, Utc};
use scheduler_core::ipc::*;
use scheduler_core::model::*;
use scheduler_core::time::{format_utc_rfc3339, now_rfc3339};
use schedulerd::executor::{MockBehavior, MockExecutor};
use schedulerd::{rpc, start_daemon, DaemonConfig, DaemonHandle};
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

fn sample_task_table(slug: &str, kind: TaskKind) -> Task {
    Task::try_from(sample_task_dto(slug, kind)).expect("task from dto")
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
    tokio::time::sleep(Duration::from_millis(100)).await;

    let runs = handle
        .db()
        .list_runs_for_task(&created.task.id)
        .await
        .expect("runs");
    assert!(runs.iter().any(|run| {
        run.status == RunStatus::Skipped
            && run.status_reason.as_deref() == Some("previous_run_still_running")
    }));

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

    let db = handle.db();
    handle.shutdown().await;

    let runs = db.list_runs_for_task(&created.task.id).await.expect("runs");
    assert!(runs
        .iter()
        .any(|run| matches!(run.status, RunStatus::Canceled | RunStatus::Interrupted)));
}
