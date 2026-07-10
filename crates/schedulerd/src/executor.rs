use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use codex_runner::{
    CodexConfig, CodexRunner, RunOutcome, RunRequest, RunTarget, RunnerError, RunnerEvent,
    RunnerEventType, RunnerPaths, SchedulerContext,
};
use scheduler_core::db::SchedulerDb;
use scheduler_core::model::{
    new_run_artifact_id, new_run_event_id, Project, ProjectKind, Run, RunArtifact, RunArtifactKind,
    RunEventSource, RunStatus, SandboxMode, Task,
};
use scheduler_core::time::now_rfc3339;
use serde_json::Value;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use tokio::sync::{Mutex, Notify};
use tokio_util::sync::CancellationToken;

use crate::config::AppPaths;

#[derive(Debug, Clone)]
pub struct ExecutionRequest {
    pub run: Run,
    pub task: Task,
    pub stdout_log_path: PathBuf,
    pub stderr_log_path: PathBuf,
    pub events_jsonl_path: PathBuf,
    pub schedule_token: Option<String>,
    pub schedule_capabilities: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutionStatus {
    Succeeded,
    Failed,
    TimedOut,
    Canceled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureKind {
    Transient,
    Permanent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionResult {
    pub status: ExecutionStatus,
    pub failure_kind: Option<FailureKind>,
    pub exit_code: Option<i64>,
    pub signal: Option<String>,
    pub codex_session_id: Option<String>,
    pub workspace_path: Option<String>,
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,
    pub base_ref: Option<String>,
    pub commit_before: Option<String>,
    pub commit_after: Option<String>,
    pub codex_command_json: Option<String>,
    pub warnings: Vec<String>,
    pub stdout_tail: Option<String>,
    pub stderr_tail: Option<String>,
    pub result_summary: Option<String>,
}

impl ExecutionResult {
    pub fn succeeded() -> Self {
        Self {
            status: ExecutionStatus::Succeeded,
            failure_kind: None,
            exit_code: Some(0),
            signal: None,
            codex_session_id: None,
            workspace_path: None,
            worktree_path: None,
            branch_name: None,
            base_ref: None,
            commit_before: None,
            commit_after: None,
            codex_command_json: None,
            warnings: Vec::new(),
            stdout_tail: Some("mock stdout\n".to_owned()),
            stderr_tail: None,
            result_summary: Some("mock execution succeeded".to_owned()),
        }
    }

    pub fn failed() -> Self {
        Self {
            status: ExecutionStatus::Failed,
            failure_kind: Some(FailureKind::Transient),
            exit_code: Some(1),
            signal: None,
            codex_session_id: None,
            workspace_path: None,
            worktree_path: None,
            branch_name: None,
            base_ref: None,
            commit_before: None,
            commit_after: None,
            codex_command_json: None,
            warnings: Vec::new(),
            stdout_tail: None,
            stderr_tail: Some("mock stderr\n".to_owned()),
            result_summary: Some("mock execution failed".to_owned()),
        }
    }

    pub fn permanent_failed() -> Self {
        Self {
            status: ExecutionStatus::Failed,
            failure_kind: Some(FailureKind::Permanent),
            exit_code: Some(2),
            signal: None,
            codex_session_id: None,
            workspace_path: None,
            worktree_path: None,
            branch_name: None,
            base_ref: None,
            commit_before: None,
            commit_after: None,
            codex_command_json: None,
            warnings: Vec::new(),
            stdout_tail: None,
            stderr_tail: Some("mock permanent failure\n".to_owned()),
            result_summary: Some("mock permanent failure".to_owned()),
        }
    }

    pub fn timed_out() -> Self {
        Self {
            status: ExecutionStatus::TimedOut,
            failure_kind: Some(FailureKind::Transient),
            exit_code: None,
            signal: Some("SIGTERM".to_owned()),
            codex_session_id: None,
            workspace_path: None,
            worktree_path: None,
            branch_name: None,
            base_ref: None,
            commit_before: None,
            commit_after: None,
            codex_command_json: None,
            warnings: Vec::new(),
            stdout_tail: None,
            stderr_tail: Some("mock execution timed out\n".to_owned()),
            result_summary: Some("mock execution timed out".to_owned()),
        }
    }

    pub fn canceled() -> Self {
        Self {
            status: ExecutionStatus::Canceled,
            failure_kind: Some(FailureKind::Permanent),
            exit_code: None,
            signal: Some("SIGTERM".to_owned()),
            codex_session_id: None,
            workspace_path: None,
            worktree_path: None,
            branch_name: None,
            base_ref: None,
            commit_before: None,
            commit_after: None,
            codex_command_json: None,
            warnings: Vec::new(),
            stdout_tail: None,
            stderr_tail: Some("mock execution canceled\n".to_owned()),
            result_summary: Some("mock execution canceled".to_owned()),
        }
    }
}

#[derive(Debug, Clone)]
pub struct CodexExecutor {
    db: SchedulerDb,
    paths: AppPaths,
    version: String,
    app_cli_dir: Option<PathBuf>,
    runner: CodexRunner,
}

impl CodexExecutor {
    pub fn new(db: SchedulerDb, paths: AppPaths, version: impl Into<String>) -> Self {
        Self {
            db,
            paths,
            version: version.into(),
            app_cli_dir: current_exe_parent(),
            runner: CodexRunner::new(),
        }
    }

    pub fn with_app_cli_dir(mut self, app_cli_dir: Option<PathBuf>) -> Self {
        self.app_cli_dir = app_cli_dir;
        self
    }
}

#[async_trait]
impl RunExecutor for CodexExecutor {
    async fn execute(
        &self,
        request: ExecutionRequest,
        cancel: CancellationToken,
    ) -> ExecutionResult {
        let run_id = request.run.id.clone();
        let (runner_progress_tx, mut runner_progress_rx) = mpsc::unbounded_channel();
        let mut runner_progress_tx = Some(runner_progress_tx);
        let (event_tx, event_rx) = mpsc::unbounded_channel();
        let bridge_tx = event_tx.clone();
        let bridge_handle = tokio::spawn(async move {
            while let Some(event) = runner_progress_rx.recv().await {
                if bridge_tx.send(RecordedRunEvent::Runner(event)).is_err() {
                    break;
                }
            }
        });
        let progress_db = self.db.clone();
        let progress_run_id = run_id.clone();
        let progress_handle = tokio::spawn(async move {
            record_progress_events(progress_db, progress_run_id, event_rx).await;
        });

        let result = match self.build_run_request(&request).await {
            Ok(run_request) => {
                match self
                    .runner
                    .run(run_request, cancel, runner_progress_tx.take())
                    .await
                {
                    Ok(outcome) => {
                        let artifact_warning = persist_run_artifacts(&self.db, &run_id, &outcome)
                            .await
                            .err()
                            .map(|err| format!("artifact persistence failed: {err}"));
                        let mut result = execution_result_from_outcome(outcome);
                        if let Some(warning) = artifact_warning {
                            result.warnings.push(warning);
                        }
                        send_executor_warnings(&event_tx, &result.warnings);
                        result
                    }
                    Err(err) => {
                        write_error_logs(&request, &err.to_string()).await;
                        execution_result_from_error(err)
                    }
                }
            }
            Err(err) => {
                write_error_logs(&request, &err.to_string()).await;
                execution_result_from_error(err)
            }
        };

        drop(runner_progress_tx);
        let _ = bridge_handle.await;
        drop(event_tx);
        let _ = progress_handle.await;
        result
    }
}

impl CodexExecutor {
    async fn build_run_request(
        &self,
        request: &ExecutionRequest,
    ) -> Result<RunRequest, RunnerError> {
        let codex_path = self.configured_codex_path().await?;
        let trusted_roots = self.trusted_roots().await?;
        let project = self.task_project(&request.task).await?;
        let default_branch = project
            .as_ref()
            .and_then(|project| project.default_branch.clone());
        let repo_path = request
            .task
            .repo_path
            .as_ref()
            .map(PathBuf::from)
            .or_else(|| {
                project.as_ref().map(|project| {
                    project
                        .git_root
                        .as_ref()
                        .map(PathBuf::from)
                        .unwrap_or_else(|| PathBuf::from(&project.path))
                })
            });

        Ok(RunRequest {
            task_id: request.task.id.clone(),
            run_id: request.run.id.clone(),
            task_slug: request.task.slug.clone(),
            scheduled_for: request.run.scheduled_for.clone(),
            prompt: request.task.prompt_body.clone(),
            target: RunTarget {
                mode: request.task.target_mode,
                repo_path,
                trusted_roots,
                base_ref: request.task.base_ref.clone(),
                default_branch,
                fetch_before_worktree: false,
                worktree_parent: Some(self.paths.data_dir.join("worktrees")),
                cleanup_policy: request.task.cleanup_policy,
                cleanup_after_days: request.task.cleanup_after_days,
            },
            codex: CodexConfig {
                codex_path,
                model: self.model_for_task(&request.task).await?,
                reasoning_effort: request.task.reasoning_effort.clone(),
                sandbox_mode: Some(request.task.sandbox_mode),
                approval_policy: request.task.approval_policy,
                max_runtime_sec: request.task.max_runtime_sec.max(1) as u64,
                allow_danger_full_access: request.task.sandbox_mode
                    == SandboxMode::DangerFullAccess,
            },
            scheduler: SchedulerContext {
                app_version: self.version.clone(),
                socket_path: Some(self.paths.socket_path.clone()),
                run_token: request.schedule_token.clone(),
                timezone: request.task.timezone.clone(),
                inject_scheduler_instructions: request.task.inject_scheduler_instructions,
                allow_schedule_cli: request.task.allow_schedule_cli,
                schedule_cli_capabilities: request.schedule_capabilities.clone(),
            },
            paths: RunnerPaths {
                app_data_dir: self.paths.data_dir.clone(),
                logs_dir: Some(self.paths.logs_dir.clone()),
                app_cli_dir: self.app_cli_dir.clone(),
            },
        })
    }

    async fn configured_codex_path(&self) -> Result<Option<PathBuf>, RunnerError> {
        let value = self
            .db
            .get_setting::<String>("runner.codex_path")
            .await
            .map_err(scheduler_error_to_runner_error)?;
        Ok(value.and_then(|value| normalize_codex_path_setting(&value)))
    }

    async fn model_for_task(&self, task: &Task) -> Result<Option<String>, RunnerError> {
        if task
            .model
            .as_deref()
            .is_some_and(|model| !model.trim().is_empty())
        {
            return Ok(task.model.clone());
        }
        Ok(self
            .db
            .get_setting::<String>("runner.default_model")
            .await
            .map_err(scheduler_error_to_runner_error)?
            .and_then(|model| {
                let trimmed = model.trim();
                (!trimmed.is_empty()).then(|| trimmed.to_owned())
            }))
    }

    async fn trusted_roots(&self) -> Result<Vec<PathBuf>, RunnerError> {
        let projects = self
            .db
            .list_projects()
            .await
            .map_err(scheduler_error_to_runner_error)?;
        Ok(projects
            .into_iter()
            .filter(|project| {
                project.trusted_at.is_some()
                    && project.kind == ProjectKind::Git
                    && project.git_root.is_some()
            })
            .map(|project| {
                project
                    .git_root
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from(project.path))
            })
            .collect())
    }

    async fn task_project(&self, task: &Task) -> Result<Option<Project>, RunnerError> {
        let Some(project_id) = task.project_id.as_deref() else {
            return Ok(None);
        };
        self.db
            .get_project(project_id)
            .await
            .map_err(scheduler_error_to_runner_error)
    }
}

fn normalize_codex_path_setting(value: &str) -> Option<PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "codex" {
        return None;
    }
    let path = PathBuf::from(trimmed);
    if path.is_absolute() || trimmed.contains(std::path::MAIN_SEPARATOR) {
        Some(path)
    } else {
        None
    }
}

fn current_exe_parent() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(std::path::Path::to_path_buf))
}

