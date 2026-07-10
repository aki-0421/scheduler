use std::process::{Command, Output};
use std::sync::Arc;
use std::time::Duration;

use chrono::{Duration as ChronoDuration, Utc};
use scheduler_core::db::SchedulerDb;
use scheduler_core::ipc::{JsonRpcErrorCode, METHOD_SETTINGS_SET};
use scheduler_core::model::{
    new_run_id, new_schedule_capability_token_id, AuditActorType, Run, RunStatus, RunTargetMode,
    ScheduleCapabilityToken, Task, TaskCodexDto, TaskDto, TaskKind, TaskPromptDto, TaskStatus,
    TaskTargetDto, TriggerType,
};
use scheduler_core::time::{format_utc_rfc3339, now_rfc3339};
use scheduler_core::util::sha256_hex;
use schedulerd::{start_daemon, DaemonConfig, DaemonHandle, MockExecutor};
use serde_json::{json, Value};
use tempfile::TempDir;

async fn start_test_daemon() -> (TempDir, DaemonHandle) {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let config = DaemonConfig::for_data_dir(temp_dir.path())
        .with_tick_interval(Duration::from_secs(3600))
        .with_due_grace(Duration::from_secs(5))
        .with_shutdown_grace(Duration::from_millis(20));
    let handle = start_daemon(config, Arc::new(MockExecutor::succeeding()))
        .await
        .expect("start daemon");
    (temp_dir, handle)
}

fn cli_output(temp_dir: &TempDir, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_codex-schedule"))
        .args(args)
        .env("CODEX_SCHEDULER_DATA_DIR", temp_dir.path())
        .env_remove("CODEX_SCHEDULER")
        .env_remove("CODEX_SCHEDULER_APP_VERSION")
        .env_remove("CODEX_SCHEDULER_DB")
        .env_remove("CODEX_SCHEDULER_SOCKET")
        .env_remove("CODEX_SCHEDULER_CURRENT_TASK_ID")
        .env_remove("CODEX_SCHEDULER_CURRENT_RUN_ID")
        .env_remove("CODEX_SCHEDULER_RUN_TOKEN")
        .env_remove("CODEX_SCHEDULER_TIMEZONE")
        .env_remove("CODEX_SCHEDULE_ALLOW_DIRECT_DB")
        .output()
        .expect("run codex-schedule")
}

fn cli_output_no_scheduler_env(temp_dir: &TempDir, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_codex-schedule"))
        .arg("--data-dir")
        .arg(temp_dir.path())
        .args(args)
        .env_remove("CODEX_SCHEDULER")
        .env_remove("CODEX_SCHEDULER_APP_VERSION")
        .env_remove("CODEX_SCHEDULER_DATA_DIR")
        .env_remove("CODEX_SCHEDULER_DB")
        .env_remove("CODEX_SCHEDULER_SOCKET")
        .env_remove("CODEX_SCHEDULER_CURRENT_TASK_ID")
        .env_remove("CODEX_SCHEDULER_CURRENT_RUN_ID")
        .env_remove("CODEX_SCHEDULER_RUN_TOKEN")
        .env_remove("CODEX_SCHEDULER_TIMEZONE")
        .env_remove("CODEX_SCHEDULE_ALLOW_DIRECT_DB")
        .output()
        .expect("run codex-schedule")
}

fn cli_output_direct_db_env(temp_dir: &TempDir, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_codex-schedule"))
        .arg("--data-dir")
        .arg(temp_dir.path())
        .args(args)
        .env_remove("CODEX_SCHEDULER")
        .env_remove("CODEX_SCHEDULER_APP_VERSION")
        .env_remove("CODEX_SCHEDULER_DATA_DIR")
        .env_remove("CODEX_SCHEDULER_DB")
        .env_remove("CODEX_SCHEDULER_SOCKET")
        .env_remove("CODEX_SCHEDULER_CURRENT_TASK_ID")
        .env_remove("CODEX_SCHEDULER_CURRENT_RUN_ID")
        .env_remove("CODEX_SCHEDULER_RUN_TOKEN")
        .env_remove("CODEX_SCHEDULER_TIMEZONE")
        .env("CODEX_SCHEDULE_ALLOW_DIRECT_DB", "1")
        .output()
        .expect("run codex-schedule")
}

