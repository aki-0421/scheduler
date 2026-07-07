use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use codex_runner::{
    compose_prompt, redact_environment, CodexConfig, CodexRunner, RunRequest, RunTarget,
    RunnerPaths, SchedulerContext,
};
use scheduler_core::model::{ApprovalPolicy, CleanupPolicy, RunStatus, RunTargetMode, SandboxMode};
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

fn base_request(codex_path: PathBuf, temp: &TempDir) -> RunRequest {
    RunRequest {
        task_id: "task_01".to_owned(),
        run_id: "run_01".to_owned(),
        task_slug: "daily-review".to_owned(),
        scheduled_for: Some("2026-07-08T09:00:00+09:00".to_owned()),
        prompt: "Say done".to_owned(),
        target: RunTarget {
            mode: RunTargetMode::Chat,
            repo_path: None,
            trusted_roots: Vec::new(),
            base_ref: None,
            default_branch: None,
            fetch_before_worktree: false,
            worktree_parent: None,
            cleanup_policy: CleanupPolicy::Keep,
            cleanup_after_days: None,
        },
        codex: CodexConfig {
            codex_path: Some(codex_path),
            model: Some("gpt-5-codex".to_owned()),
            reasoning_effort: Some("medium".to_owned()),
            sandbox_mode: None,
            approval_policy: ApprovalPolicy::Never,
            max_runtime_sec: 5,
            allow_danger_full_access: false,
        },
        scheduler: SchedulerContext {
            app_version: "0.1.0-test".to_owned(),
            socket_path: Some(temp.path().join("sched.sock")),
            run_token: Some("run-token-secret".to_owned()),
            timezone: "Asia/Tokyo".to_owned(),
            inject_scheduler_instructions: true,
            allow_schedule_cli: true,
            schedule_cli_capabilities: vec![
                "schedule:create".to_owned(),
                "schedule:update-current".to_owned(),
                "repo".to_owned(),
            ],
        },
        paths: RunnerPaths {
            app_data_dir: temp.path().join("app-data"),
            logs_dir: None,
            app_cli_dir: Some(temp.path().join("bin")),
        },
    }
}

#[tokio::test]
async fn success_run_captures_logs_last_message_and_exit_code() {
    let temp = TempDir::new().unwrap();
    let request = base_request(fixture("dummy-codex-success.sh"), &temp);
    let runner = CodexRunner::new();

    let outcome = runner
        .run(request, CancellationToken::new(), None)
        .await
        .unwrap();

    assert_eq!(outcome.status, RunStatus::Succeeded);
    assert_eq!(outcome.exit_code, Some(0));
    assert_eq!(
        outcome.codex_session_id.as_deref(),
        Some("sess_dummy_success")
    );
    assert_eq!(outcome.summary.as_deref(), Some("done\n"));
    assert!(outcome.stdout_tail.contains("\"done\""));
    assert!(outcome.stderr_tail.contains("prompt: Say done"));
    assert!(fs::read_to_string(outcome.log_paths.stdout_log)
        .unwrap()
        .contains("session"));
    assert!(fs::read_to_string(outcome.log_paths.stderr_log)
        .unwrap()
        .contains("Scheduler metadata"));
    assert_eq!(
        fs::read_to_string(outcome.log_paths.last_message).unwrap(),
        "done\n"
    );
    assert!(fs::read_to_string(outcome.log_paths.events_jsonl)
        .unwrap()
        .contains("sess_dummy_success"));
    assert!(fs::read_to_string(outcome.log_paths.command_json)
        .unwrap()
        .contains("--json"));
    let env_json = fs::read_to_string(outcome.log_paths.environment_redacted_json).unwrap();
    assert!(env_json.contains("CODEX_SCHEDULER_RUN_TOKEN"));
    assert!(env_json.contains("***REDACTED***"));
}

#[tokio::test]
async fn non_zero_exit_is_failed() {
    let temp = TempDir::new().unwrap();
    let mut request = base_request(fixture("dummy-codex-fail.sh"), &temp);
    request.codex.reasoning_effort = None;
    let runner = CodexRunner::new();

    let outcome = runner
        .run(request, CancellationToken::new(), None)
        .await
        .unwrap();

    assert_eq!(outcome.status, RunStatus::Failed);
    assert_eq!(outcome.exit_code, Some(42));
    assert!(outcome.stderr_tail.contains("dummy failure"));
    assert_eq!(outcome.summary.as_deref(), Some("failed\n"));
}

#[tokio::test]
async fn timeout_terminates_process_group_and_marks_timed_out() {
    let temp = TempDir::new().unwrap();
    let mut request = base_request(fixture("dummy-codex-sleep.sh"), &temp);
    request.codex.reasoning_effort = None;
    request.codex.max_runtime_sec = 1;
    let runner = CodexRunner::new();

    let outcome = runner
        .run(request, CancellationToken::new(), None)
        .await
        .unwrap();

    assert_eq!(outcome.status, RunStatus::TimedOut);
}