fn scheduler_error_to_runner_error(err: scheduler_core::SchedulerError) -> RunnerError {
    RunnerError::Io(std::io::Error::other(err.to_string()))
}

fn execution_result_from_outcome(outcome: RunOutcome) -> ExecutionResult {
    let status = match outcome.status {
        RunStatus::Succeeded => ExecutionStatus::Succeeded,
        RunStatus::TimedOut => ExecutionStatus::TimedOut,
        RunStatus::Canceled => ExecutionStatus::Canceled,
        _ => ExecutionStatus::Failed,
    };
    let failure_kind = match status {
        ExecutionStatus::Succeeded => None,
        ExecutionStatus::Failed | ExecutionStatus::TimedOut => Some(FailureKind::Transient),
        ExecutionStatus::Canceled => Some(FailureKind::Permanent),
    };
    let codex_command_json = serde_json::to_string(&outcome.command).ok();
    let warnings = outcome
        .warnings
        .iter()
        .map(|warning| format!("{}: {}", warning.code, warning.message))
        .collect();

    ExecutionResult {
        status,
        failure_kind,
        exit_code: outcome.exit_code.map(i64::from),
        signal: outcome.signal,
        codex_session_id: outcome.codex_session_id,
        workspace_path: Some(path_to_string(&outcome.workspace.workspace_path)),
        worktree_path: outcome
            .workspace
            .worktree_path
            .as_ref()
            .map(|path| path_to_string(path)),
        branch_name: outcome.workspace.branch_name,
        base_ref: outcome.workspace.base_ref,
        commit_before: outcome
            .workspace
            .git_before
            .as_ref()
            .and_then(|snapshot| snapshot.head.clone()),
        commit_after: outcome
            .workspace
            .git_after
            .as_ref()
            .and_then(|snapshot| snapshot.head.clone()),
        codex_command_json,
        warnings,
        stdout_tail: non_empty(outcome.stdout_tail),
        stderr_tail: non_empty(outcome.stderr_tail),
        result_summary: outcome.summary,
    }
}

