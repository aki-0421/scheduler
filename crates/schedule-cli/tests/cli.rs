use std::process::{Command, Output};
use std::sync::Arc;
use std::time::Duration;

use scheduler_core::db::SchedulerDb;
use scheduler_core::model::{
    ApprovalPolicy, CleanupPolicy, MissedPolicy, OverlapPolicy, RunTargetMode, SandboxMode, Task,
    TaskCodexDto, TaskDto, TaskKind, TaskPoliciesDto, TaskPromptDto, TaskStatus, TaskTargetDto,
};
use schedulerd::{start_daemon, DaemonConfig, DaemonHandle, MockExecutor};
use serde_json::Value;
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
        description: None,
        status: TaskStatus::Active,
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
            model: None,
            reasoning_effort: None,
            sandbox_mode: SandboxMode::ReadOnly,
            approval_policy: ApprovalPolicy::Never,
        },
        prompt: TaskPromptDto {
            body: "Fallback prompt.".to_owned(),
            inject_scheduler_instructions: true,
        },
        policies: TaskPoliciesDto {
            allow_schedule_cli: true,
            missed_policy: MissedPolicy::LatestWithinWindow,
            overlap_policy: OverlapPolicy::Skip,
            max_runtime_sec: 7200,
            schedule_cli_capabilities: Some(vec!["schedule:list".to_owned()]),
            missed_window_days: Some(7),
            max_retries: Some(0),
            retry_backoff_sec: Some(300),
            cleanup_policy: Some(CleanupPolicy::Keep),
            cleanup_after_days: None,
        },
    }
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

    let list = cli_output(&temp_dir, &["list", "--json"]);
    assert!(
        list.status.success(),
        "stderr={}",
        String::from_utf8_lossy(&list.stderr)
    );
    let list_json = json_stdout(&list);
    assert_eq!(list_json["ok"], true);
    assert!(list_json["tasks"].as_array().expect("tasks").len() >= 2);

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

    let updated = Command::new(env!("CARGO_BIN_EXE_codex-schedule"))
        .args([
            "update-current",
            "--at",
            "2999-01-02T00:00:00Z",
            "--reason",
            "reschedule test",
            "--json",
        ])
        .env("CODEX_SCHEDULER_DATA_DIR", temp_dir.path())
        .env("CODEX_SCHEDULER_CURRENT_TASK_ID", task_id)
        .env("CODEX_SCHEDULER_CURRENT_RUN_ID", "run_test")
        .env("CODEX_SCHEDULER_RUN_TOKEN", "token_test")
        .output()
        .expect("run update-current");
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
}

#[test]
fn write_command_requires_daemon_when_unavailable() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let output = cli_output(
        &temp_dir,
        &[
            "create",
            "--name",
            "no daemon",
            "--manual",
            "--chat",
            "--prompt",
            "No daemon.",
            "--json",
        ],
    );
    assert_eq!(output.status.code(), Some(3));
    let value = json_stdout(&output);
    assert_eq!(value["ok"], false);
    assert_eq!(value["error"]["code"], "daemon_unavailable");
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