#[tokio::test]
async fn worktree_run_creates_branch_and_cleans_up_on_success() {
    let temp = TempDir::new().unwrap();
    let repo = temp.path().join("repo");
    init_git_repo(&repo);

    let mut request = base_request(fixture("dummy-codex-success.sh"), &temp);
    request.run_id = "run_worktree".to_owned();
    request.codex.reasoning_effort = None;
    request.target = RunTarget {
        mode: RunTargetMode::RepoWorktree,
        repo_path: Some(repo.clone()),
        trusted_roots: vec![temp.path().to_path_buf()],
        base_ref: None,
        default_branch: Some("HEAD".to_owned()),
        fetch_before_worktree: false,
        worktree_parent: Some(temp.path().join("worktrees")),
        cleanup_policy: CleanupPolicy::DeleteOnSuccess,
        cleanup_after_days: None,
    };
    request.codex.sandbox_mode = Some(SandboxMode::WorkspaceWrite);

    let runner = CodexRunner::new();
    let outcome = runner
        .run(request, CancellationToken::new(), None)
        .await
        .unwrap();

    assert_eq!(outcome.status, RunStatus::Succeeded);
    assert!(outcome.workspace.cleanup_performed);
    let worktree_path = outcome.workspace.worktree_path.unwrap();
    assert!(!worktree_path.exists());

    let branch_name = outcome.workspace.branch_name.unwrap();
    let branch = Command::new("git")
        .args(["rev-parse", "--verify", &branch_name])
        .current_dir(&repo)
        .output()
        .unwrap();
    assert!(branch.status.success());
}

#[test]
fn prompt_composition_respects_scheduler_capabilities() {
    let temp = TempDir::new().unwrap();
    let mut request = base_request(fixture("dummy-codex-success.sh"), &temp);
    request.scheduler.schedule_cli_capabilities = vec!["schedule:update-current".to_owned()];
    let (prompt, event) = compose_prompt(&request);

    assert!(event.is_some());
    assert!(prompt.contains("このセッションでは新規 schedule 作成は許可されていません"));
    assert!(!prompt.contains("codex-schedule create"));
    assert!(prompt.contains("codex-schedule update-current"));
    assert!(!prompt.contains("--repo"));
    assert!(prompt.contains("Scheduler metadata:"));
    assert!(prompt.contains("User task instructions:"));
}

#[test]
fn prompt_composition_skips_injection_without_token() {
    let temp = TempDir::new().unwrap();
    let mut request = base_request(fixture("dummy-codex-success.sh"), &temp);
    request.scheduler.run_token = None;
    let (prompt, event) = compose_prompt(&request);

    assert!(event.is_none());
    assert!(!prompt.contains("codex-schedule"));
    assert!(prompt.starts_with("---\nScheduler metadata:"));
}

#[test]
fn environment_redaction_masks_secrets_but_keeps_scheduler_ids() {
    let mut envs = HashMap::new();
    envs.insert(
        "CODEX_SCHEDULER_CURRENT_TASK_ID".to_owned(),
        "task_01".to_owned(),
    );
    envs.insert(
        "CODEX_SCHEDULER_CURRENT_RUN_ID".to_owned(),
        "run_01".to_owned(),
    );
    envs.insert("CODEX_SCHEDULER_RUN_TOKEN".to_owned(), "secret".to_owned());
    envs.insert("OPENAI_API_KEY".to_owned(), "sk-secret".to_owned());
    envs.insert("PASSWORD".to_owned(), "pw".to_owned());
    envs.insert("PATH".to_owned(), "/bin".to_owned());

    let redacted = redact_environment(&envs);

    assert_eq!(redacted["CODEX_SCHEDULER_CURRENT_TASK_ID"], "task_01");
    assert_eq!(redacted["CODEX_SCHEDULER_CURRENT_RUN_ID"], "run_01");
    assert_eq!(redacted["CODEX_SCHEDULER_RUN_TOKEN"], "***REDACTED***");
    assert_eq!(redacted["OPENAI_API_KEY"], "***REDACTED***");
    assert_eq!(redacted["PASSWORD"], "***REDACTED***");
    assert_eq!(redacted["PATH"], "/bin");
}

fn init_git_repo(path: &Path) {
    fs::create_dir_all(path).unwrap();
    git(path, ["init"]);
    git(path, ["config", "user.name", "Codex Runner Test"]);
    git(
        path,
        ["config", "user.email", "codex-runner@example.invalid"],
    );
    fs::write(path.join("README.md"), "hello\n").unwrap();
    git(path, ["add", "README.md"]);
    git(path, ["commit", "-m", "initial"]);
}

fn git<I, S>(cwd: &Path, args: I)
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}
