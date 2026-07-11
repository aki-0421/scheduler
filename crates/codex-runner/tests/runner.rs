use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use codex_runner::{
    compose_prompt, redact_environment, CodexConfig, CodexRunner, RunRequest, RunTarget,
    RunnerError, RunnerPaths, SchedulerContext,
};
use scheduler_core::model::{ApprovalPolicy, CleanupPolicy, RunStatus, RunTargetMode, SandboxMode};
use serde_json::Value;
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

fn fixture(name: &str) -> PathBuf {
    let name = if cfg!(windows) {
        format!("{}.cmd", name.trim_end_matches(".sh"))
    } else {
        name.to_owned()
    };
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
    assert_eq!(outcome.summary.as_deref().map(str::trim_end), Some("done"));
    assert!(outcome.stdout_tail.contains("\"done\""));
    assert!(outcome.stderr_tail.contains("prompt: Say done"));
    assert!(fs::read_to_string(outcome.log_paths.stdout_log)
        .unwrap()
        .contains("session"));
    assert!(fs::read_to_string(outcome.log_paths.stderr_log)
        .unwrap()
        .contains("Scheduler metadata"));
    assert_eq!(
        fs::read_to_string(outcome.log_paths.last_message)
            .unwrap()
            .trim_end(),
        "done"
    );
    assert!(fs::read_to_string(outcome.log_paths.events_jsonl)
        .unwrap()
        .contains("sess_dummy_success"));
    let command_json = fs::read_to_string(outcome.log_paths.command_json).unwrap();
    assert!(command_json.contains("--json"));
    assert!(command_json.contains("--config"));
    assert!(command_json.contains("approval_policy=\\\"never\\\""));
    assert!(!command_json.contains("--ask-for-approval"));
    let env_json = fs::read_to_string(outcome.log_paths.environment_redacted_json).unwrap();
    assert!(env_json.contains("CODEX_SCHEDULER_RUN_TOKEN"));
    assert!(env_json.contains("***REDACTED***"));
}

#[tokio::test]
async fn reasoning_effort_uses_config_when_dedicated_flag_is_unavailable() {
    let temp = TempDir::new().unwrap();
    let mut request = base_request(fixture("dummy-codex-mixed-output.sh"), &temp);
    request.codex.max_runtime_sec = 0;
    let runner = CodexRunner::new();

    let outcome = runner
        .run(request, CancellationToken::new(), None)
        .await
        .unwrap();

    assert_eq!(outcome.status, RunStatus::Succeeded);
    let command_json = fs::read_to_string(outcome.log_paths.command_json).unwrap();
    assert!(!command_json.contains("--reasoning-effort"));
    assert!(command_json.contains("model_reasoning_effort=\\\"medium\\\""));
}

#[tokio::test]
async fn unsafe_run_id_is_rejected_before_path_creation() {
    let temp = TempDir::new().unwrap();
    let runner = CodexRunner::new();

    for run_id in ["../evil", "/absolute"] {
        let mut request = base_request(fixture("dummy-codex-success.sh"), &temp);
        request.run_id = run_id.to_owned();

        let err = runner
            .run(request, CancellationToken::new(), None)
            .await
            .unwrap_err();

        assert!(matches!(
            err,
            RunnerError::UnsafePathSegment {
                field: "run_id",
                ..
            }
        ));
    }
}

#[tokio::test]
async fn repo_mode_requires_trusted_roots() {
    let temp = TempDir::new().unwrap();
    let repo = temp.path().join("repo");
    init_git_repo(&repo);

    let mut request = base_request(fixture("dummy-codex-success.sh"), &temp);
    request.target = RunTarget {
        mode: RunTargetMode::RepoLocal,
        repo_path: Some(repo),
        trusted_roots: Vec::new(),
        base_ref: None,
        default_branch: None,
        fetch_before_worktree: false,
        worktree_parent: None,
        cleanup_policy: CleanupPolicy::Keep,
        cleanup_after_days: None,
    };

    let err = CodexRunner::new()
        .run(request, CancellationToken::new(), None)
        .await
        .unwrap_err();

    assert!(matches!(err, RunnerError::UntrustedPath { .. }));
}

