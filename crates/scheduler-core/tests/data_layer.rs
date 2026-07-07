use scheduler_core::db::SchedulerDb;
use scheduler_core::model::*;
use scheduler_core::time::now_rfc3339;
use scheduler_core::util::{prompt_hash, unique_slug};
use scheduler_core::{SchedulerError, ValidationError};
use serde_json::json;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::fs;
use tempfile::TempDir;

async fn temp_db() -> (TempDir, SchedulerDb) {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("scheduler.sqlite3");
    let db = SchedulerDb::connect(&db_path).await.expect("connect db");
    (temp_dir, db)
}

fn sample_task(slug: &str) -> Task {
    let now = now_rfc3339();
    let prompt = "Summarize the project status.";
    Task {
        id: new_task_id(),
        slug: slug.to_owned(),
        name: "Status Summary".to_owned(),
        description: None,
        status: TaskStatus::Active,
        kind: TaskKind::Manual,
        cron_expr: None,
        run_at: None,
        timezone: "Asia/Tokyo".to_owned(),
        next_run_at: None,
        last_scheduled_for: None,
        schedule_status: ScheduleStatus::Valid,
        schedule_error: None,
        prompt_body: prompt.to_owned(),
        prompt_hash: prompt_hash(prompt),
        inject_scheduler_instructions: true,
        target_mode: RunTargetMode::Chat,
        project_id: None,
        repo_path: None,
        base_ref: None,
        model: Some("gpt-5-codex".to_owned()),
        reasoning_effort: Some("default".to_owned()),
        sandbox_mode: SandboxMode::ReadOnly,
        approval_policy: ApprovalPolicy::Never,
        allow_schedule_cli: true,
        schedule_cli_capabilities:
            r#"["schedule:create","schedule:update-current","schedule:list"]"#.to_owned(),
        missed_policy: MissedPolicy::LatestWithinWindow,
        missed_window_days: 7,
        overlap_policy: OverlapPolicy::Skip,
        max_runtime_sec: 7200,
        max_retries: 0,
        retry_backoff_sec: 300,
        cleanup_policy: CleanupPolicy::Keep,
        cleanup_after_days: None,
        created_by: "user".to_owned(),
        created_by_run_id: None,
        created_at: now.clone(),
        updated_at: now,
        deleted_at: None,
    }
}

fn sample_run(task_id: &str, scheduled_for: &str) -> Run {
    let now = now_rfc3339();
    Run {
        id: new_run_id(),
        task_id: task_id.to_owned(),
        trigger_type: TriggerType::Schedule,
        scheduled_for: Some(scheduled_for.to_owned()),
        attempt: 1,
        status: RunStatus::Queued,
        status_reason: None,
        queued_at: now.clone(),
        started_at: None,
        ended_at: None,
        duration_ms: None,
        target_mode: RunTargetMode::Chat,
        workspace_path: None,
        worktree_path: None,
        branch_name: None,
        base_ref: None,
        commit_before: None,
        commit_after: None,
        codex_command_json: "[]".to_owned(),
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
async fn migration_creates_v1_schema() {
    let (_temp_dir, db) = temp_db().await;

    let user_version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(db.pool())
        .await
        .expect("user_version");
    assert_eq!(user_version, 1);

    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name IN (
             'projects', 'tasks', 'runs', 'run_events', 'run_artifacts',
             'task_audit_events', 'schedule_capability_tokens', 'settings'
           )
         ORDER BY name",
    )
    .fetch_all(db.pool())
    .await
    .expect("tables");
    assert_eq!(
        tables,
        vec![
            "projects",
            "run_artifacts",
            "run_events",
            "runs",
            "schedule_capability_tokens",
            "settings",
            "task_audit_events",
            "tasks",
        ]
    );

    let indexes: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master
         WHERE type = 'index'
           AND name IN (
             'idx_tasks_status_next_run', 'idx_runs_task_started', 'idx_runs_status',
             'idx_audit_task_created', 'idx_events_run_index'
           )
         ORDER BY name",
    )
    .fetch_all(db.pool())
    .await
    .expect("indexes");
    assert_eq!(
        indexes,
        vec![
            "idx_audit_task_created",
            "idx_events_run_index",
            "idx_runs_status",
            "idx_runs_task_started",
            "idx_tasks_status_next_run",
        ]
    );

    let run_history_days: Option<i64> = db
        .get_setting("retention.run_history_days")
        .await
        .expect("setting");
    assert_eq!(run_history_days, Some(90));
}

