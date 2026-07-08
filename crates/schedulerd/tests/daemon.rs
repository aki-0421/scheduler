use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use chrono::{Duration as ChronoDuration, Utc};
use scheduler_core::ipc::*;
use scheduler_core::model::*;
use scheduler_core::settings::SETTING_RETENTION_RUN_HISTORY_DAYS;
use scheduler_core::time::{format_utc_rfc3339, now_rfc3339};
use scheduler_core::util::sha256_hex;
use schedulerd::executor::{MockBehavior, MockExecutor};
use schedulerd::{
    rpc, run_retention_cleanup, start_daemon, CodexExecutor, DaemonConfig, DaemonHandle,
    ExecutionResult,
};
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
            max_created_schedules_per_run: Some(5),
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

fn finished_run(task: &Task, status: RunStatus, ended_at: chrono::DateTime<Utc>) -> Run {
    let ended_at = format_utc_rfc3339(ended_at);
    let mut run = sample_run(task, status);
    run.scheduled_for = Some(format!("{}#{}", ended_at, run.id));
    run.queued_at = ended_at.clone();
    run.started_at = Some(ended_at.clone());
    run.ended_at = Some(ended_at.clone());
    run.created_at = ended_at.clone();
    run.updated_at = ended_at;
    run
}

fn run_git(cwd: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
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
async fn daemon_diagnostics_returns_runtime_state_over_uds() {
    let (temp, handle, _executor) =
        start_test_daemon(MockBehavior::succeed_after(Duration::from_millis(10))).await;
    handle.request_tick();

    let diagnostics: DaemonDiagnosticsResult = rpc::call(
        &handle.socket_path(),
        METHOD_DAEMON_DIAGNOSTICS,
        DaemonDiagnosticsParams {},
    )
    .await
    .expect("diagnostics rpc");

    assert_eq!(diagnostics.db_schema_version, 1);
    assert_eq!(
        diagnostics.data_dir,
        temp.path().to_string_lossy().into_owned()
    );
    assert_eq!(
        diagnostics.socket_path,
        handle.socket_path().to_string_lossy()
    );
    assert!(diagnostics.scheduler_enabled);
    assert_eq!(diagnostics.tick_interval_sec, 3600);
    assert!(diagnostics.last_tick_at.is_some());
    assert!(diagnostics.db_size_bytes > 0);

    handle.shutdown().await;
}

#[tokio::test]
async fn daemon_tick_now_triggers_scheduler_tick_over_uds() {
    let (_temp, handle, executor) =
        start_test_daemon(MockBehavior::succeed_after(Duration::from_millis(10))).await;

    let mut task = sample_task_dto("tick-now", TaskKind::Cron);
    task.next_run_at = Some(format_utc_rfc3339(Utc::now() + ChronoDuration::hours(1)));
    let created: TaskResult = rpc::call(
        &handle.socket_path(),
        METHOD_TASK_CREATE,
        TaskCreateParams { task, actor: None },
    )
    .await
    .expect("create task");
    let mut stored = handle
        .db()
        .get_task(&created.task.id)
        .await
        .expect("get task")
        .expect("task");
    stored.next_run_at = Some(now_rfc3339());
    stored.updated_at = now_rfc3339();
    handle.db().update_task(&stored).await.expect("update task");

    let mut triggered = false;
    for _ in 0..10 {
        let result: DaemonTickNowResult = rpc::call(
            &handle.socket_path(),
            METHOD_DAEMON_TICK_NOW,
            DaemonTickNowParams {},
        )
        .await
        .expect("tick now");
        assert!(result.ok);
        assert!(result.triggered);
        if executor.wait_for_calls(1, Duration::from_millis(250)).await {
            triggered = true;
            break;
        }
    }
    assert!(triggered);

    handle.shutdown().await;
}

#[tokio::test]
async fn task_audit_list_returns_task_audit_events_over_uds() {
    let (_temp, handle, _executor) =
        start_test_daemon(MockBehavior::succeed_after(Duration::from_millis(10))).await;

    let created: TaskResult = rpc::call(
        &handle.socket_path(),
        METHOD_TASK_CREATE,
        TaskCreateParams {
            task: sample_task_dto("audited-task", TaskKind::Manual),
            actor: None,
        },
    )
    .await
    .expect("create task");

    let audits: TaskAuditListResult = rpc::call(
        &handle.socket_path(),
        METHOD_TASK_AUDIT_LIST,
        TaskAuditListParams {
            task_id: created.task.id.clone(),
            limit: Some(50),
        },
    )
    .await
    .expect("audit list");

    assert_eq!(audits.audit_events.len(), 1);
    let event = &audits.audit_events[0];
    assert_eq!(event.task_id, created.task.id);
    assert_eq!(event.actor_type, AuditActorType::User);
    assert_eq!(event.action, "task.create");
    assert!(event.before_json.is_none());
    assert!(event.after_json.is_some());
    assert!(!event.created_at.is_empty());

    handle.shutdown().await;
}

#[tokio::test]
async fn project_untrust_clears_trusted_at_in_project_list_and_counts_active_tasks() {
    let (temp, handle, executor) = start_test_daemon(MockBehavior::hold_until_cancel()).await;
    let project_path = temp.path().join("trusted-project");
    std::fs::create_dir_all(&project_path).expect("create project dir");

    let trusted: ProjectTrustResult = rpc::call(
        &handle.socket_path(),
        METHOD_PROJECT_TRUST,
        ProjectTrustParams {
            path: project_path.to_string_lossy().into_owned(),
            actor: None,
        },
    )
    .await
    .expect("trust project");
    assert!(trusted.project.trusted_at.is_some());

    let mut task = sample_task_dto("untrust-affected", TaskKind::Manual);
    task.target.mode = RunTargetMode::RepoLocal;
    task.target.project_id = Some(trusted.project.id.clone());
    let created: TaskResult = rpc::call(
        &handle.socket_path(),
        METHOD_TASK_CREATE,
        TaskCreateParams { task, actor: None },
    )
    .await
    .expect("create affected task");

    let untrusted: ProjectUntrustResult = rpc::call(
        &handle.socket_path(),
        METHOD_PROJECT_UNTRUST,
        ProjectUntrustParams {
            project_id: trusted.project.id.clone(),
            actor: Some(RpcActor {
                actor_type: AuditActorType::Cli,
                actor_id: Some("scheduler-cli".to_owned()),
            }),
        },
    )
    .await
    .expect("untrust project");
    assert_eq!(untrusted.project.id, trusted.project.id);
    assert!(untrusted.project.trusted_at.is_none());
    assert_eq!(untrusted.affected_task_count, 1);

    let projects: ProjectListResult = rpc::call(
        &handle.socket_path(),
        METHOD_PROJECT_LIST,
        ProjectListParams {},
    )
    .await
    .expect("project list");
    let listed = projects
        .projects
        .iter()
        .find(|project| project.id == trusted.project.id)
        .expect("listed project");
    assert!(listed.trusted_at.is_none());

    let stored_task = handle
        .db()
        .get_task(&created.task.id)
        .await
        .expect("get affected task")
        .expect("affected task");
    assert_eq!(stored_task.status, TaskStatus::Active);
    assert_eq!(
        stored_task.project_id.as_deref(),
        Some(trusted.project.id.as_str())
    );

    let audit: (String, String, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT action, actor_type, task_id, after_json
         FROM task_audit_events
         WHERE action = 'project.untrust'
         ORDER BY created_at DESC, id DESC
         LIMIT 1",
    )
    .fetch_one(handle.db().pool())
    .await
    .expect("project untrust audit");
    assert_eq!(audit.0, "project.untrust");
    assert_eq!(audit.1, "cli");
    assert!(audit.2.is_none());
    let after_json: Value =
        serde_json::from_str(audit.3.as_deref().expect("after json")).expect("after value");
    assert_eq!(after_json["affectedTaskCount"], json!(1));
    assert_eq!(after_json["project"]["id"], json!(trusted.project.id));

    let retrusted: ProjectTrustResult = rpc::call(
        &handle.socket_path(),
        METHOD_PROJECT_TRUST,
        ProjectTrustParams {
            path: project_path.to_string_lossy().into_owned(),
            actor: None,
        },
    )
    .await
    .expect("retrust project");
    assert_eq!(retrusted.project.id, trusted.project.id);
    assert!(retrusted.project.trusted_at.is_some());

    let (source_task, token, run_id) = source_token(
        &handle,
        &executor,
        "untrust-token-source",
        vec!["schedule:update-any".to_owned()],
    )
    .await;

    let denied = rpc::call_raw(
        &handle.socket_path(),
        METHOD_PROJECT_UNTRUST,
        with_invocation_metadata(
            ProjectUntrustParams {
                project_id: retrusted.project.id.clone(),
                actor: Some(RpcActor {
                    actor_type: AuditActorType::ScheduledRun,
                    actor_id: Some(run_id.clone()),
                }),
            },
            &token,
            &source_task.id,
            &run_id,
            "untrust from scheduled run",
        ),
    )
    .await
    .expect("denied response");
    let error = denied.error.expect("rpc error");
    assert_eq!(error.code, JsonRpcErrorCode::PermissionDenied.code());

    let stored = handle
        .db()
        .get_project(&retrusted.project.id)
        .await
        .expect("get project")
        .expect("project");
    assert!(stored.trusted_at.is_some());

    handle.shutdown().await;
}

#[tokio::test]
async fn retention_cleanup_removes_expired_runs_logs_and_tokens() {
    let (temp, handle, _executor) =
        start_test_daemon(MockBehavior::succeed_after(Duration::from_millis(10))).await;
    let db = handle.db();
    db.set_setting(SETTING_RETENTION_RUN_HISTORY_DAYS, &365_i64)
        .await
        .expect("set run history retention");

    let task = sample_task_table("retention-source", TaskKind::Manual);
    db.create_task(&task).await.expect("create task");

    let now = Utc::now();
    let old_history = finished_run(&task, RunStatus::Succeeded, now - ChronoDuration::days(366));
    let old_success_logs =
        finished_run(&task, RunStatus::Succeeded, now - ChronoDuration::days(31));
    let recent_success_logs =
        finished_run(&task, RunStatus::Succeeded, now - ChronoDuration::days(29));
    let old_failed_logs = finished_run(&task, RunStatus::Failed, now - ChronoDuration::days(181));
    let recent_failed_logs =
        finished_run(&task, RunStatus::Failed, now - ChronoDuration::days(179));
    let running_old = finished_run(&task, RunStatus::Running, now - ChronoDuration::days(500));
    let runs = [
        old_history.clone(),
        old_success_logs.clone(),
        recent_success_logs.clone(),
        old_failed_logs.clone(),
        recent_failed_logs.clone(),
        running_old.clone(),
    ];
    for run in &runs {
        db.create_run(run).await.expect("create run");
        let log_dir = temp.path().join("logs").join(&run.id);
        std::fs::create_dir_all(&log_dir).expect("create run logs dir");
        std::fs::write(log_dir.join("stdout.log"), b"stdout").expect("write stdout");
    }

    db.create_run_event(&RunEvent {
        id: new_run_event_id(),
        run_id: old_history.id.clone(),
        event_index: 0,
        source: RunEventSource::Daemon,
        level: "info".to_owned(),
        event_type: "test.event".to_owned(),
        message: Some("old".to_owned()),
        payload_json: Some(json!({ "old": true }).to_string()),
        created_at: old_history.created_at.clone(),
    })
    .await
    .expect("create event");
    db.create_run_artifact(&RunArtifact {
        id: new_run_artifact_id(),
        run_id: old_history.id.clone(),
        kind: RunArtifactKind::Log,
        path: "logs/old".to_owned(),
        title: None,
        mime_type: None,
        size_bytes: Some(1),
        created_at: old_history.created_at.clone(),
    })
    .await
    .expect("create artifact");

    let token_run = recent_success_logs.clone();
    db.create_schedule_capability_token(&ScheduleCapabilityToken {
        id: new_schedule_capability_token_id(),
        run_id: token_run.id.clone(),
        task_id: task.id.clone(),
        token_hash: sha256_hex(b"old-token"),
        capabilities_json: "[]".to_owned(),
        expires_at: format_utc_rfc3339(now - ChronoDuration::hours(25)),
        max_creates: 5,
        create_count: 0,
        revoked_at: None,
        created_at: format_utc_rfc3339(now - ChronoDuration::hours(26)),
    })
    .await
    .expect("create old token");
    let kept_token_id = new_schedule_capability_token_id();
    db.create_schedule_capability_token(&ScheduleCapabilityToken {
        id: kept_token_id.clone(),
        run_id: token_run.id.clone(),
        task_id: task.id.clone(),
        token_hash: sha256_hex(b"kept-token"),
        capabilities_json: "[]".to_owned(),
        expires_at: format_utc_rfc3339(now - ChronoDuration::hours(23)),
        max_creates: 5,
        create_count: 0,
        revoked_at: None,
        created_at: format_utc_rfc3339(now - ChronoDuration::hours(24)),
    })
    .await
    .expect("create kept token");

    let paths = DaemonConfig::for_data_dir(temp.path()).paths;
    let result = run_retention_cleanup(&db, &paths, now)
        .await
        .expect("retention cleanup");

    assert_eq!(result.capability_tokens_deleted, 1);
    assert_eq!(result.run_history.runs_deleted, 1);
    assert_eq!(result.run_history.run_events_deleted, 1);
    assert_eq!(result.run_history.run_artifacts_deleted, 1);
    assert!(db
        .get_run(&old_history.id)
        .await
        .expect("get old history")
        .is_none());
    assert!(db
        .get_run(&running_old.id)
        .await
        .expect("get running")
        .is_some());
    assert!(db
        .get_schedule_capability_token(&kept_token_id)
        .await
        .expect("get kept token")
        .is_some());

    assert!(!temp.path().join("logs").join(&old_history.id).exists());
    assert!(!temp.path().join("logs").join(&old_success_logs.id).exists());
    assert!(temp
        .path()
        .join("logs")
        .join(&recent_success_logs.id)
        .exists());
    assert!(!temp.path().join("logs").join(&old_failed_logs.id).exists());
    assert!(temp
        .path()
        .join("logs")
        .join(&recent_failed_logs.id)
        .exists());

    handle.shutdown().await;
}

#[tokio::test]
async fn retention_cleanup_removes_clean_delete_after_days_worktree_and_skips_dirty() {
    let (temp, handle, _executor) =
        start_test_daemon(MockBehavior::succeed_after(Duration::from_millis(10))).await;
    let db = handle.db();
    let now = Utc::now();

    let repo = temp.path().join("repo");
    std::fs::create_dir_all(&repo).expect("create repo");
    run_git(&repo, &["init"]);
    run_git(&repo, &["config", "user.email", "scheduler@example.com"]);
    run_git(&repo, &["config", "user.name", "Scheduler Test"]);
    std::fs::write(repo.join("README.md"), "hello\n").expect("write readme");
    run_git(&repo, &["add", "README.md"]);
    run_git(&repo, &["commit", "-m", "initial"]);
    let repo = std::fs::canonicalize(&repo).expect("canonical repo");

    let project = Project {
        id: new_project_id(),
        name: "repo".to_owned(),
        path: repo.to_string_lossy().into_owned(),
        kind: ProjectKind::Git,
        git_root: Some(repo.to_string_lossy().into_owned()),
        git_remote_url: None,
        default_branch: None,
        trusted_at: Some(now_rfc3339()),
        created_at: now_rfc3339(),
        updated_at: now_rfc3339(),
    };
    db.create_project(&project).await.expect("create project");

    let mut task = sample_task_table("worktree-retention", TaskKind::Manual);
    task.target_mode = RunTargetMode::RepoWorktree;
    task.project_id = Some(project.id.clone());
    task.repo_path = Some(repo.to_string_lossy().into_owned());
    task.cleanup_policy = CleanupPolicy::DeleteAfterDays;
    task.cleanup_after_days = Some(1);
    db.create_task(&task).await.expect("create task");

    let worktrees_root = temp.path().join("worktrees").join(&task.slug);
    std::fs::create_dir_all(&worktrees_root).expect("create worktrees root");
    let clean_worktree = worktrees_root.join("clean");
    let dirty_worktree = worktrees_root.join("dirty");
    run_git(
        &repo,
        &[
            "worktree",
            "add",
            "-b",
            "scheduler-clean",
            clean_worktree.to_str().expect("clean path"),
            "HEAD",
        ],
    );
    run_git(
        &repo,
        &[
            "worktree",
            "add",
            "-b",
            "scheduler-dirty",
            dirty_worktree.to_str().expect("dirty path"),
            "HEAD",
        ],
    );
    std::fs::write(dirty_worktree.join("dirty.txt"), "dirty\n").expect("dirty file");

    let mut clean_run = finished_run(&task, RunStatus::Succeeded, now - ChronoDuration::days(2));
    clean_run.target_mode = RunTargetMode::RepoWorktree;
    clean_run.workspace_path = Some(clean_worktree.to_string_lossy().into_owned());
    clean_run.worktree_path = Some(
        std::fs::canonicalize(&clean_worktree)
            .expect("canonical clean")
            .to_string_lossy()
            .into_owned(),
    );
    let mut dirty_run = finished_run(&task, RunStatus::Succeeded, now - ChronoDuration::days(2));
    dirty_run.target_mode = RunTargetMode::RepoWorktree;
    dirty_run.workspace_path = Some(dirty_worktree.to_string_lossy().into_owned());
    dirty_run.worktree_path = Some(
        std::fs::canonicalize(&dirty_worktree)
            .expect("canonical dirty")
            .to_string_lossy()
            .into_owned(),
    );
    db.create_run(&clean_run).await.expect("create clean run");
    db.create_run(&dirty_run).await.expect("create dirty run");

    let paths = DaemonConfig::for_data_dir(temp.path()).paths;
    let result = run_retention_cleanup(&db, &paths, now)
        .await
        .expect("retention cleanup");

    assert_eq!(result.worktrees_deleted, 1);
    assert_eq!(result.worktrees_skipped_dirty, 1);
    assert!(!clean_worktree.exists());
    assert!(dirty_worktree.exists());
    assert!(db
        .get_run(&clean_run.id)
        .await
        .expect("clean run")
        .expect("clean run exists")
        .worktree_path
        .is_none());
    assert!(db
        .get_run(&dirty_run.id)
        .await
        .expect("dirty run")
        .expect("dirty run exists")
        .worktree_path
        .is_some());

    run_git(
        &repo,
        &[
            "worktree",
            "remove",
            "--force",
            dirty_worktree.to_str().unwrap(),
        ],
    );
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
async fn run_tail_log_reads_large_file_from_cursor_with_bounded_chunks() {
    let (temp, handle, _executor) =
        start_test_daemon(MockBehavior::succeed_after(Duration::from_millis(10))).await;

    let task = sample_task_table("tail-large", TaskKind::Manual);
    handle.db().create_task(&task).await.expect("create task");
    let log_dir = temp.path().join("logs").join("tail-large-run");
    std::fs::create_dir_all(&log_dir).expect("create log dir");
    let stdout_path = log_dir.join("stdout.log");
    let mut bytes = vec![b'a'; 70 * 1024];
    bytes.extend_from_slice("あZ".as_bytes());
    std::fs::write(&stdout_path, &bytes).expect("write stdout");

    let mut run = sample_run(&task, RunStatus::Succeeded);
    run.id = "run_tail_large".to_owned();
    run.stdout_log_path = Some(stdout_path.to_string_lossy().into_owned());
    handle.db().create_run(&run).await.expect("create run");

    let first: RunTailLogResult = rpc::call(
        &handle.socket_path(),
        METHOD_RUN_TAIL_LOG,
        RunTailLogParams {
            run_id: run.id.clone(),
            stream: LogStream::Stdout,
            cursor: Some(0),
            limit: Some(32 * 1024),
        },
    )
    .await
    .expect("tail first chunk");
    assert_eq!(first.next_cursor, 32 * 1024);
    assert!(!first.eof);
    assert_eq!(first.data.len(), 32 * 1024);

    let second: RunTailLogResult = rpc::call(
        &handle.socket_path(),
        METHOD_RUN_TAIL_LOG,
        RunTailLogParams {
            run_id: run.id.clone(),
            stream: LogStream::Stdout,
            cursor: Some(first.next_cursor),
            limit: Some(32 * 1024),
        },
    )
    .await
    .expect("tail second chunk");
    assert_eq!(second.cursor, first.next_cursor);
    assert_eq!(second.next_cursor, 64 * 1024);
    assert!(!second.eof);
    assert_eq!(second.data.len(), 32 * 1024);

    let split_utf8: RunTailLogResult = rpc::call(
        &handle.socket_path(),
        METHOD_RUN_TAIL_LOG,
        RunTailLogParams {
            run_id: run.id.clone(),
            stream: LogStream::Stdout,
            cursor: Some((70 * 1024) as u64),
            limit: Some(1),
        },
    )
    .await
    .expect("tail split utf8");
    assert_eq!(split_utf8.next_cursor, (70 * 1024 + 1) as u64);
    assert!(!split_utf8.eof);
    assert_eq!(split_utf8.data, "\u{fffd}");

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
    stored.next_run_at = Some(format_utc_rfc3339(Utc::now() - ChronoDuration::seconds(1)));
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
async fn run_token_uses_task_max_created_schedules_per_run() {
    let (_temp, handle, executor) = start_test_daemon(MockBehavior::hold_until_cancel()).await;

    let mut task = sample_task_dto("token-max-creates", TaskKind::Cron);
    task.next_run_at = Some(now_rfc3339());
    task.policies.max_created_schedules_per_run = Some(17);
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
    let token = call.schedule_token.expect("schedule token");
    let token_row = handle
        .db()
        .get_schedule_capability_token_by_hash(&sha256_hex(token.as_bytes()))
        .await
        .expect("get token")
        .expect("token");
    assert_eq!(token_row.max_creates, 17);

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

    let detail: RunResult = rpc::call(
        &handle.socket_path(),
        METHOD_RUN_GET,
        RunGetParams { id: run.id.clone() },
    )
    .await
    .expect("run get");
    assert!(detail.artifacts.iter().any(|artifact| {
        artifact.kind == RunArtifactKind::Log && artifact.path.ends_with("events.jsonl")
    }));
    assert!(detail
        .artifacts
        .iter()
        .any(|artifact| artifact.kind == RunArtifactKind::LastMessage));

    let events_tail: RunTailLogResult = rpc::call(
        &handle.socket_path(),
        METHOD_RUN_TAIL_LOG,
        RunTailLogParams {
            run_id: run.id.clone(),
            stream: LogStream::Events,
            cursor: Some(0),
            limit: Some(4096),
        },
    )
    .await
    .expect("tail events");
    assert!(events_tail.data.contains("sess_dummy_success"));

    handle.shutdown().await;
}