fn cli_output_with_token(
    temp_dir: &TempDir,
    args: &[&str],
    task_id: &str,
    run_id: &str,
    token: &str,
) -> Output {
    Command::new(env!("CARGO_BIN_EXE_codex-schedule"))
        .args(args)
        .env("CODEX_SCHEDULER_DATA_DIR", temp_dir.path())
        .env("CODEX_SCHEDULER", "1")
        .env("CODEX_SCHEDULER_CURRENT_TASK_ID", task_id)
        .env("CODEX_SCHEDULER_CURRENT_RUN_ID", run_id)
        .env("CODEX_SCHEDULER_RUN_TOKEN", token)
        .env_remove("CODEX_SCHEDULE_ALLOW_DIRECT_DB")
        .output()
        .expect("run codex-schedule")
}

fn cli_output_scheduled_without_token(
    temp_dir: &TempDir,
    args: &[&str],
    task_id: &str,
    run_id: &str,
) -> Output {
    Command::new(env!("CARGO_BIN_EXE_codex-schedule"))
        .args(args)
        .env("CODEX_SCHEDULER_DATA_DIR", temp_dir.path())
        .env("CODEX_SCHEDULER", "1")
        .env("CODEX_SCHEDULER_CURRENT_TASK_ID", task_id)
        .env("CODEX_SCHEDULER_CURRENT_RUN_ID", run_id)
        .env_remove("CODEX_SCHEDULER_RUN_TOKEN")
        .env_remove("CODEX_SCHEDULE_ALLOW_DIRECT_DB")
        .output()
        .expect("run codex-schedule")
}

fn json_stdout(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).expect("json stdout")
}

fn sample_task_dto() -> TaskDto {
    TaskDto {
        id: String::new(),
        slug: "fallback-task".to_owned(),
        name: "fallback task".to_owned(),
        status: TaskStatus::Active,
        locked: false,
        kind: TaskKind::Manual,
        cron_expr: None,
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
            codex_path: None,
            model: None,
            reasoning_effort: None,
        },
        prompt: TaskPromptDto {
            body: "Fallback prompt.".to_owned(),
        },
    }
}

#[test]
fn task_help_only_exposes_customizable_codex_fields() {
    let temp_dir = tempfile::tempdir().expect("tempdir");

    for args in [["create", "--help"], ["update", "--help"]] {
        let output = cli_output(&temp_dir, &args);
        assert!(output.status.success());
        let help = String::from_utf8_lossy(&output.stdout);
        assert!(!help.contains("--description"));
        assert!(!help.contains("--clear-description"));
        assert!(help.contains("--codex-path"));
        for fixed_flag in [
            "--sandbox",
            "--approval-policy",
            "--allow-schedule-cli",
            "--max-runtime-sec",
            "--max-created-schedules",
            "--missed-policy",
            "--overlap-policy",
        ] {
            assert!(!help.contains(fixed_flag), "unexpected flag: {fixed_flag}");
        }
        if args[0] == "update" {
            assert!(help.contains("--clear-codex-path"));
        }
    }
}