#[tokio::test]
async fn task_crud_and_validation() {
    let (_temp_dir, db) = temp_db().await;
    let mut task = sample_task("status-summary");

    db.create_task(&task).await.expect("create task");
    let fetched = db
        .get_task(&task.id)
        .await
        .expect("get task")
        .expect("task exists");
    assert_eq!(fetched.name, "Status Summary");

    task.name = "Updated Status Summary".to_owned();
    task.status = TaskStatus::Paused;
    task.updated_at = now_rfc3339();
    assert!(db.update_task(&task).await.expect("update task"));
    let updated = db
        .get_task(&task.id)
        .await
        .expect("get updated")
        .expect("task exists");
    assert_eq!(updated.name, "Updated Status Summary");
    assert_eq!(updated.status, TaskStatus::Paused);

    let mut invalid_once = sample_task("invalid-once");
    invalid_once.kind = TaskKind::Once;
    let err = db
        .create_task(&invalid_once)
        .await
        .expect_err("run_at required");
    assert!(matches!(
        err,
        SchedulerError::Validation(ValidationError::MissingRunAt)
    ));

    let mut invalid_cron = sample_task("invalid-cron");
    invalid_cron.kind = TaskKind::Cron;
    let err = db
        .create_task(&invalid_cron)
        .await
        .expect_err("cron_expr required");
    assert!(matches!(
        err,
        SchedulerError::Validation(ValidationError::MissingCronExpr)
    ));

    let mut invalid_target = sample_task("invalid-target");
    invalid_target.target_mode = RunTargetMode::RepoLocal;
    let err = db
        .create_task(&invalid_target)
        .await
        .expect_err("repo target required");
    assert!(matches!(
        err,
        SchedulerError::Validation(ValidationError::MissingTarget)
    ));

    let mut invalid_worktree = sample_task("invalid-worktree");
    invalid_worktree.target_mode = RunTargetMode::RepoWorktree;
    invalid_worktree.repo_path = Some("/tmp/repo".to_owned());
    let err = db
        .create_task(&invalid_worktree)
        .await
        .expect_err("repo-worktree requires a git project_id");
    assert!(matches!(
        err,
        SchedulerError::Validation(ValidationError::RepoWorktreeRequiresGitProject)
    ));

    let deleted_at = now_rfc3339();
    assert!(db
        .delete_task(&task.id, &deleted_at)
        .await
        .expect("delete task"));
    let deleted = db
        .get_task(&task.id)
        .await
        .expect("get deleted")
        .expect("soft-deleted task exists");
    assert_eq!(deleted.status, TaskStatus::Deleted);
    assert_eq!(deleted.deleted_at.as_deref(), Some(deleted_at.as_str()));
}

#[tokio::test]
async fn idempotent_run_create_reuses_existing_row() {
    let (_temp_dir, db) = temp_db().await;
    let task = sample_task("run-source");
    db.create_task(&task).await.expect("create task");

    let scheduled_for = "2026-07-08T00:00:00Z";
    let first_run = sample_run(&task.id, scheduled_for);
    let first = db
        .create_run_idempotent(&first_run)
        .await
        .expect("first run");
    assert!(first.inserted);
    assert_eq!(first.value.id, first_run.id);

    let duplicate_run = sample_run(&task.id, scheduled_for);
    let duplicate = db
        .create_run_idempotent(&duplicate_run)
        .await
        .expect("duplicate run");
    assert!(!duplicate.inserted);
    assert_eq!(duplicate.value.id, first_run.id);

    let runs = db
        .list_runs_for_task(&task.id)
        .await
        .expect("runs for task");
    assert_eq!(runs.len(), 1);
}

#[tokio::test]
async fn manual_runs_use_regular_insert_not_idempotent_create() {
    let (_temp_dir, db) = temp_db().await;
    let task = sample_task("manual-run-source");
    db.create_task(&task).await.expect("create task");

    let mut first_run = sample_run(&task.id, "2026-07-08T00:00:00Z");
    first_run.trigger_type = TriggerType::Manual;
    first_run.scheduled_for = None;

    let err = db
        .create_run_idempotent(&first_run)
        .await
        .expect_err("manual run has no stable scheduled_for");
    assert!(matches!(
        err,
        SchedulerError::Validation(ValidationError::IdempotentRunRequiresScheduledFor)
    ));

    db.create_run(&first_run)
        .await
        .expect("insert first manual run");

    let mut second_run = first_run.clone();
    second_run.id = new_run_id();
    db.create_run(&second_run)
        .await
        .expect("insert second manual run");

    let runs = db
        .list_runs_for_task(&task.id)
        .await
        .expect("runs for task");
    assert_eq!(runs.len(), 2);
}

