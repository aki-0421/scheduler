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
        locked: false,
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
        max_created_schedules_per_run: 5,
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
async fn migration_creates_v3_schema() {
    let (_temp_dir, db) = temp_db().await;

    let user_version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(db.pool())
        .await
        .expect("user_version");
    assert_eq!(user_version, 3);

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
async fn v3_migration_moves_git_tasks_to_worktrees_and_pauses_folder_tasks() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("scheduler.sqlite3");
    let db = SchedulerDb::connect(&db_path).await.expect("connect db");
    let now = now_rfc3339();
    let git_project = Project {
        id: new_project_id(),
        name: "git-project".to_owned(),
        path: "/tmp/git-project".to_owned(),
        kind: ProjectKind::Git,
        git_root: Some("/tmp/git-project".to_owned()),
        git_remote_url: None,
        default_branch: Some("main".to_owned()),
        trusted_at: Some(now.clone()),
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    let folder_project = Project {
        id: new_project_id(),
        name: "folder-project".to_owned(),
        path: "/tmp/folder-project".to_owned(),
        kind: ProjectKind::Folder,
        git_root: None,
        git_remote_url: None,
        default_branch: None,
        trusted_at: Some(now.clone()),
        created_at: now.clone(),
        updated_at: now,
    };
    db.create_project(&git_project).await.expect("git project");
    db.create_project(&folder_project)
        .await
        .expect("folder project");

    let git_task = sample_task("legacy-git-task");
    let worktree_task = sample_task("legacy-worktree-task");
    let folder_task = sample_task("legacy-folder-task");
    db.create_task(&git_task).await.expect("git task");
    db.create_task(&worktree_task).await.expect("worktree task");
    db.create_task(&folder_task).await.expect("folder task");
    sqlx::query(
        "UPDATE tasks SET target_mode = 'repo-local', project_id = ?, repo_path = ? WHERE id = ?",
    )
    .bind(&git_project.id)
    .bind(&git_project.path)
    .bind(&git_task.id)
    .execute(db.pool())
    .await
    .expect("legacy git target");
    sqlx::query(
        "UPDATE tasks SET target_mode = 'repo-worktree', project_id = ?, repo_path = ? WHERE id = ?",
    )
    .bind(&git_project.id)
    .bind("/tmp/git-project/subdirectory")
    .bind(&worktree_task.id)
    .execute(db.pool())
    .await
    .expect("legacy worktree target");
    sqlx::query(
        "UPDATE tasks SET target_mode = 'repo-local', project_id = ?, repo_path = ? WHERE id = ?",
    )
    .bind(&folder_project.id)
    .bind(&folder_project.path)
    .bind(&folder_task.id)
    .execute(db.pool())
    .await
    .expect("legacy folder target");
    sqlx::query("DELETE FROM _sqlx_migrations WHERE version = 3")
        .execute(db.pool())
        .await
        .expect("rewind migration record");
    sqlx::query("PRAGMA user_version = 2")
        .execute(db.pool())
        .await
        .expect("rewind user version");
    drop(db);

    let migrated = SchedulerDb::connect(&db_path)
        .await
        .expect("apply v3 migration");
    let migrated_git = migrated
        .get_task(&git_task.id)
        .await
        .expect("get git task")
        .expect("git task");
    assert_eq!(migrated_git.target_mode, RunTargetMode::RepoWorktree);
    assert_eq!(migrated_git.status, TaskStatus::Active);
    assert_eq!(
        migrated_git.repo_path.as_deref(),
        git_project.git_root.as_deref()
    );
    let migrated_worktree = migrated
        .get_task(&worktree_task.id)
        .await
        .expect("get worktree task")
        .expect("worktree task");
    assert_eq!(migrated_worktree.target_mode, RunTargetMode::RepoWorktree);
    assert_eq!(migrated_worktree.status, TaskStatus::Active);
    assert_eq!(
        migrated_worktree.repo_path.as_deref(),
        git_project.git_root.as_deref()
    );

    let migrated_folder = migrated
        .get_task(&folder_task.id)
        .await
        .expect("get folder task")
        .expect("folder task");
    assert_eq!(migrated_folder.target_mode, RunTargetMode::RepoLocal);
    assert_eq!(migrated_folder.status, TaskStatus::Paused);
    assert_eq!(migrated_folder.schedule_status, ScheduleStatus::Invalid);
    assert!(migrated_folder.schedule_error.is_some());
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
        .expect_err("local project targets are rejected");
    assert!(matches!(
        err,
        SchedulerError::Validation(ValidationError::ProjectTargetRequiresWorktree)
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
        SchedulerError::Validation(ValidationError::MissingTarget)
    ));

    let now = now_rfc3339();
    let folder_project = Project {
        id: new_project_id(),
        name: "folder".to_owned(),
        path: "/tmp/folder".to_owned(),
        kind: ProjectKind::Folder,
        git_root: None,
        git_remote_url: None,
        default_branch: None,
        trusted_at: Some(now.clone()),
        created_at: now.clone(),
        updated_at: now,
    };
    db.create_project(&folder_project)
        .await
        .expect("create legacy folder project");
    let mut invalid_folder_project = sample_task("invalid-folder-project");
    invalid_folder_project.target_mode = RunTargetMode::RepoWorktree;
    invalid_folder_project.project_id = Some(folder_project.id);
    invalid_folder_project.repo_path = Some("/tmp/folder".to_owned());
    let err = db
        .create_task(&invalid_folder_project)
        .await
        .expect_err("project worktree requires git");
    assert!(matches!(
        err,
        SchedulerError::Validation(ValidationError::RepoWorktreeRequiresGitProject)
    ));

    let now = now_rfc3339();
    let git_project = Project {
        id: new_project_id(),
        name: "git".to_owned(),
        path: "/tmp/git".to_owned(),
        kind: ProjectKind::Git,
        git_root: Some("/tmp/git".to_owned()),
        git_remote_url: None,
        default_branch: Some("main".to_owned()),
        trusted_at: Some(now.clone()),
        created_at: now.clone(),
        updated_at: now,
    };
    db.create_project(&git_project)
        .await
        .expect("create git project");
    let mut mismatched_project_path = sample_task("mismatched-project-path");
    mismatched_project_path.target_mode = RunTargetMode::RepoWorktree;
    mismatched_project_path.project_id = Some(git_project.id);
    mismatched_project_path.repo_path = Some("/tmp/other".to_owned());
    let err = db
        .create_task(&mismatched_project_path)
        .await
        .expect_err("project path must match registered git root");
    assert!(matches!(
        err,
        SchedulerError::Validation(ValidationError::ProjectTargetPathMismatch)
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
    assert_eq!(
        task_value["policies"]["maxCreatedSchedulesPerRun"],
        json!(5)
    );
    assert!(task_value.get("cron_expr").is_none());
    assert!(task_value["target"].get("project_id").is_none());

    let mut run = sample_run(&task.id, "2026-07-08T00:00:00Z");
    run.status_reason = Some("setup_failure".to_owned());
    run.queued_at = "2026-07-08T00:00:01Z".to_owned();
    run.duration_ms = Some(1234);
    run.target_mode = RunTargetMode::RepoWorktree;
    run.worktree_path = Some("/tmp/worktree".to_owned());
    run.branch_name = Some("codex/scheduler".to_owned());
    run.base_ref = Some("main".to_owned());
    run.commit_before = Some("abc123".to_owned());
    run.commit_after = Some("def456".to_owned());
    run.codex_session_id = Some("session_123".to_owned());
    run.exit_code = Some(1);
    run.signal = Some("SIGTERM".to_owned());
    run.stdout_log_path = Some("/tmp/stdout.log".to_owned());
    run.stderr_log_path = Some("/tmp/stderr.log".to_owned());
    run.events_jsonl_path = Some("/tmp/events.jsonl".to_owned());
    run.last_message_path = Some("/tmp/last-message.md".to_owned());
    run.stdout_tail = Some("out".to_owned());
    run.stderr_tail = Some("err".to_owned());
    let run_value = serde_json::to_value(RunDto::from(&run)).expect("run dto json");
    assert_eq!(run_value["taskId"], json!(task.id));
    assert_eq!(run_value["triggerType"], json!("schedule"));
    assert_eq!(run_value["scheduledFor"], json!("2026-07-08T00:00:00Z"));
    assert_eq!(run_value["statusReason"], json!("setup_failure"));
    assert_eq!(run_value["queuedAt"], json!("2026-07-08T00:00:01Z"));
    assert_eq!(run_value["durationMs"], json!(1234));
    assert_eq!(run_value["targetMode"], json!("repo-worktree"));
    assert_eq!(run_value["worktreePath"], json!("/tmp/worktree"));
    assert_eq!(run_value["branchName"], json!("codex/scheduler"));
    assert_eq!(run_value["baseRef"], json!("main"));
    assert_eq!(run_value["commitBefore"], json!("abc123"));
    assert_eq!(run_value["commitAfter"], json!("def456"));
    assert_eq!(run_value["exitCode"], json!(1));
    assert_eq!(run_value["signal"], json!("SIGTERM"));
    assert_eq!(run_value["stdoutTail"], json!("out"));
    assert_eq!(run_value["stderrTail"], json!("err"));
    assert_eq!(run_value["codexSessionId"], json!("session_123"));
    assert_eq!(run_value["stdoutLogPath"], json!("/tmp/stdout.log"));
    assert_eq!(run_value["stderrLogPath"], json!("/tmp/stderr.log"));
    assert_eq!(run_value["eventsJsonlPath"], json!("/tmp/events.jsonl"));
    assert_eq!(run_value["lastMessagePath"], json!("/tmp/last-message.md"));
    assert_eq!(run_value["findingsCount"], json!(0));
    assert!(run_value.get("task_id").is_none());

    let now = now_rfc3339();
    let project = Project {
        id: new_project_id(),
        name: "my-app".to_owned(),
        path: "/Users/alice/src/my-app".to_owned(),
        kind: ProjectKind::Git,
        git_root: Some("/Users/alice/src/my-app".to_owned()),
        git_remote_url: Some("git@example.com:my-app.git".to_owned()),
        default_branch: Some("main".to_owned()),
        trusted_at: Some(now.clone()),
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    let project_value = serde_json::to_value(ProjectDto::from(&project)).expect("project dto json");
    assert_eq!(project_value["gitRoot"], json!("/Users/alice/src/my-app"));
    assert_eq!(
        project_value["gitRemoteUrl"],
        json!("git@example.com:my-app.git")
    );
    assert_eq!(project_value["defaultBranch"], json!("main"));
    assert_eq!(project_value["trustedAt"], json!(now));
    assert!(project_value.get("git_root").is_none());

    let setting = Setting {
        key: "scheduler.enabled".to_owned(),
        value_json: "true".to_owned(),
        updated_at: now.clone(),
    };
    let setting_value = serde_json::to_value(SettingDto::from(&setting)).expect("setting dto json");
    assert_eq!(setting_value["valueJson"], json!("true"));
    assert_eq!(setting_value["updatedAt"], json!(now));
    assert!(setting_value.get("value_json").is_none());
}