async fn seed_schedule_token(
    handle: &DaemonHandle,
    task_id: &str,
    token: &str,
    capabilities: &[&str],
    create_count: i64,
    max_creates: i64,
) -> String {
    let now = now_rfc3339();
    let run = Run {
        id: new_run_id(),
        task_id: task_id.to_owned(),
        trigger_type: TriggerType::Manual,
        scheduled_for: None,
        attempt: 1,
        status: RunStatus::Succeeded,
        status_reason: None,
        queued_at: now.clone(),
        started_at: Some(now.clone()),
        ended_at: Some(now.clone()),
        duration_ms: Some(0),
        target_mode: RunTargetMode::Chat,
        workspace_path: None,
        worktree_path: None,
        branch_name: None,
        base_ref: None,
        commit_before: None,
        commit_after: None,
        codex_command_json: "{}".to_owned(),
        codex_session_id: None,
        pid: None,
        exit_code: Some(0),
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
        updated_at: now.clone(),
    };
    handle.db().create_run(&run).await.expect("seed run");

    let capabilities = capabilities
        .iter()
        .map(|capability| (*capability).to_owned())
        .collect::<Vec<_>>();
    let row = ScheduleCapabilityToken {
        id: new_schedule_capability_token_id(),
        run_id: run.id.clone(),
        task_id: task_id.to_owned(),
        token_hash: sha256_hex(token.as_bytes()),
        capabilities_json: serde_json::to_string(&capabilities).expect("capabilities json"),
        expires_at: format_utc_rfc3339(Utc::now() + ChronoDuration::hours(1)),
        max_creates,
        create_count,
        revoked_at: None,
        created_at: now,
    };
    handle
        .db()
        .create_schedule_capability_token(&row)
        .await
        .expect("seed schedule token");

    run.id
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn create_once_create_cron_and_list_json() {
    let (temp_dir, handle) = start_test_daemon().await;

    let once = cli_output(
        &temp_dir,
        &[
            "create",
            "--name",
            "once test",
            "--at",
            "2999-01-01T00:00:00Z",
            "--chat",
            "--prompt",
            "Check once.",
            "--json",
        ],
    );
    assert!(
        once.status.success(),
        "stderr={}",
        String::from_utf8_lossy(&once.stderr)
    );
    let once_json = json_stdout(&once);
    assert_eq!(once_json["ok"], true);
    assert_eq!(once_json["task"]["kind"], "once");
    assert!(once_json["task"].get("prompt").is_none());

    let cron = cli_output(
        &temp_dir,
        &[
            "create",
            "--name",
            "cron test",
            "--cron",
            "0 9 * * 1-5",
            "--timezone",
            "UTC",
            "--chat",
            "--prompt",
            "Check cron.",
            "--json",
        ],
    );
    assert!(
        cron.status.success(),
        "stderr={}",
        String::from_utf8_lossy(&cron.stderr)
    );
    let cron_json = json_stdout(&cron);
    assert_eq!(cron_json["ok"], true);
    assert_eq!(cron_json["task"]["kind"], "cron");
    assert_eq!(cron_json["task"]["cronExpr"], "0 9 * * 1-5");
    assert!(cron_json["task"].get("prompt").is_none());

    let list = cli_output(&temp_dir, &["list", "--json"]);
    assert!(
        list.status.success(),
        "stderr={}",
        String::from_utf8_lossy(&list.stderr)
    );
    let list_json = json_stdout(&list);
    assert_eq!(list_json["ok"], true);
    assert!(list_json["tasks"].as_array().expect("tasks").len() >= 2);
    assert!(list_json["tasks"]
        .as_array()
        .expect("tasks")
        .iter()
        .all(|task| task.get("prompt").is_none()));

    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn repo_target_always_uses_project_worktree_mode() {
    let (temp_dir, handle) = start_test_daemon().await;
    let repo = temp_dir.path().join("repo");
    init_git_repo(&repo);

    let created = cli_output(
        &temp_dir,
        &[
            "create",
            "--name",
            "project review",
            "--manual",
            "--repo",
            repo.to_str().expect("repo path"),
            "--prompt",
            "Review the project in an isolated worktree.",
            "--json",
        ],
    );
    assert!(
        created.status.success(),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&created.stdout),
        String::from_utf8_lossy(&created.stderr),
    );
    let value = json_stdout(&created);
    assert_eq!(value["task"]["targetMode"], "repo-worktree");

    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn update_current_uses_env_task_and_token() {
    let (temp_dir, handle) = start_test_daemon().await;

    let created = cli_output(
        &temp_dir,
        &[
            "create",
            "--name",
            "current task",
            "--manual",
            "--chat",
            "--prompt",
            "Current prompt.",
            "--json",
        ],
    );
    assert!(
        created.status.success(),
        "stderr={}",
        String::from_utf8_lossy(&created.stderr)
    );
    let created_json = json_stdout(&created);
    let task_id = created_json["task"]["id"].as_str().expect("task id");
    let token = "token_update_current_success";
    let run_id =
        seed_schedule_token(&handle, task_id, token, &["schedule:update-current"], 0, 5).await;

    let updated = cli_output_with_token(
        &temp_dir,
        &[
            "update-current",
            "--at",
            "2999-01-02T00:00:00Z",
            "--reason",
            "reschedule test",
            "--json",
        ],
        task_id,
        &run_id,
        token,
    );
    assert!(
        updated.status.success(),
        "stderr={}",
        String::from_utf8_lossy(&updated.stderr)
    );
    let updated_json = json_stdout(&updated);
    assert_eq!(updated_json["ok"], true);
    assert_eq!(updated_json["task"]["id"], task_id);
    assert_eq!(updated_json["task"]["kind"], "once");
    assert_eq!(updated_json["task"]["runAt"], "2999-01-02T00:00:00Z");

    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn update_current_without_capability_exits_4() {
    let (temp_dir, handle) = start_test_daemon().await;
    let created = cli_output(
        &temp_dir,
        &[
            "create",
            "--name",
            "capability denied task",
            "--manual",
            "--chat",
            "--prompt",
            "Current prompt.",
            "--json",
        ],
    );
    assert!(
        created.status.success(),
        "stderr={}",
        String::from_utf8_lossy(&created.stderr)
    );
    let created_json = json_stdout(&created);
    let task_id = created_json["task"]["id"].as_str().expect("task id");
    let token = "token_update_current_denied";
    let run_id = seed_schedule_token(&handle, task_id, token, &["schedule:create"], 0, 5).await;

    let denied = cli_output_with_token(
        &temp_dir,
        &["update-current", "--manual", "--json"],
        task_id,
        &run_id,
        token,
    );
    assert_eq!(denied.status.code(), Some(4));
    let value = json_stdout(&denied);
    assert_eq!(value["ok"], false);
    assert_eq!(value["error"]["code"], "permission_denied");

    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn create_with_token_over_max_creates_exits_4() {
    let (temp_dir, handle) = start_test_daemon().await;
    let source = cli_output(
        &temp_dir,
        &[
            "create",
            "--name",
            "source task",
            "--manual",
            "--chat",
            "--prompt",
            "Source prompt.",
            "--json",
        ],
    );
    assert!(
        source.status.success(),
        "stderr={}",
        String::from_utf8_lossy(&source.stderr)
    );
    let source_json = json_stdout(&source);
    let source_task_id = source_json["task"]["id"].as_str().expect("source task id");
    let token = "token_create_limit";
    let run_id =
        seed_schedule_token(&handle, source_task_id, token, &["schedule:create"], 1, 1).await;

    let denied = cli_output_with_token(
        &temp_dir,
        &[
            "create",
            "--name",
            "limit denied create",
            "--manual",
            "--chat",
            "--prompt",
            "Create should be denied.",
            "--json",
        ],
        source_task_id,
        &run_id,
        token,
    );
    assert_eq!(denied.status.code(), Some(4));
    let value = json_stdout(&denied);
    assert_eq!(value["ok"], false);
    assert_eq!(value["error"]["code"], "permission_denied");

    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn token_without_run_now_pause_or_delete_capability_exits_4() {
    let (temp_dir, handle) = start_test_daemon().await;
    let created = cli_output(
        &temp_dir,
        &[
            "create",
            "--name",
            "restricted token task",
            "--manual",
            "--chat",
            "--prompt",
            "Restricted prompt.",
            "--json",
        ],
    );
    assert!(
        created.status.success(),
        "stderr={}",
        String::from_utf8_lossy(&created.stderr)
    );
    let created_json = json_stdout(&created);
    let task_id = created_json["task"]["id"].as_str().expect("task id");
    let token = "token_control_denied";
    let run_id = seed_schedule_token(&handle, task_id, token, &["schedule:create"], 0, 5).await;

    for args in [
        vec!["run-now", task_id, "--json"],
        vec!["pause", task_id, "--json"],
        vec!["delete", task_id, "--json"],
    ] {
        let denied = cli_output_with_token(&temp_dir, &args, task_id, &run_id, token);
        assert_eq!(
            denied.status.code(),
            Some(4),
            "args={args:?} stderr={}",
            String::from_utf8_lossy(&denied.stderr)
        );
        let value = json_stdout(&denied);
        assert_eq!(value["ok"], false);
        assert_eq!(value["error"]["code"], "permission_denied");
    }

    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn scheduled_run_project_trust_and_settings_set_are_denied() {
    let (temp_dir, handle) = start_test_daemon().await;
    let created = cli_output(
        &temp_dir,
        &[
            "create",
            "--name",
            "scheduled control source",
            "--manual",
            "--chat",
            "--prompt",
            "Source prompt.",
            "--json",
        ],
    );
    assert!(
        created.status.success(),
        "stderr={}",
        String::from_utf8_lossy(&created.stderr)
    );
    let created_json = json_stdout(&created);
    let task_id = created_json["task"]["id"].as_str().expect("task id");
    let token = "token_control_rpc_denied";
    let run_id = seed_schedule_token(
        &handle,
        task_id,
        token,
        &["schedule:create", "schedule:update-any", "schedule:run-now"],
        0,
        5,
    )
    .await;

    let repo_path = temp_dir.path().join("repo");
    std::fs::create_dir_all(&repo_path).expect("repo dir");
    let trust_denied = cli_output_with_token(
        &temp_dir,
        &[
            "create",
            "--name",
            "repo create denied",
            "--manual",
            "--repo",
            repo_path.to_str().expect("repo path"),
            "--prompt",
            "Repo prompt.",
            "--json",
        ],
        task_id,
        &run_id,
        token,
    );
    assert_eq!(trust_denied.status.code(), Some(4));
    let value = json_stdout(&trust_denied);
    assert_eq!(value["ok"], false);
    assert_eq!(value["error"]["code"], "permission_denied");

    let settings_response = schedulerd::rpc::call_raw(
        &handle.socket_path(),
        METHOD_SETTINGS_SET,
        json!({
            "key": "scheduler.enabled",
            "value": false,
            "actor": {
                "actorType": "scheduled-run",
                "actorId": run_id,
            },
            "token": token,
            "currentTaskId": task_id,
            "currentRunId": run_id,
            "reason": "scheduled settings denied",
        }),
    )
    .await
    .expect("settings.set response");
    let error = settings_response.error.expect("settings.set error");
    assert_eq!(error.code, JsonRpcErrorCode::PermissionDenied.code());

    handle.shutdown().await;
}

#[tokio::test]
async fn list_falls_back_to_sqlite_when_daemon_unavailable() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db = SchedulerDb::connect(temp_dir.path().join("scheduler.sqlite3"))
        .await
        .expect("db");
    let task = Task::try_from(sample_task_dto()).expect("task");
    db.create_task(&task).await.expect("create task");
    drop(db);

    let output = cli_output(&temp_dir, &["list", "--json"]);
    assert!(
        output.status.success(),
        "stderr={}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value = json_stdout(&output);
    assert_eq!(value["ok"], true);
    assert_eq!(value["tasks"][0]["id"], task.id);
    assert!(value["tasks"][0].get("prompt").is_none());
}

#[tokio::test]
async fn write_without_direct_db_opt_in_requires_daemon_when_unavailable() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let output = cli_output_no_scheduler_env(
        &temp_dir,
        &[
            "create",
            "--name",
            "no direct db",
            "--manual",
            "--chat",
            "--prompt",
            "No direct DB.",
            "--json",
        ],
    );
    assert_eq!(output.status.code(), Some(3));
    let value = json_stdout(&output);
    assert_eq!(value["ok"], false);
    assert_eq!(value["error"]["code"], "daemon_unavailable");
}

#[tokio::test]
async fn create_manual_chat_falls_back_to_sqlite_with_direct_db_flag() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let output = cli_output_no_scheduler_env(
        &temp_dir,
        &[
            "--allow-direct-db",
            "create",
            "--name",
            "sqlite fallback",
            "--manual",
            "--chat",
            "--prompt",
            "Fallback without daemon.",
            "--codex-path",
            "/tmp/custom-codex",
            "--json",
        ],
    );
    assert!(
        output.status.success(),
        "stderr={}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value = json_stdout(&output);
    assert_eq!(value["ok"], true);
    let task_id = value["task"]["id"].as_str().expect("task id");

    let db = SchedulerDb::connect(temp_dir.path().join("scheduler.sqlite3"))
        .await
        .expect("db");
    let task = db.get_task(task_id).await.expect("get task").expect("task");
    assert_eq!(task.name, "sqlite fallback");
    assert_eq!(task.created_by, "cli");
    assert_eq!(task.codex_path.as_deref(), Some("/tmp/custom-codex"));
    assert_eq!(task.max_created_schedules_per_run, 0);
    assert_eq!(task.max_runtime_sec, 0);
    assert_eq!(task.max_retries, 0);
    let audits = db
        .list_task_audit_events(task_id)
        .await
        .expect("audit events");
    assert!(audits
        .iter()
        .any(|event| { event.actor_type == AuditActorType::Cli && event.action == "task.create" }));
    drop(db);

    let list = cli_output(&temp_dir, &["list", "--json"]);
    assert!(list.status.success());
    let list_json = json_stdout(&list);
    assert!(list_json["tasks"]
        .as_array()
        .expect("tasks")
        .iter()
        .any(|task| task["id"] == task_id));

    let next = cli_output(&temp_dir, &["next", task_id, "--json"]);
    assert!(next.status.success());
    let next_json = json_stdout(&next);
    assert_eq!(next_json["ok"], true);
    assert_eq!(next_json["times"].as_array().expect("times").len(), 0);
}

#[tokio::test]
async fn create_manual_chat_falls_back_to_sqlite_with_direct_db_env() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let output = cli_output_direct_db_env(
        &temp_dir,
        &[
            "create",
            "--name",
            "sqlite fallback env",
            "--manual",
            "--chat",
            "--prompt",
            "Fallback from env.",
            "--json",
        ],
    );
    assert!(
        output.status.success(),
        "stderr={}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value = json_stdout(&output);
    assert_eq!(value["ok"], true);
    assert_eq!(value["task"]["name"], "sqlite fallback env");
}

#[test]
fn scheduled_write_with_token_requires_daemon_when_unavailable() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let output = cli_output_with_token(
        &temp_dir,
        &[
            "create",
            "--name",
            "scheduled no daemon",
            "--manual",
            "--chat",
            "--prompt",
            "No daemon.",
            "--json",
        ],
        "task_test",
        "run_test",
        "token_test",
    );
    assert_eq!(output.status.code(), Some(3));
    let value = json_stdout(&output);
    assert_eq!(value["ok"], false);
    assert_eq!(value["error"]["code"], "daemon_unavailable");
}

#[test]
fn scheduled_write_with_direct_db_flag_is_denied_when_daemon_unavailable() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let output = cli_output_with_token(
        &temp_dir,
        &[
            "--allow-direct-db",
            "create",
            "--name",
            "scheduled direct denied",
            "--manual",
            "--chat",
            "--prompt",
            "Direct DB should be denied.",
            "--json",
        ],
        "task_test",
        "run_test",
        "token_test",
    );
    assert_eq!(output.status.code(), Some(4));
    let value = json_stdout(&output);
    assert_eq!(value["ok"], false);
    assert_eq!(value["error"]["code"], "permission_denied");
}

#[test]
fn scheduler_marker_without_token_is_denied_for_writes() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let output = Command::new(env!("CARGO_BIN_EXE_codex-schedule"))
        .arg("--data-dir")
        .arg(temp_dir.path())
        .args([
            "--allow-direct-db",
            "create",
            "--name",
            "scheduler marker denied",
            "--manual",
            "--chat",
            "--prompt",
            "Denied.",
            "--json",
        ])
        .env("CODEX_SCHEDULER", "1")
        .env_remove("CODEX_SCHEDULER_DATA_DIR")
        .env_remove("CODEX_SCHEDULER_CURRENT_TASK_ID")
        .env_remove("CODEX_SCHEDULER_CURRENT_RUN_ID")
        .env_remove("CODEX_SCHEDULER_RUN_TOKEN")
        .output()
        .expect("run codex-schedule");
    assert_eq!(output.status.code(), Some(4));
    let value = json_stdout(&output);
    assert_eq!(value["ok"], false);
    assert_eq!(value["error"]["code"], "permission_denied");
}

#[test]
fn invalid_cron_exits_8() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let output = cli_output(
        &temp_dir,
        &[
            "create",
            "--name",
            "bad cron",
            "--cron",
            "* * * * * *",
            "--chat",
            "--prompt",
            "Bad cron.",
            "--json",
        ],
    );
    assert_eq!(output.status.code(), Some(8));
    let value = json_stdout(&output);
    assert_eq!(value["ok"], false);
    assert_eq!(value["error"]["code"], "schedule_parse_error");
}

#[test]
fn clap_invalid_args_exit_2() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let output = cli_output(&temp_dir, &["--definitely-invalid", "--json"]);
    assert_eq!(output.status.code(), Some(2));
    let value = json_stdout(&output);
    assert_eq!(value["ok"], false);
    assert_eq!(value["error"]["code"], "invalid_arguments");
}