#[tokio::test]
async fn worktree_mode_requires_trusted_roots() {
    let temp = TempDir::new().unwrap();
    let repo = temp.path().join("repo");
    init_git_repo(&repo);

    let mut request = base_request(fixture("dummy-codex-success.sh"), &temp);
    request.target = RunTarget {
        mode: RunTargetMode::RepoWorktree,
        repo_path: Some(repo),
        trusted_roots: Vec::new(),
        base_ref: None,
        default_branch: Some("HEAD".to_owned()),
        fetch_before_worktree: false,
        worktree_parent: Some(temp.path().join("worktrees")),
        cleanup_policy: CleanupPolicy::Keep,
        cleanup_after_days: None,
    };

    let err = CodexRunner::new()
        .run(request, CancellationToken::new(), None)
        .await
        .unwrap_err();

    assert!(matches!(err, RunnerError::UntrustedPath { .. }));
}

#[tokio::test]
async fn injected_event_is_persisted_to_events_jsonl_with_spec_shape() {
    let temp = TempDir::new().unwrap();
    let request = base_request(fixture("dummy-codex-success.sh"), &temp);

    let outcome = CodexRunner::new()
        .run(request, CancellationToken::new(), None)
        .await
        .unwrap();

    let injected_event = outcome.injected_event.unwrap();
    assert_eq!(injected_event.event_type, "scheduler_instructions_injected");
    assert_eq!(injected_event.payload.version, "2026-07-10");
    assert_eq!(injected_event.payload.language, "ja");
    assert!(injected_event
        .payload
        .capabilities
        .contains(&"schedule:create".to_owned()));

    let events = fs::read_to_string(outcome.log_paths.events_jsonl).unwrap();
    let first_line = events.lines().next().unwrap();
    let event: Value = serde_json::from_str(first_line).unwrap();
    assert_eq!(
        event,
        serde_json::json!({
            "eventType": "scheduler_instructions_injected",
            "payload": {
                "version": "2026-07-10",
                "language": "ja",
                "capabilities": ["schedule:create", "schedule:update-current", "repo"]
            }
        })
    );
}

#[tokio::test]
async fn non_json_stdout_lines_are_excluded_from_events_jsonl() {
    let temp = TempDir::new().unwrap();
    let mut request = base_request(fixture("dummy-codex-mixed-output.sh"), &temp);
    request.codex.reasoning_effort = None;

    let outcome = CodexRunner::new()
        .run(request, CancellationToken::new(), None)
        .await
        .unwrap();

    let stdout = fs::read_to_string(outcome.log_paths.stdout_log).unwrap();
    assert!(stdout.contains("this is not json"));

    let events = fs::read_to_string(outcome.log_paths.events_jsonl).unwrap();
    assert!(!events.contains("this is not json"));
    assert!(events.contains("sess_mixed_output"));
    for line in events.lines() {
        serde_json::from_str::<Value>(line).unwrap();
    }
    assert!(outcome
        .warnings
        .iter()
        .any(|warning| warning.code == "invalid_stdout_jsonl"));
}