#[tokio::test]
async fn backup_is_created_only_when_existing_database_needs_migration() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("scheduler.sqlite3");
    let backup_dir = temp_dir.path().join("backups");

    let db = SchedulerDb::connect(&db_path)
        .await
        .expect("initial migration");
    drop(db);
    assert_eq!(backup_count(&backup_dir), 0);

    let db = SchedulerDb::connect(&db_path)
        .await
        .expect("no-op migration");
    drop(db);
    assert_eq!(backup_count(&backup_dir), 0);

    let legacy_path = temp_dir.path().join("legacy.sqlite3");
    fs::File::create(&legacy_path).expect("legacy placeholder");
    let db = SchedulerDb::connect(&legacy_path)
        .await
        .expect("legacy migration");
    drop(db);
    assert_eq!(backup_count(&backup_dir), 1);

    let inconsistent_path = temp_dir.path().join("user-version-only.sqlite3");
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(&inconsistent_path)
                .create_if_missing(true),
        )
        .await
        .expect("create inconsistent db");
    sqlx::query("PRAGMA user_version = 1")
        .execute(&pool)
        .await
        .expect("set user_version");
    pool.close().await;

    let db = SchedulerDb::connect(&inconsistent_path)
        .await
        .expect("migration with missing sqlx state");
    drop(db);
    assert_eq!(backup_count(&backup_dir), 2);
}

fn backup_count(backup_dir: &std::path::Path) -> usize {
    if !backup_dir.exists() {
        return 0;
    }

    fs::read_dir(backup_dir).expect("read backup dir").count()
}

#[test]
fn slug_generation_adds_collision_suffix() {
    let slug =
        unique_slug("Daily PR Review", ["daily-pr-review"].iter().copied()).expect("unique slug");
    assert_eq!(slug, "daily-pr-review-2");

    let long_name = "A".repeat(160);
    let existing = ["a".repeat(120)];
    let slug = unique_slug(&long_name, existing.iter().map(String::as_str)).expect("long slug");
    assert_eq!(slug.len(), 120);
    assert!(slug.ends_with("-2"));
}

#[tokio::test]
async fn settings_get_set_round_trip_json_values() {
    let (_temp_dir, db) = temp_db().await;

    let enabled: Option<bool> = db
        .get_setting("scheduler.enabled")
        .await
        .expect("missing ok");
    assert_eq!(enabled, None);

    db.set_setting("scheduler.enabled", &true)
        .await
        .expect("set bool");
    let enabled: Option<bool> = db.get_setting("scheduler.enabled").await.expect("get bool");
    assert_eq!(enabled, Some(true));

    db.set_setting("daemon.global_concurrency", &4_i64)
        .await
        .expect("set int");
    let concurrency: Option<i64> = db
        .get_setting("daemon.global_concurrency")
        .await
        .expect("get int");
    assert_eq!(concurrency, Some(4));
}

#[test]
fn task_and_run_dto_serialize_to_spec_camel_case_shape() {
    let mut task = sample_task("daily-pr-review");
    task.kind = TaskKind::Cron;
    task.cron_expr = Some("0 9 * * 1-5".to_owned());
    task.next_run_at = Some("2026-07-08T00:00:00Z".to_owned());
    task.target_mode = RunTargetMode::RepoWorktree;
    task.project_id = Some("proj_01900000-0000-7000-8000-000000000000".to_owned());
    task.repo_path = Some("/Users/alice/src/my-app".to_owned());
    task.base_ref = Some("main".to_owned());
    task.sandbox_mode = SandboxMode::WorkspaceWrite;

    let task_value = serde_json::to_value(TaskDto::from(&task)).expect("task dto json");
    assert_eq!(task_value["cronExpr"], json!("0 9 * * 1-5"));
    assert_eq!(task_value["nextRunAt"], json!("2026-07-08T00:00:00Z"));
    assert_eq!(task_value["target"]["mode"], json!("repo-worktree"));
    assert_eq!(task_value["target"]["projectId"], json!(task.project_id));
    assert_eq!(task_value["codex"]["sandboxMode"], json!("workspace-write"));
    assert_eq!(
        task_value["policies"]["missedPolicy"],
        json!("latest_within_window")
    );
    assert!(task_value.get("cron_expr").is_none());
    assert!(task_value["target"].get("project_id").is_none());

    let run = sample_run(&task.id, "2026-07-08T00:00:00Z");
    let run_value = serde_json::to_value(RunDto::from(&run)).expect("run dto json");
    assert_eq!(run_value["taskId"], json!(task.id));
    assert_eq!(run_value["triggerType"], json!("schedule"));
    assert_eq!(run_value["scheduledFor"], json!("2026-07-08T00:00:00Z"));
    assert_eq!(run_value["findingsCount"], json!(0));
    assert!(run_value.get("task_id").is_none());
}