#[test]
fn removed_project_execution_flags_are_rejected() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    for removed_flag in ["--local", "--worktree"] {
        let output = cli_output(&temp_dir, &["create", removed_flag, "--json"]);
        assert_eq!(output.status.code(), Some(2), "flag={removed_flag}");
        let value = json_stdout(&output);
        assert_eq!(value["ok"], false);
        assert_eq!(value["error"]["code"], "invalid_arguments");
    }
}

#[test]
fn update_current_without_token_exits_4() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let output = Command::new(env!("CARGO_BIN_EXE_codex-schedule"))
        .args(["update-current", "--manual", "--json"])
        .env("CODEX_SCHEDULER_DATA_DIR", temp_dir.path())
        .env("CODEX_SCHEDULER_CURRENT_TASK_ID", "task_test")
        .env_remove("CODEX_SCHEDULER_RUN_TOKEN")
        .output()
        .expect("run update-current");
    assert_eq!(output.status.code(), Some(4));
    let value = json_stdout(&output);
    assert_eq!(value["ok"], false);
    assert_eq!(value["error"]["code"], "permission_denied");
}

#[test]
fn scheduled_write_without_token_exits_4_locally() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let output = cli_output_scheduled_without_token(
        &temp_dir,
        &[
            "create",
            "--name",
            "scheduled write no token",
            "--manual",
            "--chat",
            "--prompt",
            "No token.",
            "--json",
        ],
        "task_test",
        "run_test",
    );
    assert_eq!(output.status.code(), Some(4));
    let value = json_stdout(&output);
    assert_eq!(value["ok"], false);
    assert_eq!(value["error"]["code"], "permission_denied");
}

fn init_git_repo(path: &std::path::Path) {
    std::fs::create_dir_all(path).expect("create repo");
    for args in [
        vec!["init"],
        vec!["config", "user.name", "Scheduler Test"],
        vec!["config", "user.email", "scheduler@example.invalid"],
    ] {
        let output = Command::new("git")
            .args(args)
            .current_dir(path)
            .output()
            .expect("run git");
        assert!(output.status.success());
    }
    std::fs::write(path.join("README.md"), "test\n").expect("write readme");
    let add = Command::new("git")
        .args(["add", "README.md"])
        .current_dir(path)
        .output()
        .expect("git add");
    assert!(add.status.success());
    let commit = Command::new("git")
        .args(["commit", "-m", "initial"])
        .current_dir(path)
        .output()
        .expect("git commit");
    assert!(commit.status.success());
}
