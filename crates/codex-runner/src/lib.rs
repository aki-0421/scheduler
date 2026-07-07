use std::collections::{HashMap, HashSet, VecDeque};
use std::ffi::CString;
use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::process::ExitStatus;
use std::sync::Arc;
use std::time::Duration;

use scheduler_core::model::{ApprovalPolicy, CleanupPolicy, RunStatus, RunTargetMode, SandboxMode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;
use tokio::fs::{self, File};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio::sync::Mutex;
use tokio::time::{sleep, timeout};
use tokio_util::sync::CancellationToken;

const INSTRUCTIONS_VERSION: &str = "2026-07-07";
const INSTRUCTIONS_LANGUAGE: &str = "ja";
const MIN_FREE_SPACE_BYTES: u64 = 1024 * 1024 * 1024;
const TAIL_BYTES: usize = 8 * 1024;
const SUMMARY_CHARS: usize = 2_000;

#[derive(Debug, Error)]
pub enum RunnerError {
    #[error("failed to find codex binary")]
    CodexBinaryNotFound,
    #[error("codex binary does not exist: {0}")]
    CodexBinaryDoesNotExist(PathBuf),
    #[error("codex --version failed: {0}")]
    CodexVersionFailed(String),
    #[error("codex exec --help failed: {0}")]
    CodexHelpFailed(String),
    #[error("codex exec does not support required flags: {0:?}")]
    UnsupportedCriticalFlags(Vec<String>),
    #[error("target path does not exist: {0}")]
    TargetPathMissing(PathBuf),
    #[error("untrusted path: {path} is not under trusted_roots {trusted_roots:?}")]
    UntrustedPath {
        path: PathBuf,
        trusted_roots: Vec<PathBuf>,
    },
    #[error("unsafe path segment for {field}: {value}")]
    UnsafePathSegment { field: &'static str, value: String },
    #[error("git command failed: git {args:?}: {stderr}")]
    GitFailed { args: Vec<String>, stderr: String },
    #[error("base ref could not be resolved: {0}")]
    BaseRefUnresolved(String),
    #[error("not enough free disk space at {path}: {available_bytes} bytes available")]
    InsufficientDiskSpace { path: PathBuf, available_bytes: u64 },
    #[error("max_runtime_sec must be greater than zero")]
    InvalidRuntime,
    #[error("danger-full-access requires allow_danger_full_access=true")]
    DangerousSandboxNotAllowed,
    #[error("failed to spawn codex: {0}")]
    SpawnFailed(#[source] io::Error),
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("join error: {0}")]
    Join(#[from] tokio::task::JoinError),
}

pub type Result<T> = std::result::Result<T, RunnerError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub task_id: String,
    pub run_id: String,
    pub task_slug: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduled_for: Option<String>,
    pub prompt: String,
    pub target: RunTarget,
    pub codex: CodexConfig,
    pub scheduler: SchedulerContext,
    pub paths: RunnerPaths,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunTarget {
    pub mode: RunTargetMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_path: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub trusted_roots: Vec<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_branch: Option<String>,
    #[serde(default)]
    pub fetch_before_worktree: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_parent: Option<PathBuf>,
    pub cleanup_policy: CleanupPolicy,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_after_days: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_path: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sandbox_mode: Option<SandboxMode>,
    pub approval_policy: ApprovalPolicy,
    pub max_runtime_sec: u64,
    #[serde(default)]
    pub allow_danger_full_access: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerContext {
    pub app_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub socket_path: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_token: Option<String>,
    pub timezone: String,
    #[serde(default)]
    pub inject_scheduler_instructions: bool,
    #[serde(default)]
    pub allow_schedule_cli: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub schedule_cli_capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunnerPaths {
    pub app_data_dir: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logs_dir: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_cli_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexCapabilities {
    pub codex_path: PathBuf,
    pub version: String,
    pub exec_help: String,
    pub flags: HashSet<String>,
}

impl CodexCapabilities {
    pub fn supports_flag(&self, flag: &str) -> bool {
        self.flags.contains(flag)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerInstructionsInjectedEvent {
    #[serde(rename = "eventType")]
    pub event_type: String,
    pub payload: SchedulerInstructionsInjectedPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerInstructionsInjectedPayload {
    pub version: String,
    pub language: String,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunOutcome {
    pub status: RunStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signal: Option<String>,
    pub log_paths: RunLogPaths,
    pub stdout_tail: String,
    pub stderr_tail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub workspace: WorkspaceOutcome,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<RunnerWarning>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub injected_event: Option<SchedulerInstructionsInjectedEvent>,
    pub command: CommandRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunLogPaths {
    pub stdout_log: PathBuf,
    pub stderr_log: PathBuf,
    pub events_jsonl: PathBuf,
    pub last_message: PathBuf,
    pub command_json: PathBuf,
    pub environment_redacted_json: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOutcome {
    pub mode: RunTargetMode,
    pub workspace_path: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_path: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_before: Option<GitSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_after: Option<GitSnapshot>,
    #[serde(default)]
    pub cleanup_performed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_porcelain: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_stat: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunnerWarning {
    pub code: String,
    pub message: String,
}

impl RunnerWarning {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandRecord {
    pub program: PathBuf,
    pub argv: Vec<String>,
    pub cwd: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunnerEvent {
    pub event_type: RunnerEventType,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunnerEventType {
    PreflightStarted,
    WorkspacePrepared,
    ProcessStarted,
    StdoutJsonEvent,
    ProcessFinished,
    TimedOut,
    Canceled,
}

#[derive(Debug, Default, Clone)]
pub struct CodexRunner {
    capabilities_cache: Arc<Mutex<HashMap<PathBuf, CodexCapabilities>>>,
}

impl CodexRunner {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn detect_capabilities(
        &self,
        configured_path: Option<&Path>,
    ) -> Result<CodexCapabilities> {
        let codex_path = find_codex_binary(configured_path)?;
        let canonical_key = canonicalize_existing_file(&codex_path)?;
        if let Some(cached) = self
            .capabilities_cache
            .lock()
            .await
            .get(&canonical_key)
            .cloned()
        {
            return Ok(cached);
        }

        let version_output = Command::new(&canonical_key)
            .arg("--version")
            .output()
            .await?;
        if !version_output.status.success() {
            return Err(RunnerError::CodexVersionFailed(
                String::from_utf8_lossy(&version_output.stderr)
                    .trim()
                    .to_owned(),
            ));
        }
        let version = String::from_utf8_lossy(&version_output.stdout)
            .trim()
            .to_owned();

        let help_output = Command::new(&canonical_key)
            .arg("exec")
            .arg("--help")
            .output()
            .await?;
        if !help_output.status.success() {
            return Err(RunnerError::CodexHelpFailed(
                String::from_utf8_lossy(&help_output.stderr)
                    .trim()
                    .to_owned(),
            ));
        }
        let exec_help = String::from_utf8_lossy(&help_output.stdout).to_string();
        let capabilities = CodexCapabilities {
            codex_path: canonical_key.clone(),
            version,
            flags: parse_help_flags(&exec_help),
            exec_help,
        };

        self.capabilities_cache
            .lock()
            .await
            .insert(canonical_key, capabilities.clone());
        Ok(capabilities)
    }

    pub async fn run(
        &self,
        request: RunRequest,
        cancellation: CancellationToken,
        progress_tx: Option<mpsc::UnboundedSender<RunnerEvent>>,
    ) -> Result<RunOutcome> {
        send_progress(
            &progress_tx,
            RunnerEventType::PreflightStarted,
            "preflight started",
            None,
        );

        validate_safe_request_ids(&request)?;
        validate_runtime(&request.codex)?;
        let codex_path = find_codex_binary(request.codex.codex_path.as_deref())?;
        let capabilities = self.detect_capabilities(Some(&codex_path)).await?;
        let mut warnings = Vec::new();
        validate_required_flags(&capabilities)?;

        let log_paths = prepare_log_paths(&request).await?;
        let mut workspace = prepare_workspace(&request, &mut warnings).await?;
        ensure_free_space(&workspace.workspace_path)?;
        ensure_free_space(&log_paths.stdout_log)?;

        let (prompt, injected_event) =
            compose_prompt_with_workspace(&request, Some(&workspace.workspace_path));
        if let Some(event) = &injected_event {
            write_injected_event_jsonl(&log_paths.events_jsonl, event).await?;
        }
        let resolved_sandbox = resolve_sandbox(&request);
        let (command, envs) = build_command_record(
            &request,
            &capabilities,
            &workspace.workspace_path,
            &log_paths.last_message,
            resolved_sandbox,
            &mut warnings,
        )?;

        write_command_json(&log_paths.command_json, &command).await?;
        write_environment_json(&log_paths.environment_redacted_json, &envs).await?;

        send_progress(
            &progress_tx,
            RunnerEventType::WorkspacePrepared,
            "workspace prepared",
            Some(json!({
                "workspacePath": workspace.workspace_path,
                "mode": workspace.mode,
            })),
        );

        let execution = execute_codex(
            &command,
            &envs,
            &prompt,
            &log_paths,
            request.codex.max_runtime_sec,
            cancellation,
            progress_tx.clone(),
        )
        .await?;
        if execution.invalid_jsonl_line_count > 0 {
            warnings.push(RunnerWarning::new(
                "invalid_stdout_jsonl",
                format!(
                    "{} stdout line(s) were not valid JSON and were omitted from events.jsonl",
                    execution.invalid_jsonl_line_count
                ),
            ));
        }

        if matches!(
            workspace.mode,
            RunTargetMode::RepoLocal | RunTargetMode::RepoWorktree
        ) {
            workspace.git_after = Some(git_snapshot_after(&workspace.workspace_path).await?);
        }

        let mut status = execution.status;
        if workspace.mode == RunTargetMode::RepoWorktree
            && cleanup_worktree(&request, &mut workspace, status, &mut warnings).await?
        {
            workspace.cleanup_performed = true;
        }

        if matches!(
            status,
            RunStatus::Running | RunStatus::Starting | RunStatus::Queued
        ) {
            status = classify_exit_status(execution.exit_status).0;
        }

        let summary = read_summary_candidate(&log_paths.last_message).await?;

        send_progress(
            &progress_tx,
            RunnerEventType::ProcessFinished,
            "process finished",
            Some(json!({
                "status": status,
                "exitCode": execution.exit_code,
                "signal": execution.signal,
            })),
        );

        Ok(RunOutcome {
            status,
            exit_code: execution.exit_code,
            signal: execution.signal,
            log_paths,
            stdout_tail: execution.stdout_tail,
            stderr_tail: execution.stderr_tail,
            codex_session_id: execution.codex_session_id,
            summary,
            workspace: workspace.into(),
            warnings,
            injected_event,
            command,
        })
    }
}

#[derive(Debug)]
struct ExecutionOutcome {
    status: RunStatus,
    exit_status: Option<ExitStatus>,
    exit_code: Option<i32>,
    signal: Option<String>,
    stdout_tail: String,
    stderr_tail: String,
    codex_session_id: Option<String>,
    invalid_jsonl_line_count: usize,
}

#[derive(Debug, Clone)]
struct WorkspacePrepared {
    mode: RunTargetMode,
    workspace_path: PathBuf,
    repo_path: Option<PathBuf>,
    worktree_path: Option<PathBuf>,
    branch_name: Option<String>,
    base_ref: Option<String>,
    git_before: Option<GitSnapshot>,
    git_after: Option<GitSnapshot>,
    cleanup_performed: bool,
}

fn find_codex_binary(configured_path: Option<&Path>) -> Result<PathBuf> {
    if let Some(path) = configured_path {
        if path.exists() {
            return Ok(path.to_path_buf());
        }
        return Err(RunnerError::CodexBinaryDoesNotExist(path.to_path_buf()));
    }

    let path_var = std::env::var_os("PATH").ok_or(RunnerError::CodexBinaryNotFound)?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join("codex");
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(RunnerError::CodexBinaryNotFound)
}

fn canonicalize_existing_file(path: &Path) -> Result<PathBuf> {
    if !path.exists() {
        return Err(RunnerError::CodexBinaryDoesNotExist(path.to_path_buf()));
    }
    Ok(path.canonicalize()?)
}

fn validate_safe_request_ids(request: &RunRequest) -> Result<()> {
    validate_safe_path_segment("run_id", &request.run_id)?;
    validate_safe_path_segment("task_slug", &request.task_slug)?;
    Ok(())
}

fn validate_safe_path_segment(field: &'static str, value: &str) -> Result<()> {
    let is_safe = !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if is_safe {
        Ok(())
    } else {
        Err(RunnerError::UnsafePathSegment {
            field,
            value: value.to_owned(),
        })
    }
}

fn parse_help_flags(help: &str) -> HashSet<String> {
    help.split_whitespace()
        .filter_map(|token| {
            let trimmed = token.trim_matches(|ch: char| {
                matches!(
                    ch,
                    ',' | ':' | ';' | '[' | ']' | '(' | ')' | '{' | '}' | '<' | '>' | '`'
                )
            });
            if trimmed.starts_with("--") {
                Some(
                    trimmed
                        .split('=')
                        .next()
                        .unwrap_or(trimmed)
                        .trim_end_matches(',')
                        .to_owned(),
                )
            } else {
                None
            }
        })
        .collect()
}

fn validate_required_flags(capabilities: &CodexCapabilities) -> Result<()> {
    let required = [
        "--cd",
        "--json",
        "--sandbox",
        "--ask-for-approval",
        "--output-last-message",
    ];
    let missing = required
        .iter()
        .filter(|flag| !capabilities.supports_flag(flag))
        .map(|flag| (*flag).to_owned())
        .collect::<Vec<_>>();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(RunnerError::UnsupportedCriticalFlags(missing))
    }
}

fn validate_runtime(codex: &CodexConfig) -> Result<()> {
    if codex.max_runtime_sec == 0 {
        return Err(RunnerError::InvalidRuntime);
    }
    if codex.sandbox_mode == Some(SandboxMode::DangerFullAccess) && !codex.allow_danger_full_access
    {
        return Err(RunnerError::DangerousSandboxNotAllowed);
    }
    Ok(())
}

fn resolve_sandbox(request: &RunRequest) -> SandboxMode {
    request
        .codex
        .sandbox_mode
        .unwrap_or(match request.target.mode {
            RunTargetMode::Chat => SandboxMode::ReadOnly,
            RunTargetMode::RepoLocal | RunTargetMode::RepoWorktree => SandboxMode::WorkspaceWrite,
        })
}

async fn prepare_log_paths(request: &RunRequest) -> Result<RunLogPaths> {
    let logs_root = request
        .paths
        .logs_dir
        .clone()
        .unwrap_or_else(|| request.paths.app_data_dir.join("logs"));
    let log_dir = create_child_dir_under(&logs_root, [&request.run_id]).await?;

    let log_paths = RunLogPaths {
        stdout_log: log_dir.join("stdout.log"),
        stderr_log: log_dir.join("stderr.log"),
        events_jsonl: log_dir.join("events.jsonl"),
        last_message: log_dir.join("last-message.md"),
        command_json: log_dir.join("command.json"),
        environment_redacted_json: log_dir.join("environment.redacted.json"),
    };

    File::create(&log_paths.events_jsonl).await?;
    File::create(&log_paths.last_message).await?;
    Ok(log_paths)
}

async fn prepare_workspace(
    request: &RunRequest,
    warnings: &mut Vec<RunnerWarning>,
) -> Result<WorkspacePrepared> {
    match request.target.mode {
        RunTargetMode::Chat => prepare_chat_workspace(request).await,
        RunTargetMode::RepoLocal => prepare_repo_local_workspace(request).await,
        RunTargetMode::RepoWorktree => prepare_repo_worktree_workspace(request, warnings).await,
    }
}

async fn prepare_chat_workspace(request: &RunRequest) -> Result<WorkspacePrepared> {
    let chat_root = request.paths.app_data_dir.join("chat-workspaces");
    let path = create_child_dir_under(&chat_root, [&request.run_id]).await?;
    Ok(WorkspacePrepared {
        mode: RunTargetMode::Chat,
        workspace_path: path,
        repo_path: None,
        worktree_path: None,
        branch_name: None,
        base_ref: None,
        git_before: None,
        git_after: None,
        cleanup_performed: false,
    })
}

async fn prepare_repo_local_workspace(request: &RunRequest) -> Result<WorkspacePrepared> {
    let repo_path = validate_repo_path(request)?;
    ensure_trusted_git_root(request, &git_toplevel(&repo_path).await?)?;
    let git_before = Some(GitSnapshot {
        status_porcelain: Some(git_output(&repo_path, ["status", "--porcelain=v1"]).await?),
        ..GitSnapshot::default()
    });

    Ok(WorkspacePrepared {
        mode: RunTargetMode::RepoLocal,
        workspace_path: repo_path.clone(),
        repo_path: Some(repo_path),
        worktree_path: None,
        branch_name: None,
        base_ref: request.target.base_ref.clone(),
        git_before,
        git_after: None,
        cleanup_performed: false,
    })
}

async fn prepare_repo_worktree_workspace(
    request: &RunRequest,
    warnings: &mut Vec<RunnerWarning>,
) -> Result<WorkspacePrepared> {
    let repo_path = validate_repo_path(request)?;
    ensure_trusted_git_root(request, &git_toplevel(&repo_path).await?)?;
    if request.target.fetch_before_worktree {
        git_output(&repo_path, ["fetch", "--all", "--prune", "--quiet"]).await?;
    }

    let base_ref = request
        .target
        .base_ref
        .clone()
        .or_else(|| request.target.default_branch.clone())
        .unwrap_or_else(|| "HEAD".to_owned());
    resolve_base_ref(&repo_path, &base_ref).await?;

    let worktree_root = request
        .target
        .worktree_parent
        .clone()
        .unwrap_or_else(|| request.paths.app_data_dir.join("worktrees"));
    let canonical_worktree_root = ensure_canonical_dir(&worktree_root).await?;

    let branch_base = format!(
        "codex-scheduler/{}/{}",
        sanitize_branch_part(&request.task_slug),
        sanitize_branch_part(&request.run_id)
    );
    let task_dir_name = sanitize_path_part(&request.task_slug);
    let canonical_task_dir =
        ensure_safe_child_dir(&canonical_worktree_root, &task_dir_name).await?;
    let run_dir_name = sanitize_path_part(&request.run_id);
    let path_base = checked_child_path(&canonical_task_dir, [run_dir_name.clone()])?;

    let mut last_error = None;
    for attempt in 0..10 {
        let branch_name = if attempt == 0 {
            branch_base.clone()
        } else {
            format!("{branch_base}-{attempt}")
        };
        let worktree_path = if attempt == 0 {
            path_base.clone()
        } else {
            checked_child_path(&canonical_task_dir, [format!("{run_dir_name}-{attempt}")])?
        };
        if worktree_path.exists() {
            continue;
        }

        match git_output(
            &repo_path,
            vec![
                "worktree".to_owned(),
                "add".to_owned(),
                "-b".to_owned(),
                branch_name.clone(),
                worktree_path.to_string_lossy().to_string(),
                base_ref.clone(),
            ],
        )
        .await
        {
            Ok(_) => {
                let canonical_worktree = worktree_path.canonicalize()?;
                ensure_child_under(&canonical_worktree_root, &canonical_worktree)?;
                let head = git_output(&canonical_worktree, ["rev-parse", "HEAD"]).await?;
                return Ok(WorkspacePrepared {
                    mode: RunTargetMode::RepoWorktree,
                    workspace_path: canonical_worktree.clone(),
                    repo_path: Some(repo_path),
                    worktree_path: Some(canonical_worktree),
                    branch_name: Some(branch_name),
                    base_ref: Some(base_ref),
                    git_before: Some(GitSnapshot {
                        head: Some(head.trim().to_owned()),
                        status_porcelain: Some(String::new()),
                        ..GitSnapshot::default()
                    }),
                    git_after: None,
                    cleanup_performed: false,
                });
            }
            Err(err) => {
                last_error = Some(err);
            }
        }
    }

    warnings.push(RunnerWarning::new(
        "worktree_retry_exhausted",
        "failed to create a unique worktree after retrying path and branch suffixes",
    ));
    Err(last_error.unwrap_or_else(|| RunnerError::GitFailed {
        args: vec!["worktree".to_owned(), "add".to_owned()],
        stderr: "worktree path collisions exhausted".to_owned(),
    }))
}

fn validate_repo_path(request: &RunRequest) -> Result<PathBuf> {
    let repo_path = request
        .target
        .repo_path
        .as_ref()
        .ok_or_else(|| RunnerError::TargetPathMissing(PathBuf::from("<missing repo_path>")))?;
    if !repo_path.exists() {
        return Err(RunnerError::TargetPathMissing(repo_path.clone()));
    }
    let canonical_repo = repo_path.canonicalize()?;
    let trusted_roots = canonical_trusted_roots(request, &canonical_repo)?;
    if !trusted_roots
        .iter()
        .any(|root| canonical_repo.starts_with(root))
    {
        return Err(RunnerError::UntrustedPath {
            path: canonical_repo,
            trusted_roots,
        });
    }
    Ok(canonical_repo)
}

async fn git_toplevel(path: &Path) -> Result<PathBuf> {
    let top_level = git_output(path, ["rev-parse", "--show-toplevel"]).await?;
    Ok(PathBuf::from(top_level.trim()).canonicalize()?)
}

fn ensure_trusted_git_root(request: &RunRequest, git_root: &Path) -> Result<()> {
    let trusted_roots = canonical_trusted_roots(request, git_root)?;
    if !trusted_roots.iter().any(|root| git_root.starts_with(root)) {
        return Err(RunnerError::UntrustedPath {
            path: git_root.to_path_buf(),
            trusted_roots,
        });
    }
    Ok(())
}

fn canonical_trusted_roots(request: &RunRequest, path: &Path) -> Result<Vec<PathBuf>> {
    if request.target.trusted_roots.is_empty() {
        return Err(RunnerError::UntrustedPath {
            path: path.to_path_buf(),
            trusted_roots: Vec::new(),
        });
    }
    request
        .target
        .trusted_roots
        .iter()
        .map(|path| path.canonicalize().map_err(RunnerError::Io))
        .collect()
}

async fn create_child_dir_under<I, S>(parent: &Path, segments: I) -> Result<PathBuf>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let canonical_parent = ensure_canonical_dir(parent).await?;
    let child_path = checked_child_path(&canonical_parent, segments)?;
    fs::create_dir_all(&child_path).await?;
    let canonical_child = child_path.canonicalize()?;
    ensure_child_under(&canonical_parent, &canonical_child)?;
    Ok(canonical_child)
}

async fn ensure_canonical_dir(path: &Path) -> Result<PathBuf> {
    fs::create_dir_all(path).await?;
    Ok(path.canonicalize()?)
}

async fn ensure_safe_child_dir(canonical_parent: &Path, segment: &str) -> Result<PathBuf> {
    let child_dir = checked_child_path(canonical_parent, [segment])?;
    match fs::symlink_metadata(&child_dir).await {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(RunnerError::UntrustedPath {
                path: child_dir,
                trusted_roots: vec![canonical_parent.to_path_buf()],
            });
        }
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => {
            return Err(RunnerError::Io(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!("{} exists but is not a directory", child_dir.display()),
            )));
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            fs::create_dir(&child_dir).await?;
        }
        Err(err) => return Err(RunnerError::Io(err)),
    }

    let canonical_child = child_dir.canonicalize()?;
    ensure_child_under(canonical_parent, &canonical_child)?;
    Ok(canonical_child)
}

fn checked_child_path<I, S>(canonical_parent: &Path, segments: I) -> Result<PathBuf>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut child_path = canonical_parent.to_path_buf();
    for segment in segments {
        let segment = segment.as_ref();
        validate_safe_path_segment("path_segment", segment)?;
        child_path.push(segment);
    }
    ensure_child_under(canonical_parent, &child_path)?;
    Ok(child_path)
}

fn ensure_child_under(canonical_parent: &Path, child: &Path) -> Result<()> {
    if child.starts_with(canonical_parent) {
        Ok(())
    } else {
        Err(RunnerError::UntrustedPath {
            path: child.to_path_buf(),
            trusted_roots: vec![canonical_parent.to_path_buf()],
        })
    }
}

async fn resolve_base_ref(repo_path: &Path, base_ref: &str) -> Result<()> {
    git_output(
        repo_path,
        vec![
            "rev-parse".to_owned(),
            "--verify".to_owned(),
            format!("{base_ref}^{{commit}}"),
        ],
    )
    .await
    .map(|_| ())
    .map_err(|_| RunnerError::BaseRefUnresolved(base_ref.to_owned()))
}

fn ensure_free_space(path: &Path) -> Result<()> {
    let existing = existing_ancestor(path);
    let available = available_space_bytes(&existing)?;
    if available < MIN_FREE_SPACE_BYTES {
        Err(RunnerError::InsufficientDiskSpace {
            path: existing,
            available_bytes: available,
        })
    } else {
        Ok(())
    }
}

fn existing_ancestor(path: &Path) -> PathBuf {
    let mut current = path;
    while !current.exists() {
        if let Some(parent) = current.parent() {
            current = parent;
        } else {
            break;
        }
    }
    current.to_path_buf()
}

#[cfg(unix)]
fn available_space_bytes(path: &Path) -> io::Result<u64> {
    use std::mem::MaybeUninit;
    use std::os::unix::ffi::OsStrExt;

    let path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path contains NUL byte"))?;
    let mut stats = MaybeUninit::<libc::statvfs>::zeroed();
    let rc = unsafe { libc::statvfs(path.as_ptr(), stats.as_mut_ptr()) };
    if rc != 0 {
        return Err(io::Error::last_os_error());
    }
    let stats = unsafe { stats.assume_init() };
    let block_size = if stats.f_frsize == 0 {
        stats.f_bsize
    } else {
        stats.f_frsize
    };
    Ok(u64::from(stats.f_bavail).saturating_mul(block_size))
}

#[cfg(not(unix))]
fn available_space_bytes(_path: &Path) -> io::Result<u64> {
    Ok(MIN_FREE_SPACE_BYTES)
}

fn build_command_record(
    request: &RunRequest,
    capabilities: &CodexCapabilities,
    workspace: &Path,
    last_message_path: &Path,
    sandbox: SandboxMode,
    warnings: &mut Vec<RunnerWarning>,
) -> Result<(CommandRecord, HashMap<String, String>)> {
    let mut argv = vec!["exec".to_owned()];

    if request.target.mode == RunTargetMode::Chat {
        if capabilities.supports_flag("--skip-git-repo-check") {
            argv.push("--skip-git-repo-check".to_owned());
        } else {
            warnings.push(RunnerWarning::new(
                "unsupported_flag",
                "codex exec does not support --skip-git-repo-check; continuing without it",
            ));
        }
    }

    argv.extend([
        "--cd".to_owned(),
        workspace.to_string_lossy().to_string(),
        "--json".to_owned(),
    ]);

    if capabilities.supports_flag("--color") {
        argv.extend(["--color".to_owned(), "never".to_owned()]);
    } else {
        warnings.push(RunnerWarning::new(
            "unsupported_flag",
            "codex exec does not support --color; continuing without it",
        ));
    }

    if let Some(model) = &request.codex.model {
        if capabilities.supports_flag("--model") {
            argv.extend(["--model".to_owned(), model.clone()]);
        } else {
            warnings.push(RunnerWarning::new(
                "unsupported_flag",
                "codex exec does not support --model; configured model was not passed",
            ));
        }
    }

    if request.codex.reasoning_effort.is_some() && !capabilities.supports_flag("--reasoning-effort")
    {
        warnings.push(RunnerWarning::new(
            "unsupported_flag",
            "codex exec does not support --reasoning-effort; configured reasoning effort was not passed",
        ));
    } else if let Some(reasoning_effort) = &request.codex.reasoning_effort {
        argv.extend(["--reasoning-effort".to_owned(), reasoning_effort.clone()]);
    }

    argv.extend([
        "--sandbox".to_owned(),
        sandbox.as_str().to_owned(),
        "--ask-for-approval".to_owned(),
        "never".to_owned(),
        "--output-last-message".to_owned(),
        last_message_path.to_string_lossy().to_string(),
        "-".to_owned(),
    ]);

    if request.codex.approval_policy != ApprovalPolicy::Never {
        warnings.push(RunnerWarning::new(
            "approval_policy_overridden",
            format!(
                "scheduled runs use --ask-for-approval never; requested policy {} was overridden",
                request.codex.approval_policy
            ),
        ));
    }

    let envs = scheduler_environment(request);
    Ok((
        CommandRecord {
            program: capabilities.codex_path.clone(),
            argv,
            cwd: workspace.to_path_buf(),
        },
        envs,
    ))
}

fn scheduler_environment(request: &RunRequest) -> HashMap<String, String> {
    let mut envs = HashMap::new();
    envs.insert("CODEX_SCHEDULER".to_owned(), "1".to_owned());
    envs.insert(
        "CODEX_SCHEDULER_APP_VERSION".to_owned(),
        request.scheduler.app_version.clone(),
    );
    if let Some(socket_path) = &request.scheduler.socket_path {
        envs.insert(
            "CODEX_SCHEDULER_SOCKET".to_owned(),
            socket_path.to_string_lossy().to_string(),
        );
    }
    envs.insert(
        "CODEX_SCHEDULER_CURRENT_TASK_ID".to_owned(),
        request.task_id.clone(),
    );
    envs.insert(
        "CODEX_SCHEDULER_CURRENT_RUN_ID".to_owned(),
        request.run_id.clone(),
    );
    if let Some(run_token) = &request.scheduler.run_token {
        envs.insert("CODEX_SCHEDULER_RUN_TOKEN".to_owned(), run_token.clone());
    }
    envs.insert(
        "CODEX_SCHEDULER_TIMEZONE".to_owned(),
        request.scheduler.timezone.clone(),
    );

    let current_path = std::env::var_os("PATH").unwrap_or_default();
    let path = if let Some(app_cli_dir) = &request.paths.app_cli_dir {
        prepend_path(app_cli_dir, current_path)
    } else {
        current_path
    };
    envs.insert("PATH".to_owned(), path.to_string_lossy().to_string());

    envs
}

fn prepend_path(dir: &Path, current_path: OsString) -> OsString {
    let mut paths = Vec::new();
    paths.push(dir.to_path_buf());
    paths.extend(std::env::split_paths(&current_path));
    std::env::join_paths(paths).unwrap_or(current_path)
}

async fn write_command_json(path: &Path, command: &CommandRecord) -> Result<()> {
    let mut file = File::create(path).await?;
    let bytes = serde_json::to_vec_pretty(command)?;
    file.write_all(&bytes).await?;
    file.write_all(b"\n").await?;
    Ok(())
}

async fn write_environment_json(path: &Path, envs: &HashMap<String, String>) -> Result<()> {
    let redacted = redact_environment(envs);
    let mut file = File::create(path).await?;
    let bytes = serde_json::to_vec_pretty(&redacted)?;
    file.write_all(&bytes).await?;
    file.write_all(b"\n").await?;
    Ok(())
}

pub fn redact_environment(envs: &HashMap<String, String>) -> HashMap<String, String> {
    envs.iter()
        .map(|(key, value)| {
            if should_mask_env(key) {
                (key.clone(), "***REDACTED***".to_owned())
            } else {
                (key.clone(), value.clone())
            }
        })
        .collect()
}

fn should_mask_env(key: &str) -> bool {
    let allowlisted_codex = matches!(
        key,
        "CODEX_SCHEDULER"
            | "CODEX_SCHEDULER_APP_VERSION"
            | "CODEX_SCHEDULER_CURRENT_TASK_ID"
            | "CODEX_SCHEDULER_CURRENT_RUN_ID"
            | "CODEX_SCHEDULER_TIMEZONE"
    );
    if allowlisted_codex {
        return false;
    }

    key == "PASSWORD"
        || key == "OPENAI_API_KEY"
        || key.starts_with("CODEX_")
        || key.ends_with("_TOKEN")
        || key.ends_with("_KEY")
        || key.ends_with("_SECRET")
        || key.contains("PASSWORD")
}

async fn execute_codex(
    command_record: &CommandRecord,
    envs: &HashMap<String, String>,
    prompt: &str,
    log_paths: &RunLogPaths,
    max_runtime_sec: u64,
    cancellation: CancellationToken,
    progress_tx: Option<mpsc::UnboundedSender<RunnerEvent>>,
) -> Result<ExecutionOutcome> {
    let mut command = Command::new(&command_record.program);
    command.args(&command_record.argv);
    command.current_dir(&command_record.cwd);
    command.envs(envs);
    command.stdin(std::process::Stdio::piped());
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }

    let mut child = command.spawn().map_err(RunnerError::SpawnFailed)?;
    let pid = child.id();
    send_progress(
        &progress_tx,
        RunnerEventType::ProcessStarted,
        "codex process started",
        Some(json!({ "pid": pid })),
    );

    let mut stdin = child.stdin.take();
    let prompt_bytes = prompt.as_bytes().to_vec();
    let stdin_handle = tokio::spawn(async move {
        if let Some(mut stdin) = stdin.take() {
            stdin.write_all(&prompt_bytes).await?;
            stdin.shutdown().await?;
        }
        io::Result::Ok(())
    });

    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    let stdout_path = log_paths.stdout_log.clone();
    let stderr_path = log_paths.stderr_log.clone();
    let events_path = log_paths.events_jsonl.clone();
    let stdout_progress = progress_tx.clone();
    let stdout_handle = tokio::spawn(async move {
        capture_stdout(stdout, &stdout_path, &events_path, stdout_progress).await
    });
    let stderr_handle =
        tokio::spawn(async move { capture_plain_stream(stderr, &stderr_path).await });

    let mut terminal_status = RunStatus::Running;
    let mut exit_status = None;
    {
        let wait_future = child.wait();
        tokio::pin!(wait_future);
        tokio::select! {
            status = &mut wait_future => {
                exit_status = Some(status?);
            }
            _ = sleep(Duration::from_secs(max_runtime_sec)) => {
                terminal_status = RunStatus::TimedOut;
            }
            _ = cancellation.cancelled() => {
                terminal_status = RunStatus::Canceled;
            }
        }
    }

    if exit_status.is_none() {
        if let Some(pid) = pid {
            terminate_process_group(pid, libc::SIGTERM);
        }
        let graceful = timeout(Duration::from_secs(30), child.wait()).await;
        match graceful {
            Ok(status) => {
                exit_status = Some(status?);
            }
            Err(_) => {
                if let Some(pid) = pid {
                    terminate_process_group(pid, libc::SIGKILL);
                }
                exit_status = Some(child.wait().await?);
            }
        }
        let event_type = if terminal_status == RunStatus::TimedOut {
            RunnerEventType::TimedOut
        } else {
            RunnerEventType::Canceled
        };
        send_progress(&progress_tx, event_type, "codex process terminated", None);
    }

    if let Err(err) = stdin_handle.await? {
        if err.kind() != io::ErrorKind::BrokenPipe {
            return Err(RunnerError::Io(err));
        }
    }
    let stdout_capture = stdout_handle.await??;
    let stderr_capture = stderr_handle.await??;

    let (classified, exit_code, signal) =
        if matches!(terminal_status, RunStatus::TimedOut | RunStatus::Canceled) {
            let status = exit_status;
            (
                terminal_status,
                status.and_then(|status| status.code()),
                status.and_then(exit_signal),
            )
        } else {
            let status = exit_status;
            let (classified, signal) = classify_exit_status(status);
            (classified, status.and_then(|status| status.code()), signal)
        };

    Ok(ExecutionOutcome {
        status: classified,
        exit_status,
        exit_code,
        signal,
        stdout_tail: stdout_capture.tail,
        stderr_tail: stderr_capture.tail,
        codex_session_id: stdout_capture.codex_session_id,
        invalid_jsonl_line_count: stdout_capture.invalid_jsonl_line_count,
    })
}

fn terminate_process_group(pid: u32, signal: i32) {
    #[cfg(unix)]
    {
        let _ = unsafe { libc::killpg(pid as libc::pid_t, signal) };
    }
    #[cfg(not(unix))]
    {
        let _ = (pid, signal);
    }
}

fn classify_exit_status(status: Option<ExitStatus>) -> (RunStatus, Option<String>) {
    match status {
        Some(status) if status.success() => (RunStatus::Succeeded, exit_signal(status)),
        Some(status) => (RunStatus::Failed, exit_signal(status)),
        None => (RunStatus::Failed, None),
    }
}

fn exit_signal(status: ExitStatus) -> Option<String> {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        status.signal().map(|signal| signal.to_string())
    }
    #[cfg(not(unix))]
    {
        let _ = status;
        None
    }
}

#[derive(Debug)]
struct StreamCapture {
    tail: String,
    codex_session_id: Option<String>,
    invalid_jsonl_line_count: usize,
}

async fn capture_stdout<R>(
    reader: R,
    log_path: &Path,
    events_path: &Path,
    progress_tx: Option<mpsc::UnboundedSender<RunnerEvent>>,
) -> io::Result<StreamCapture>
where
    R: AsyncRead + Unpin,
{
    let mut reader = tokio::io::BufReader::new(reader);
    let mut log_file = File::create(log_path).await?;
    let mut events_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(events_path)
        .await?;
    let mut buffer = [0_u8; 4096];
    let mut tail = TailBuffer::new(TAIL_BYTES);
    let mut line_buffer = Vec::new();
    let mut session_id = None;
    let mut invalid_jsonl_line_count = 0;

    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        let chunk = &buffer[..read];
        log_file.write_all(chunk).await?;
        tail.push(chunk);

        for byte in chunk {
            line_buffer.push(*byte);
            if *byte == b'\n' {
                if process_jsonl_line(
                    &line_buffer,
                    &mut events_file,
                    &mut session_id,
                    &progress_tx,
                )
                .await?
                {
                    invalid_jsonl_line_count += 1;
                }
                line_buffer.clear();
            }
        }
    }

    if !line_buffer.is_empty()
        && process_jsonl_line(
            &line_buffer,
            &mut events_file,
            &mut session_id,
            &progress_tx,
        )
        .await?
    {
        invalid_jsonl_line_count += 1;
    }
    log_file.flush().await?;
    events_file.flush().await?;

    Ok(StreamCapture {
        tail: tail.to_string_lossy(),
        codex_session_id: session_id,
        invalid_jsonl_line_count,
    })
}

async fn process_jsonl_line(
    line: &[u8],
    events_file: &mut File,
    session_id: &mut Option<String>,
    progress_tx: &Option<mpsc::UnboundedSender<RunnerEvent>>,
) -> io::Result<bool> {
    let trimmed = trim_jsonl_line(line);
    if trimmed.is_empty() {
        return Ok(false);
    }

    let Ok(value) = serde_json::from_slice::<Value>(trimmed) else {
        return Ok(true);
    };

    events_file.write_all(trimmed).await?;
    events_file.write_all(b"\n").await?;
    if session_id.is_none() {
        *session_id = extract_codex_session_id(&value);
    }
    send_progress(
        progress_tx,
        RunnerEventType::StdoutJsonEvent,
        "codex json event",
        Some(value),
    );
    Ok(false)
}

fn trim_jsonl_line(line: &[u8]) -> &[u8] {
    line.trim_ascii_end()
}

async fn capture_plain_stream<R>(reader: R, log_path: &Path) -> io::Result<StreamCapture>
where
    R: AsyncRead + Unpin,
{
    let mut reader = tokio::io::BufReader::new(reader);
    let mut log_file = File::create(log_path).await?;
    let mut buffer = [0_u8; 4096];
    let mut tail = TailBuffer::new(TAIL_BYTES);

    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        let chunk = &buffer[..read];
        log_file.write_all(chunk).await?;
        tail.push(chunk);
    }
    log_file.flush().await?;

    Ok(StreamCapture {
        tail: tail.to_string_lossy(),
        codex_session_id: None,
        invalid_jsonl_line_count: 0,
    })
}

fn extract_codex_session_id(value: &Value) -> Option<String> {
    if let Some(session_id) = value.get("session_id").and_then(Value::as_str) {
        return Some(session_id.to_owned());
    }
    if let Some(session_id) = value.get("sessionId").and_then(Value::as_str) {
        return Some(session_id.to_owned());
    }
    if value.get("type").and_then(Value::as_str) == Some("session") {
        if let Some(id) = value.get("id").and_then(Value::as_str) {
            return Some(id.to_owned());
        }
    }
    value
        .get("session")
        .and_then(|session| session.get("id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

#[derive(Debug)]
struct TailBuffer {
    bytes: VecDeque<u8>,
    capacity: usize,
}

impl TailBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            bytes: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        for byte in bytes {
            if self.bytes.len() == self.capacity {
                self.bytes.pop_front();
            }
            self.bytes.push_back(*byte);
        }
    }

    fn to_string_lossy(&self) -> String {
        let bytes = self.bytes.iter().copied().collect::<Vec<_>>();
        String::from_utf8_lossy(&bytes).to_string()
    }
}

async fn git_snapshot_after(path: &Path) -> Result<GitSnapshot> {
    Ok(GitSnapshot {
        status_porcelain: Some(git_output(path, ["status", "--porcelain=v1"]).await?),
        status: Some(git_output(path, ["status"]).await?),
        diff_stat: Some(git_output(path, ["diff", "--stat"]).await?),
        head: Some(
            git_output(path, ["rev-parse", "HEAD"])
                .await?
                .trim()
                .to_owned(),
        ),
    })
}

async fn cleanup_worktree(
    request: &RunRequest,
    workspace: &mut WorkspacePrepared,
    status: RunStatus,
    warnings: &mut Vec<RunnerWarning>,
) -> Result<bool> {
    let should_remove = match request.target.cleanup_policy {
        CleanupPolicy::Keep => false,
        CleanupPolicy::DeleteOnSuccess => status == RunStatus::Succeeded,
        CleanupPolicy::DeleteAfterDays => request.target.cleanup_after_days.unwrap_or(1) <= 0,
    };
    if !should_remove {
        return Ok(false);
    }

    let Some(repo_path) = &workspace.repo_path else {
        return Ok(false);
    };
    let Some(worktree_path) = &workspace.worktree_path else {
        return Ok(false);
    };
    let status_porcelain = git_output(worktree_path, ["status", "--porcelain=v1"]).await?;
    if !status_porcelain.trim().is_empty() {
        warnings.push(RunnerWarning::new(
            "worktree_cleanup_skipped_dirty",
            format!(
                "worktree cleanup skipped because {} has uncommitted changes",
                worktree_path.display()
            ),
        ));
        return Ok(false);
    }

    git_output(
        repo_path,
        vec![
            "worktree".to_owned(),
            "remove".to_owned(),
            worktree_path.to_string_lossy().to_string(),
        ],
    )
    .await?;
    Ok(true)
}

async fn git_output<I, S>(cwd: &Path, args: I) -> Result<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let args = args
        .into_iter()
        .map(|arg| arg.as_ref().to_owned())
        .collect::<Vec<_>>();
    let output = Command::new("git")
        .args(&args)
        .current_dir(cwd)
        .output()
        .await?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(RunnerError::GitFailed {
            args,
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        })
    }
}

fn sanitize_branch_part(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .trim_matches('.')
        .to_owned()
}

fn sanitize_path_part(value: &str) -> String {
    let sanitized = sanitize_branch_part(value);
    if sanitized.is_empty() {
        "run".to_owned()
    } else {
        sanitized
    }
}

pub fn compose_prompt(
    request: &RunRequest,
) -> (String, Option<SchedulerInstructionsInjectedEvent>) {
    compose_prompt_with_workspace(request, None)
}

fn compose_prompt_with_workspace(
    request: &RunRequest,
    prepared_workspace: Option<&Path>,
) -> (String, Option<SchedulerInstructionsInjectedEvent>) {
    let mut sections = Vec::new();
    let mut injected_event = None;

    if should_inject_scheduler_instructions(request) {
        sections.push(render_scheduler_instructions(request));
        injected_event = Some(SchedulerInstructionsInjectedEvent {
            event_type: "scheduler_instructions_injected".to_owned(),
            payload: SchedulerInstructionsInjectedPayload {
                version: INSTRUCTIONS_VERSION.to_owned(),
                language: INSTRUCTIONS_LANGUAGE.to_owned(),
                capabilities: request.scheduler.schedule_cli_capabilities.clone(),
            },
        });
    }

    sections.push(format!(
        "---\nScheduler metadata:\n- task_id: {}\n- run_id: {}\n- scheduled_for: {}\n- target_mode: {}\n- workspace: {}\n",
        request.task_id,
        request.run_id,
        request
            .scheduled_for
            .as_deref()
            .unwrap_or("<unscheduled/manual>"),
        request.target.mode,
        prepared_workspace
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|| prompt_workspace_hint(request)),
    ));
    sections.push(format!("---\nUser task instructions:\n{}", request.prompt));

    (sections.join("\n"), injected_event)
}

fn should_inject_scheduler_instructions(request: &RunRequest) -> bool {
    request.scheduler.inject_scheduler_instructions
        && request.scheduler.allow_schedule_cli
        && request.scheduler.run_token.is_some()
}

fn prompt_workspace_hint(request: &RunRequest) -> String {
    match request.target.mode {
        RunTargetMode::Chat => request
            .paths
            .app_data_dir
            .join("chat-workspaces")
            .join(&request.run_id)
            .to_string_lossy()
            .to_string(),
        RunTargetMode::RepoLocal => request
            .target
            .repo_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|| "<repo_path missing>".to_owned()),
        RunTargetMode::RepoWorktree => request
            .target
            .worktree_parent
            .as_ref()
            .unwrap_or(&request.paths.app_data_dir)
            .to_string_lossy()
            .to_string(),
    }
}

fn render_scheduler_instructions(request: &RunRequest) -> String {
    let capabilities = &request.scheduler.schedule_cli_capabilities;
    let can_create = capabilities.iter().any(|cap| cap == "schedule:create");
    let can_update_current = capabilities
        .iter()
        .any(|cap| cap == "schedule:update-current");
    let can_repo = capabilities.iter().any(|cap| cap == "repo");

    let mut text = format!(
        "あなたは Codex Scheduler によって起動されたローカル macOS 上の Codex CLI セッションです。\n\n\
このセッションでは、PATH 上の `codex-schedule` CLI を使って、次回以降のスケジュールを作成または更新できます。日時は RFC3339、繰り返しは 5-field cron を優先してください。確認には `--json` を使ってください。\n\n\
現在の scheduler context:\n\
- current_task_id: {}\n\
- current_run_id: {}\n\
- timezone: {}\n\
- capabilities: {}\n\n",
        request.task_id,
        request.run_id,
        request.scheduler.timezone,
        capabilities.join(", ")
    );

    let mut examples = Vec::new();
    if can_create {
        examples.push(
            "1 回だけ follow-up を作る:\n`codex-schedule create --name \"follow up\" --at \"2026-07-08T09:00:00+09:00\" --chat --prompt \"結果を確認して次のアクションを要約してください。\" --json`"
                .to_owned(),
        );
        if can_repo {
            examples.push(
                "Git リポジトリで毎週 worktree 実行する:\n`codex-schedule create --name \"weekly review\" --cron \"0 9 * * 1\" --repo \"$PWD\" --worktree --prompt \"最近の変更をレビューし、リスクを要約してください。\" --json`"
                    .to_owned(),
            );
        }
    } else {
        examples.push("このセッションでは新規 schedule 作成は許可されていません。".to_owned());
    }

    if can_update_current {
        examples.push(
            "現在のタスクを更新する:\n`codex-schedule update-current --at \"2026-07-08T09:00:00+09:00\" --reason \"リリース後に再確認する必要があるため\" --json`"
                .to_owned(),
        );
        examples.push(
            "不要になった現在のタスクを停止する:\n`codex-schedule update-current --pause --reason \"追加の follow-up が不要になったため\" --json`"
                .to_owned(),
        );
    }

    if !examples.is_empty() {
        text.push_str("よく使う例:\n\n");
        text.push_str(&examples.join("\n\n"));
        text.push_str("\n\n");
    }

    text.push_str("安全上の注意:\n");
    if can_repo {
        text.push_str(
            "- Git リポジトリを変更する可能性があるタスクは `--worktree` を優先してください。\n",
        );
    }
    text.push_str(
        "- 不確実または影響が大きいタスクは `--paused` で作り、ユーザーが確認できるようにしてください。\n\
- ユーザーの依頼と無関係なスケジュールは作成しないでください。\n\
- ユーザーが明示しない限り `danger-full-access` を使わないでください。",
    );

    text
}

async fn read_summary_candidate(path: &Path) -> Result<Option<String>> {
    let bytes = match fs::read(path).await {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(RunnerError::Io(err)),
    };
    if bytes.is_empty() {
        return Ok(None);
    }
    let text = String::from_utf8_lossy(&bytes);
    Ok(Some(text.chars().take(SUMMARY_CHARS).collect()))
}

async fn write_injected_event_jsonl(
    path: &Path,
    event: &SchedulerInstructionsInjectedEvent,
) -> Result<()> {
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await?;
    file.write_all(&serde_json::to_vec(event)?).await?;
    file.write_all(b"\n").await?;
    file.flush().await?;
    Ok(())
}

fn send_progress(
    progress_tx: &Option<mpsc::UnboundedSender<RunnerEvent>>,
    event_type: RunnerEventType,
    message: &str,
    payload: Option<Value>,
) {
    if let Some(progress_tx) = progress_tx {
        let _ = progress_tx.send(RunnerEvent {
            event_type,
            message: message.to_owned(),
            payload,
        });
    }
}

impl From<WorkspacePrepared> for WorkspaceOutcome {
    fn from(workspace: WorkspacePrepared) -> Self {
        Self {
            mode: workspace.mode,
            workspace_path: workspace.workspace_path,
            repo_path: workspace.repo_path,
            worktree_path: workspace.worktree_path,
            branch_name: workspace.branch_name,
            base_ref: workspace.base_ref,
            git_before: workspace.git_before,
            git_after: workspace.git_after,
            cleanup_performed: workspace.cleanup_performed,
        }
    }
}