fn execution_result_from_error(err: RunnerError) -> ExecutionResult {
    let message = err.to_string();
    ExecutionResult {
        status: ExecutionStatus::Failed,
        failure_kind: Some(FailureKind::Permanent),
        exit_code: None,
        signal: None,
        codex_session_id: None,
        workspace_path: None,
        worktree_path: None,
        branch_name: None,
        base_ref: None,
        commit_before: None,
        commit_after: None,
        codex_command_json: None,
        warnings: Vec::new(),
        stdout_tail: None,
        stderr_tail: Some(format!("{message}\n")),
        result_summary: Some(message),
    }
}

fn non_empty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn path_to_string(path: &std::path::Path) -> String {
    path.to_string_lossy().into_owned()
}

async fn persist_run_artifacts(
    db: &SchedulerDb,
    run_id: &str,
    outcome: &RunOutcome,
) -> scheduler_core::Result<()> {
    let log_artifacts = [
        (
            &outcome.log_paths.stdout_log,
            "stdout.log",
            Some("text/plain"),
        ),
        (
            &outcome.log_paths.stderr_log,
            "stderr.log",
            Some("text/plain"),
        ),
        (
            &outcome.log_paths.events_jsonl,
            "events.jsonl",
            Some("application/x-ndjson"),
        ),
    ];
    for (path, title, mime_type) in log_artifacts {
        create_run_artifact(db, run_id, RunArtifactKind::Log, path, title, mime_type).await?;
    }
    create_run_artifact(
        db,
        run_id,
        RunArtifactKind::LastMessage,
        &outcome.log_paths.last_message,
        "last-message.md",
        Some("text/markdown"),
    )
    .await?;
    if let Some(worktree_path) = &outcome.workspace.worktree_path {
        create_run_artifact(
            db,
            run_id,
            RunArtifactKind::Worktree,
            worktree_path,
            "worktree",
            None,
        )
        .await?;
    }
    Ok(())
}