#[tokio::test]
async fn summary_candidate_truncates_by_chars_for_multibyte_text() {
    let temp = TempDir::new().unwrap();
    let mut request = base_request(fixture("dummy-codex-long-summary.sh"), &temp);
    request.codex.reasoning_effort = None;

    let outcome = CodexRunner::new()
        .run(request, CancellationToken::new(), None)
        .await
        .unwrap();

    let summary = outcome.summary.unwrap();
    assert_eq!(summary.chars().count(), 2_000);
    assert!(summary.chars().all(|ch| ch == 'あ'));
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
    assert_eq!(
        outcome.summary.as_deref().map(str::trim_end),
        Some("failed")
    );
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
async fn jsonl_event_is_readable_before_process_finishes() {
    let temp = TempDir::new().unwrap();
    let mut request = base_request(fixture("dummy-codex-sleep.sh"), &temp);
    request.codex.reasoning_effort = None;
    request.codex.max_runtime_sec = 0;
    let events_path = temp
        .path()
        .join("app-data")
        .join("logs")
        .join("run_01")
        .join("events.jsonl");
    let cancellation = CancellationToken::new();
    let run_cancellation = cancellation.clone();
    let handle = tokio::spawn(async move {
        CodexRunner::new()
            .run(request, run_cancellation, None)
            .await
    });

    let mut found_early_event = false;
    for _ in 0..200 {
        if fs::read_to_string(&events_path).is_ok_and(|events| events.contains("\"early\"")) {
            found_early_event = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    assert!(found_early_event, "early JSONL event was not flushed");
    assert!(!handle.is_finished());
    cancellation.cancel();
    let outcome = handle.await.unwrap().unwrap();
    assert_eq!(outcome.status, RunStatus::Canceled);
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
    let worktree_name = worktree_path
        .file_name()
        .and_then(|value| value.to_str())
        .expect("worktree name");
    let instance_id = worktree_name
        .strip_prefix("wt-")
        .expect("timestamp-random worktree prefix");
    assert_eq!(Uuid::parse_str(instance_id).unwrap().get_version_num(), 7);

    let branch_name = outcome.workspace.branch_name.unwrap();
    assert!(branch_name.ends_with(worktree_name));
    let branch = Command::new("git")
        .args(["rev-parse", "--verify", &branch_name])
        .current_dir(&repo)
        .output()
        .unwrap();
    assert!(branch.status.success());
}

#[tokio::test]
async fn legacy_repo_local_target_is_prepared_as_an_isolated_worktree() {
    let temp = TempDir::new().unwrap();
    let repo = temp.path().join("repo");
    init_git_repo(&repo);

    let mut request = base_request(fixture("dummy-codex-success.sh"), &temp);
    request.codex.reasoning_effort = None;
    request.target = RunTarget {
        mode: RunTargetMode::RepoLocal,
        repo_path: Some(repo.clone()),
        trusted_roots: vec![temp.path().to_path_buf()],
        base_ref: None,
        default_branch: Some("HEAD".to_owned()),
        fetch_before_worktree: false,
        worktree_parent: Some(temp.path().join("worktrees")),
        cleanup_policy: CleanupPolicy::Keep,
        cleanup_after_days: None,
    };
    request.codex.sandbox_mode = Some(SandboxMode::WorkspaceWrite);

    let outcome = CodexRunner::new()
        .run(request, CancellationToken::new(), None)
        .await
        .unwrap();

    assert_eq!(outcome.workspace.mode, RunTargetMode::RepoWorktree);
    assert_ne!(
        outcome.workspace.workspace_path,
        repo.canonicalize().unwrap()
    );
    assert!(outcome.workspace.worktree_path.is_some());
}

#[cfg(unix)]
#[tokio::test]
async fn worktree_intermediate_task_dir_symlink_is_rejected() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let repo = temp.path().join("repo");
    init_git_repo(&repo);

    let worktree_root = temp.path().join("worktrees");
    fs::create_dir_all(&worktree_root).unwrap();
    let escape_target = temp.path().join("escape-target");
    fs::create_dir_all(&escape_target).unwrap();
    symlink(&escape_target, worktree_root.join("daily-review")).unwrap();

    let mut request = base_request(fixture("dummy-codex-success.sh"), &temp);
    request.run_id = "run_symlink".to_owned();
    request.codex.reasoning_effort = None;
    request.target = RunTarget {
        mode: RunTargetMode::RepoWorktree,
        repo_path: Some(repo),
        trusted_roots: vec![temp.path().to_path_buf()],
        base_ref: None,
        default_branch: Some("HEAD".to_owned()),
        fetch_before_worktree: false,
        worktree_parent: Some(worktree_root),
        cleanup_policy: CleanupPolicy::Keep,
        cleanup_after_days: None,
    };

    let err = CodexRunner::new()
        .run(request, CancellationToken::new(), None)
        .await
        .unwrap_err();

    assert!(matches!(err, RunnerError::UntrustedPath { .. }));
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