async fn create_run_artifact(
    db: &SchedulerDb,
    run_id: &str,
    kind: RunArtifactKind,
    path: &std::path::Path,
    title: &str,
    mime_type: Option<&str>,
) -> scheduler_core::Result<()> {
    let size_bytes = tokio::fs::metadata(path)
        .await
        .ok()
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len() as i64);
    let artifact = RunArtifact {
        id: new_run_artifact_id(),
        run_id: run_id.to_owned(),
        kind,
        path: path_to_string(path),
        title: Some(title.to_owned()),
        mime_type: mime_type.map(str::to_owned),
        size_bytes,
        created_at: now_rfc3339(),
    };
    db.create_run_artifact(&artifact).await
}

async fn write_error_logs(request: &ExecutionRequest, message: &str) {
    if let Some(parent) = request.stderr_log_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    let _ = tokio::fs::write(&request.stderr_log_path, format!("{message}\n")).await;
    if let Some(parent) = request.stdout_log_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    let _ = tokio::fs::write(&request.stdout_log_path, b"").await;
}

async fn record_progress_events(
    db: SchedulerDb,
    run_id: String,
    mut progress_rx: mpsc::UnboundedReceiver<RecordedRunEvent>,
) {
    while let Some(record) = progress_rx.recv().await {
        let (source, level, event_type, message, payload) = match record {
            RecordedRunEvent::Runner(event) => {
                let source = if event.event_type == RunnerEventType::StdoutJsonEvent {
                    RunEventSource::CodexJsonl
                } else {
                    RunEventSource::Daemon
                };
                let level = match event.event_type {
                    RunnerEventType::TimedOut | RunnerEventType::Canceled => "warn",
                    _ => "info",
                };
                let event_type = match event.event_type {
                    RunnerEventType::PreflightStarted => "runner.preflight_started",
                    RunnerEventType::WorkspacePrepared => "runner.workspace_prepared",
                    RunnerEventType::ProcessStarted => "runner.process_started",
                    RunnerEventType::StdoutJsonEvent => "codex.json_event",
                    RunnerEventType::ProcessFinished => "runner.process_finished",
                    RunnerEventType::TimedOut => "runner.timed_out",
                    RunnerEventType::Canceled => "runner.canceled",
                };
                (
                    source,
                    level,
                    event_type,
                    Some(event.message),
                    Some(event.payload.unwrap_or(Value::Null)),
                )
            }
            RecordedRunEvent::Warning(summary) => (
                RunEventSource::Daemon,
                "warn",
                "runner.warning",
                Some(summary),
                None,
            ),
        };
        let _ =
            create_run_event_with_source(&db, &run_id, source, level, event_type, message, payload)
                .await;
    }
}

#[derive(Debug)]
enum RecordedRunEvent {
    Runner(RunnerEvent),
    Warning(String),
}

fn send_executor_warnings(event_tx: &mpsc::UnboundedSender<RecordedRunEvent>, warnings: &[String]) {
    for summary in warnings {
        let _ = event_tx.send(RecordedRunEvent::Warning(summary.clone()));
    }
}

async fn create_run_event_with_source(
    db: &SchedulerDb,
    run_id: &str,
    source: RunEventSource,
    level: &str,
    event_type: &str,
    message: Option<String>,
    payload: Option<Value>,
) -> scheduler_core::Result<()> {
    let payload_json = payload
        .map(|payload| serde_json::to_string(&payload))
        .transpose()?;
    let mut attempt = 0_u64;
    loop {
        let result = sqlx::query(
            "INSERT INTO run_events (
                id, run_id, event_index, source, level, event_type, message, payload_json,
                created_at
            )
            SELECT ?, ?, COALESCE(MAX(event_index), -1) + 1, ?, ?, ?, ?, ?, ?
            FROM run_events WHERE run_id = ?",
        )
        .bind(new_run_event_id())
        .bind(run_id)
        .bind(source)
        .bind(level)
        .bind(event_type)
        .bind(&message)
        .bind(&payload_json)
        .bind(now_rfc3339())
        .bind(run_id)
        .execute(db.pool())
        .await;

        match result {
            Ok(_) => return Ok(()),
            Err(err) if attempt < 5 && retryable_run_event_insert(&err) => {
                attempt += 1;
                tokio::time::sleep(Duration::from_millis(5 * attempt)).await;
            }
            Err(err) => return Err(err.into()),
        }
    }
}

fn retryable_run_event_insert(err: &sqlx::Error) -> bool {
    let Some(db_err) = err.as_database_error() else {
        return false;
    };
    if db_err.is_unique_violation() {
        return true;
    }
    let code = db_err.code();
    let code = code.as_deref();
    matches!(code, Some("5" | "6" | "SQLITE_BUSY" | "SQLITE_LOCKED"))
        || db_err.message().contains("database is locked")
        || db_err.message().contains("database table is locked")
}

#[async_trait]
pub trait RunExecutor: Send + Sync + 'static {
    async fn execute(
        &self,
        request: ExecutionRequest,
        cancel: CancellationToken,
    ) -> ExecutionResult;
}

#[derive(Debug, Clone)]
pub struct MockBehavior {
    pub delay: Duration,
    pub result: ExecutionResult,
    pub hold_until_cancel: bool,
}

impl MockBehavior {
    pub fn succeed_after(delay: Duration) -> Self {
        Self {
            delay,
            result: ExecutionResult::succeeded(),
            hold_until_cancel: false,
        }
    }

    pub fn fail_after(delay: Duration) -> Self {
        Self {
            delay,
            result: ExecutionResult::failed(),
            hold_until_cancel: false,
        }
    }

    pub fn hold_until_cancel() -> Self {
        Self {
            delay: Duration::from_secs(0),
            result: ExecutionResult::canceled(),
            hold_until_cancel: true,
        }
    }
}

impl Default for MockBehavior {
    fn default() -> Self {
        Self::succeed_after(Duration::from_millis(10))
    }
}

#[derive(Debug, Default)]
struct MockState {
    calls: Vec<ExecutionRequest>,
    completions: usize,
}

#[derive(Debug, Clone)]
pub struct MockExecutor {
    behavior: MockBehavior,
    state: Arc<Mutex<MockState>>,
    notify: Arc<Notify>,
}

impl MockExecutor {
    pub fn new(behavior: MockBehavior) -> Self {
        Self {
            behavior,
            state: Arc::new(Mutex::new(MockState::default())),
            notify: Arc::new(Notify::new()),
        }
    }

    pub fn succeeding() -> Self {
        Self::new(MockBehavior::default())
    }

    pub async fn calls(&self) -> Vec<ExecutionRequest> {
        self.state.lock().await.calls.clone()
    }

    pub async fn wait_for_calls(&self, count: usize, timeout: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if self.state.lock().await.calls.len() >= count {
                return true;
            }
            let now = tokio::time::Instant::now();
            if now >= deadline {
                return false;
            }
            let remaining = deadline - now;
            tokio::select! {
                () = self.notify.notified() => {}
                () = tokio::time::sleep(remaining.min(Duration::from_millis(10))) => {}
            }
        }
    }

    pub async fn wait_for_completions(&self, count: usize, timeout: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if self.state.lock().await.completions >= count {
                return true;
            }
            let now = tokio::time::Instant::now();
            if now >= deadline {
                return false;
            }
            let remaining = deadline - now;
            tokio::select! {
                () = self.notify.notified() => {}
                () = tokio::time::sleep(remaining.min(Duration::from_millis(10))) => {}
            }
        }
    }
}

#[async_trait]
impl RunExecutor for MockExecutor {
    async fn execute(
        &self,
        request: ExecutionRequest,
        cancel: CancellationToken,
    ) -> ExecutionResult {
        {
            let mut state = self.state.lock().await;
            state.calls.push(request.clone());
        }
        self.notify.notify_waiters();

        let _ = write_mock_logs(&request, &self.behavior.result).await;

        if self.behavior.hold_until_cancel {
            cancel.cancelled().await;
            let result = ExecutionResult::canceled();
            self.record_completion().await;
            return result;
        }

        let result = tokio::select! {
            () = cancel.cancelled() => ExecutionResult::canceled(),
            () = tokio::time::sleep(self.behavior.delay) => self.behavior.result.clone(),
        };
        self.record_completion().await;
        result
    }
}

impl MockExecutor {
    async fn record_completion(&self) {
        let mut state = self.state.lock().await;
        state.completions += 1;
        drop(state);
        self.notify.notify_waiters();
    }
}

async fn write_mock_logs(
    request: &ExecutionRequest,
    result: &ExecutionResult,
) -> std::io::Result<()> {
    if let Some(parent) = request.stdout_log_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    if let Some(parent) = request.stderr_log_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let mut stdout = tokio::fs::File::create(&request.stdout_log_path).await?;
    if let Some(tail) = &result.stdout_tail {
        stdout.write_all(tail.as_bytes()).await?;
    }

    let mut stderr = tokio::fs::File::create(&request.stderr_log_path).await?;
    if let Some(tail) = &result.stderr_tail {
        stderr.write_all(tail.as_bytes()).await?;
    }

    Ok(())
}
