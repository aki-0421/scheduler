use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::Duration;

use chrono::Utc;
use clap::{Args, Parser, Subcommand};
use scheduler_core::db::SchedulerDb;
use scheduler_core::ipc::{
    DaemonDiagnosticsParams, DaemonDiagnosticsResult, DaemonHealthParams, DaemonHealthResult,
    JsonRpcError, JsonRpcErrorCode, JsonRpcId, JsonRpcRequest, JsonRpcResponse, ProjectTrustParams,
    ProjectTrustResult, RpcActor, RunListParams, RunListResult, RunResult, SettingsGetParams,
    SettingsGetResult, TaskCreateParams, TaskDeleteResult, TaskGetParams, TaskIdParams,
    TaskListParams, TaskListResult, TaskResult, TaskUpdateParams, JSONRPC_VERSION,
    METHOD_DAEMON_DIAGNOSTICS, METHOD_DAEMON_HEALTH, METHOD_PROJECT_TRUST, METHOD_RUN_LIST,
    METHOD_SETTINGS_GET, METHOD_TASK_CREATE, METHOD_TASK_DELETE, METHOD_TASK_GET, METHOD_TASK_LIST,
    METHOD_TASK_PAUSE, METHOD_TASK_RESUME, METHOD_TASK_RUN_NOW, METHOD_TASK_UPDATE,
};
use scheduler_core::model::{
    new_task_audit_event_id, ApprovalPolicy, AuditActorType, CleanupPolicy, MissedPolicy,
    OverlapPolicy, Project, ProjectKind, RunDto, RunStatus, RunTargetMode, SandboxMode,
    ScheduleStatus, Task, TaskAuditEvent, TaskCodexDto, TaskDto, TaskKind, TaskPoliciesDto,
    TaskPromptDto, TaskStatus, TaskTargetDto,
};
use scheduler_core::schedule::{
    compute_next_run_at, parse_rfc3339_utc, validate_cron, validate_iana_timezone,
};
use scheduler_core::time::{format_utc_rfc3339, now_rfc3339, parse_utc_rfc3339};
use scheduler_core::util::unique_slug;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Map, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

const PROMPT_MAX_BYTES: usize = 200 * 1024;
const DEFAULT_TIMEZONE: &str = "UTC";
const DEFAULT_MAX_RUNTIME_SEC: i64 = 7_200;
const RPC_TIMEOUT: Duration = Duration::from_secs(2);

pub fn cli_name() -> &'static str {
    "codex-schedule"
}

pub fn is_scaffold() -> bool {
    false
}

#[derive(Debug, Parser)]
#[command(name = "codex-schedule")]
#[command(about = "Manage Codex Scheduler tasks")]
pub struct Cli {
    #[arg(long, global = true)]
    json: bool,

    #[arg(long, global = true, env = "CODEX_SCHEDULER_DATA_DIR")]
    data_dir: Option<PathBuf>,

    #[arg(long = "db", global = true, env = "CODEX_SCHEDULER_DB")]
    db_path: Option<PathBuf>,

    #[arg(long = "socket", global = true, env = "CODEX_SCHEDULER_SOCKET")]
    socket_path: Option<PathBuf>,

    #[arg(
        long,
        global = true,
        action = clap::ArgAction::SetTrue,
        help = "daemon 停止時のみ使用。scheduled run 内では使用不可"
    )]
    allow_direct_db: bool,

    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Create(CreateCommand),
    Update(UpdateCommand),
    UpdateCurrent(UpdateCurrentCommand),
    List(ListCommand),
    Show(ShowCommand),
    Pause(TaskActionCommand),
    Resume(TaskActionCommand),
    Delete(TaskActionCommand),
    RunNow(TaskActionCommand),
    History(HistoryCommand),
    Next(NextCommand),
    ValidateCron(ValidateCronCommand),
    Doctor(DoctorCommand),
}

#[derive(Debug, Args)]
struct CreateCommand {
    #[command(flatten)]
    fields: TaskFields,

    #[arg(long)]
    reason: Option<String>,
}

#[derive(Debug, Args)]
struct UpdateCommand {
    id: String,

    #[command(flatten)]
    fields: TaskFields,

    #[command(flatten)]
    clear: ClearFlags,

    #[arg(long)]
    reason: Option<String>,
}

#[derive(Debug, Args)]
struct UpdateCurrentCommand {
    #[command(flatten)]
    fields: TaskFields,

    #[command(flatten)]
    clear: ClearFlags,

    #[arg(long)]
    pause: bool,

    #[arg(long)]
    reason: Option<String>,
}

#[derive(Debug, Clone, Args, Default)]
struct TaskFields {
    #[arg(long)]
    name: Option<String>,

    #[arg(long)]
    prompt: Option<String>,

    #[arg(long)]
    prompt_file: Option<PathBuf>,

    #[arg(long)]
    at: Option<String>,

    #[arg(long)]
    cron: Option<String>,

    #[arg(long)]
    timezone: Option<String>,

    #[arg(long)]
    manual: bool,

    #[arg(long)]
    chat: bool,

    #[arg(long)]
    repo: Option<PathBuf>,

    #[arg(long)]
    base_ref: Option<String>,

    #[arg(long)]
    model: Option<String>,

    #[arg(long)]
    reasoning_effort: Option<String>,

    #[arg(long)]
    sandbox: Option<String>,

    #[arg(long)]
    approval_policy: Option<String>,

    #[arg(long)]
    allow_schedule_cli: Option<bool>,

    #[arg(long)]
    paused: bool,

    #[arg(long)]
    max_runtime_sec: Option<i64>,

    #[arg(long = "max-created-schedules")]
    max_created_schedules: Option<i64>,

    #[arg(long)]
    missed_policy: Option<String>,

    #[arg(long)]
    overlap_policy: Option<String>,
}

#[derive(Debug, Clone, Args, Default)]
struct ClearFlags {
    #[arg(long)]
    clear_run_at: bool,

    #[arg(long)]
    clear_cron: bool,

    #[arg(long)]
    clear_base_ref: bool,

    #[arg(long)]
    clear_model: bool,

    #[arg(long)]
    clear_reasoning_effort: bool,
}

#[derive(Debug, Args)]
struct ListCommand {
    #[arg(long)]
    status: Option<String>,
}

#[derive(Debug, Args)]
struct ShowCommand {
    id: String,
}

#[derive(Debug, Args)]
struct TaskActionCommand {
    id: String,

    #[arg(long)]
    reason: Option<String>,
}

#[derive(Debug, Args)]
struct HistoryCommand {
    task_id: String,

    #[arg(long)]
    status: Option<String>,
}

#[derive(Debug, Args)]
struct NextCommand {
    task_id: Option<String>,

    #[arg(long)]
    cron: Option<String>,

    #[arg(long)]
    timezone: Option<String>,

    #[arg(long, default_value_t = 5)]
    count: usize,
}

#[derive(Debug, Args)]
struct ValidateCronCommand {
    #[arg(long)]
    cron: String,

    #[arg(long)]
    timezone: Option<String>,

    #[arg(long, default_value_t = 5)]
    count: usize,
}

#[derive(Debug, Args)]
struct DoctorCommand {}

#[derive(Debug, Clone)]
struct AppPaths {
    data_dir: PathBuf,
    db_path: PathBuf,
    socket_path: PathBuf,
    allow_direct_db: bool,
}

impl AppPaths {
    fn from_cli(cli: &Cli) -> Self {
        let data_dir = cli.data_dir.clone().unwrap_or_else(default_data_dir);
        let mut paths = Self {
            db_path: data_dir.join("scheduler.sqlite3"),
            socket_path: data_dir.join("scheduler.sock"),
            data_dir,
            allow_direct_db: cli.allow_direct_db || direct_db_env_requested(),
        };
        if let Some(db_path) = &cli.db_path {
            paths.db_path = db_path.clone();
        }
        if let Some(socket_path) = &cli.socket_path {
            paths.socket_path = socket_path.clone();
        }
        paths
    }
}

fn default_data_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| {
            home.join("Library")
                .join("Application Support")
                .join("Codex Scheduler")
        })
        .unwrap_or_else(|| PathBuf::from(".").join("Codex Scheduler"))
}

#[derive(Debug)]
struct CommandOutput {
    json: Value,
    human: String,
}

#[derive(Debug)]
pub struct CliError {
    exit_code: i32,
    code: &'static str,
    message: String,
    details: Option<Value>,
    daemon_connection_failed: bool,
}

impl CliError {
    fn new(exit_code: i32, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            exit_code,
            code,
            message: message.into(),
            details: None,
            daemon_connection_failed: false,
        }
    }

    fn with_details<T: Serialize>(
        exit_code: i32,
        code: &'static str,
        message: impl Into<String>,
        details: T,
    ) -> Self {
        Self {
            exit_code,
            code,
            message: message.into(),
            details: serde_json::to_value(details).ok(),
            daemon_connection_failed: false,
        }
    }

    fn invalid_args(message: impl Into<String>) -> Self {
        Self::new(2, "invalid_arguments", message)
    }

    fn daemon_unavailable(message: impl Into<String>) -> Self {
        let mut err = Self::new(3, "daemon_unavailable", message);
        err.daemon_connection_failed = true;
        err
    }

    fn permission_denied(message: impl Into<String>) -> Self {
        Self::new(4, "permission_denied", message)
    }

    fn validation(message: impl Into<String>) -> Self {
        Self::new(5, "validation_failed", message)
    }

    fn validation_details<T: Serialize>(message: impl Into<String>, details: T) -> Self {
        Self::with_details(5, "validation_failed", message, details)
    }

    fn task_not_found(message: impl Into<String>) -> Self {
        Self::new(6, "task_not_found", message)
    }

    fn database(message: impl Into<String>) -> Self {
        Self::new(7, "database_error", message)
    }

    fn schedule_parse<T: Serialize>(message: impl Into<String>, details: T) -> Self {
        Self::with_details(8, "schedule_parse_error", message, details)
    }

    fn generic(message: impl Into<String>) -> Self {
        Self::new(1, "error", message)
    }

    fn to_json(&self) -> Value {
        let mut error = Map::new();
        error.insert("code".to_owned(), Value::String(self.code.to_owned()));
        error.insert("message".to_owned(), Value::String(self.message.clone()));
        if let Some(details) = &self.details {
            error.insert("details".to_owned(), details.clone());
        }
        json!({ "ok": false, "error": error })
    }

    fn is_daemon_connection_failure(&self) -> bool {
        self.daemon_connection_failed
    }
}

pub async fn run_cli<I, T>(args: I) -> i32
where
    I: IntoIterator<Item = T>,
    T: Into<OsString> + Clone,
{
    let argv = args
        .into_iter()
        .map(|arg| arg.into())
        .collect::<Vec<OsString>>();
    let wants_json = argv
        .iter()
        .any(|arg| arg.to_string_lossy().as_ref() == "--json");

    let cli = match Cli::try_parse_from(argv) {
        Ok(cli) => cli,
        Err(err) => {
            use clap::error::ErrorKind;
            let code = match err.kind() {
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion => 0,
                _ => 2,
            };
            if wants_json && code != 0 {
                let cli_error = CliError::invalid_args(err.to_string());
                println!("{}", serde_json::to_string(&cli_error.to_json()).unwrap());
            } else if code == 0 {
                print!("{err}");
            } else {
                eprint!("{err}");
            }
            return code;
        }
    };

    match execute(cli).await {
        Ok(output) => {
            if wants_json {
                println!("{}", serde_json::to_string(&output.json).unwrap());
            } else if !output.human.is_empty() {
                println!("{}", output.human);
            }
            0
        }
        Err(err) => {
            if wants_json {
                println!("{}", serde_json::to_string(&err.to_json()).unwrap());
            } else {
                eprintln!("{}: {}", err.code, err.message);
            }
            err.exit_code
        }
    }
}

async fn execute(cli: Cli) -> Result<CommandOutput, CliError> {
    let paths = AppPaths::from_cli(&cli);
    match &cli.command {
        Command::Create(cmd) => create_task(&paths, cmd).await,
        Command::Update(cmd) => update_task(&paths, cmd).await,
        Command::UpdateCurrent(cmd) => update_current_task(&paths, cmd).await,
        Command::List(cmd) => list_tasks(&paths, cmd).await,
        Command::Show(cmd) => show_task(&paths, cmd).await,
        Command::Pause(cmd) => task_status_action(&paths, METHOD_TASK_PAUSE, "paused", cmd).await,
        Command::Resume(cmd) => {
            task_status_action(&paths, METHOD_TASK_RESUME, "resumed", cmd).await
        }
        Command::Delete(cmd) => delete_task(&paths, cmd).await,
        Command::RunNow(cmd) => run_now(&paths, cmd).await,
        Command::History(cmd) => history(&paths, cmd).await,
        Command::Next(cmd) => next_times(&paths, cmd).await,
        Command::ValidateCron(cmd) => validate_cron_command(cmd),
        Command::Doctor(_) => doctor(&paths).await,
    }
}

#[derive(Debug, Clone)]
struct RpcClient {
    socket_path: PathBuf,
}

impl RpcClient {
    fn new(socket_path: PathBuf) -> Self {
        Self { socket_path }
    }

    async fn call<T, P>(&self, method: &str, params: P) -> Result<T, CliError>
    where
        T: DeserializeOwned,
        P: Serialize,
    {
        let response = self.call_raw(method, params).await?;
        if let Some(error) = response.error {
            return Err(map_rpc_error(error));
        }
        let result = response
            .result
            .ok_or_else(|| CliError::generic("missing rpc result"))?;
        serde_json::from_value(result).map_err(|err| CliError::generic(err.to_string()))
    }

    async fn call_raw<P>(&self, method: &str, params: P) -> Result<JsonRpcResponse, CliError>
    where
        P: Serialize,
    {
        let request = JsonRpcRequest {
            jsonrpc: JSONRPC_VERSION.to_owned(),
            id: Some(JsonRpcId::String("1".to_owned())),
            method: method.to_owned(),
            params: Some(
                serde_json::to_value(params).map_err(|err| CliError::generic(err.to_string()))?,
            ),
        };
        let line =
            serde_json::to_string(&request).map_err(|err| CliError::generic(err.to_string()))?;
        let stream = tokio::time::timeout(RPC_TIMEOUT, UnixStream::connect(&self.socket_path))
            .await
            .map_err(|_| CliError::daemon_unavailable("timed out connecting to daemon"))?
            .map_err(|err| CliError::daemon_unavailable(err.to_string()))?;
        let (read, mut write) = stream.into_split();
        write
            .write_all(line.as_bytes())
            .await
            .map_err(|err| CliError::daemon_unavailable(err.to_string()))?;
        write
            .write_all(b"\n")
            .await
            .map_err(|err| CliError::daemon_unavailable(err.to_string()))?;
        write
            .flush()
            .await
            .map_err(|err| CliError::daemon_unavailable(err.to_string()))?;

        let mut lines = BufReader::new(read).lines();
        let response = tokio::time::timeout(RPC_TIMEOUT, lines.next_line())
            .await
            .map_err(|_| CliError::daemon_unavailable("timed out waiting for daemon response"))?
            .map_err(|err| CliError::daemon_unavailable(err.to_string()))?
            .ok_or_else(|| CliError::daemon_unavailable("daemon closed connection"))?;
        serde_json::from_str(&response).map_err(|err| CliError::generic(err.to_string()))
    }
}

fn map_rpc_error(error: JsonRpcError) -> CliError {
    let exit_code = match error.code {
        code if code == JsonRpcErrorCode::TaskNotFound.code() => {
            JsonRpcErrorCode::TaskNotFound.exit_code()
        }
        code if code == JsonRpcErrorCode::RunNotFound.code() => {
            JsonRpcErrorCode::RunNotFound.exit_code()
        }
        code if code == JsonRpcErrorCode::ValidationFailed.code() => {
            JsonRpcErrorCode::ValidationFailed.exit_code()
        }
        code if code == JsonRpcErrorCode::PermissionDenied.code() => {
            JsonRpcErrorCode::PermissionDenied.exit_code()
        }
        code if code == JsonRpcErrorCode::Unavailable.code() => {
            JsonRpcErrorCode::Unavailable.exit_code()
        }
        code if code == JsonRpcErrorCode::ParseError.code()
            || code == JsonRpcErrorCode::InvalidRequest.code()
            || code == JsonRpcErrorCode::InvalidParams.code()
            || code == JsonRpcErrorCode::MethodNotFound.code() =>
        {
            JsonRpcErrorCode::InvalidParams.exit_code()
        }
        code if code == JsonRpcErrorCode::Conflict.code() => JsonRpcErrorCode::Conflict.exit_code(),
        code if code == JsonRpcErrorCode::InternalError.code() => {
            JsonRpcErrorCode::InternalError.exit_code()
        }
        code if code == JsonRpcErrorCode::Canceled.code() => JsonRpcErrorCode::Canceled.exit_code(),
        _ => 1,
    };
    let code = match exit_code {
        2 => "invalid_arguments",
        3 => "daemon_unavailable",
        4 => "permission_denied",
        5 => "validation_failed",
        6 => "task_not_found",
        7 => "database_error",
        _ => "error",
    };
    CliError {
        exit_code,
        code,
        message: error.message,
        details: error.data,
        daemon_connection_failed: false,
    }
}

async fn create_task(paths: &AppPaths, cmd: &CreateCommand) -> Result<CommandOutput, CliError> {
    ensure_write_token_if_scheduled()?;
    validate_task_fields(&cmd.fields, ValidationMode::Create)?;
    let client = RpcClient::new(paths.socket_path.clone());
    let existing: TaskListResult = match client
        .call(METHOD_TASK_LIST, TaskListParams::default())
        .await
    {
        Ok(existing) => existing,
        Err(err) => {
            if should_use_sqlite_write_fallback(paths, &err)? {
                return create_task_sqlite_fallback(paths, cmd).await;
            }
            return Err(write_requires_daemon(err));
        }
    };
    let slug = unique_slug(
        cmd.fields.name.as_deref().unwrap_or_default(),
        existing.tasks.iter().map(|task| task.slug.as_str()),
    )
    .map_err(|err| CliError::validation(err.to_string()))?;
    let mut task = build_create_task(&cmd.fields, slug)?;
    if let Err(err) = complete_project_fields(&client, &mut task, cmd.reason.as_deref()).await {
        if should_use_sqlite_write_fallback(paths, &err)? {
            return create_task_sqlite_fallback(paths, cmd).await;
        }
        return Err(err);
    }
    let params = TaskCreateParams {
        task,
        actor: Some(current_actor()),
    };
    let created: TaskResult = match client
        .call(
            METHOD_TASK_CREATE,
            add_invocation_metadata(params, cmd.reason.as_deref()),
        )
        .await
    {
        Ok(created) => created,
        Err(err) => {
            if should_use_sqlite_write_fallback(paths, &err)? {
                return create_task_sqlite_fallback(paths, cmd).await;
            }
            return Err(write_requires_daemon(err));
        }
    };
    task_summary_output(created.task)
}

async fn update_task(paths: &AppPaths, cmd: &UpdateCommand) -> Result<CommandOutput, CliError> {
    ensure_write_token_if_scheduled()?;
    validate_task_fields(&cmd.fields, ValidationMode::Patch)?;
    validate_clear_flags(&cmd.clear, &cmd.fields)?;
    let client = RpcClient::new(paths.socket_path.clone());
    let mut task = match get_task_via_daemon(&client, &cmd.id).await {
        Ok(task) => task,
        Err(err) => {
            if should_use_sqlite_write_fallback(paths, &err)? {
                return update_task_sqlite_fallback(paths, cmd).await;
            }
            return Err(write_requires_daemon(err));
        }
    };
    apply_task_patch(&mut task, &cmd.fields, &cmd.clear)?;
    if let Err(err) = complete_project_fields(&client, &mut task, cmd.reason.as_deref()).await {
        if should_use_sqlite_write_fallback(paths, &err)? {
            return update_task_sqlite_fallback(paths, cmd).await;
        }
        return Err(err);
    }
    let params = TaskUpdateParams {
        task,
        actor: Some(current_actor()),
    };
    let updated: TaskResult = match client
        .call(
            METHOD_TASK_UPDATE,
            add_invocation_metadata(params, cmd.reason.as_deref()),
        )
        .await
    {
        Ok(updated) => updated,
        Err(err) => {
            if should_use_sqlite_write_fallback(paths, &err)? {
                return update_task_sqlite_fallback(paths, cmd).await;
            }
            return Err(write_requires_daemon(err));
        }
    };
    task_summary_output(updated.task)
}

async fn update_current_task(
    paths: &AppPaths,
    cmd: &UpdateCurrentCommand,
) -> Result<CommandOutput, CliError> {
    let task_id = std::env::var("CODEX_SCHEDULER_CURRENT_TASK_ID")
        .map_err(|_| CliError::permission_denied("CODEX_SCHEDULER_CURRENT_TASK_ID is not set"))?;
    ensure_write_token_if_scheduled()?;

    validate_task_fields(&cmd.fields, ValidationMode::Patch)?;
    validate_clear_flags(&cmd.clear, &cmd.fields)?;
    let client = RpcClient::new(paths.socket_path.clone());
    let mut task = get_task_via_daemon(&client, &task_id)
        .await
        .map_err(write_requires_daemon)?;
    apply_task_patch(&mut task, &cmd.fields, &cmd.clear)?;
    if cmd.pause {
        task.status = TaskStatus::Paused;
    }
    complete_project_fields(&client, &mut task, cmd.reason.as_deref()).await?;
    let params = TaskUpdateParams {
        task,
        actor: Some(current_actor()),
    };
    let updated: TaskResult = client
        .call(
            METHOD_TASK_UPDATE,
            add_invocation_metadata(params, cmd.reason.as_deref()),
        )
        .await
        .map_err(write_requires_daemon)?;
    task_summary_output(updated.task)
}

async fn list_tasks(paths: &AppPaths, cmd: &ListCommand) -> Result<CommandOutput, CliError> {
    let status = parse_optional_enum::<TaskStatus>(cmd.status.as_deref(), "status")?;
    let client = RpcClient::new(paths.socket_path.clone());
    let tasks = match client
        .call::<TaskListResult, _>(METHOD_TASK_LIST, TaskListParams { status })
        .await
    {
        Ok(result) => result.tasks,
        Err(err) if err.exit_code == 3 => db_list_tasks(paths, status).await?,
        Err(err) => return Err(err),
    };
    Ok(CommandOutput {
        json: json!({
            "ok": true,
            "tasks": tasks.iter().map(task_summary_json).collect::<Vec<_>>(),
        }),
        human: format_task_table(&tasks),
    })
}

async fn show_task(paths: &AppPaths, cmd: &ShowCommand) -> Result<CommandOutput, CliError> {
    let client = RpcClient::new(paths.socket_path.clone());
    let task = match client
        .call::<TaskResult, _>(METHOD_TASK_GET, TaskGetParams { id: cmd.id.clone() })
        .await
    {
        Ok(result) => result.task,
        Err(err) if err.exit_code == 3 => db_get_task(paths, &cmd.id).await?,
        Err(err) => return Err(err),
    };
    task_output(task)
}

async fn task_status_action(
    paths: &AppPaths,
    method: &str,
    label: &str,
    cmd: &TaskActionCommand,
) -> Result<CommandOutput, CliError> {
    ensure_write_token_if_scheduled()?;
    let client = RpcClient::new(paths.socket_path.clone());
    let params = TaskIdParams {
        id: cmd.id.clone(),
        actor: Some(current_actor()),
    };
    let result: TaskResult = match client
        .call(
            method,
            add_invocation_metadata(params, cmd.reason.as_deref()),
        )
        .await
    {
        Ok(result) => result,
        Err(err) => {
            if should_use_sqlite_write_fallback(paths, &err)? {
                return task_status_sqlite_fallback(
                    paths,
                    &cmd.id,
                    label,
                    method,
                    cmd.reason.as_deref(),
                )
                .await;
            }
            return Err(write_requires_daemon(err));
        }
    };
    Ok(CommandOutput {
        json: json!({ "ok": true, "task": task_summary_json(&result.task) }),
        human: format!("{} {}", result.task.id, label),
    })
}

async fn delete_task(paths: &AppPaths, cmd: &TaskActionCommand) -> Result<CommandOutput, CliError> {
    ensure_write_token_if_scheduled()?;
    let client = RpcClient::new(paths.socket_path.clone());
    let params = TaskIdParams {
        id: cmd.id.clone(),
        actor: Some(current_actor()),
    };
    let result: TaskDeleteResult = match client
        .call(
            METHOD_TASK_DELETE,
            add_invocation_metadata(params, cmd.reason.as_deref()),
        )
        .await
    {
        Ok(result) => result,
        Err(err) => {
            if should_use_sqlite_write_fallback(paths, &err)? {
                return delete_task_sqlite_fallback(paths, cmd).await;
            }
            return Err(write_requires_daemon(err));
        }
    };
    Ok(CommandOutput {
        json: json!({ "ok": true, "deleted": result.deleted }),
        human: format!("deleted {}: {}", cmd.id, result.deleted),
    })
}

async fn run_now(paths: &AppPaths, cmd: &TaskActionCommand) -> Result<CommandOutput, CliError> {
    ensure_write_token_if_scheduled()?;
    let client = RpcClient::new(paths.socket_path.clone());
    let params = TaskIdParams {
        id: cmd.id.clone(),
        actor: Some(current_actor()),
    };
    let result: RunResult = client
        .call(
            METHOD_TASK_RUN_NOW,
            add_invocation_metadata(params, cmd.reason.as_deref()),
        )
        .await
        .map_err(write_requires_daemon)?;
    run_output(result.run)
}

async fn history(paths: &AppPaths, cmd: &HistoryCommand) -> Result<CommandOutput, CliError> {
    let status = parse_optional_enum::<RunStatus>(cmd.status.as_deref(), "status")?;
    let client = RpcClient::new(paths.socket_path.clone());
    let runs = match client
        .call::<RunListResult, _>(
            METHOD_RUN_LIST,
            RunListParams {
                task_id: Some(cmd.task_id.clone()),
                status,
            },
        )
        .await
    {
        Ok(result) => result.runs,
        Err(err) if err.exit_code == 3 => db_list_runs(paths, &cmd.task_id, status).await?,
        Err(err) => return Err(err),
    };
    Ok(CommandOutput {
        json: json!({ "ok": true, "runs": runs }),
        human: format_run_table(&runs),
    })
}

async fn next_times(paths: &AppPaths, cmd: &NextCommand) -> Result<CommandOutput, CliError> {
    validate_count(cmd.count)?;
    if cmd.cron.is_some() && cmd.task_id.is_some() {
        return Err(CliError::validation(
            "next accepts either a task id or --cron, not both",
        ));
    }

    let (times, timezone_name) = if let Some(expr) = &cmd.cron {
        let timezone_name = cmd.timezone.clone().unwrap_or_else(default_timezone_name);
        (
            preview_cron_times(expr, &timezone_name, cmd.count)?,
            timezone_name,
        )
    } else {
        let task_id = cmd
            .task_id
            .as_ref()
            .ok_or_else(|| CliError::validation("next requires a task id or --cron"))?;
        let task = read_task(paths, task_id).await?;
        let timezone_name = task.timezone.clone();
        (preview_task_times(&task, cmd.count)?, timezone_name)
    };
    Ok(CommandOutput {
        json: json!({ "ok": true, "times": times }),
        human: times
            .iter()
            .map(|time| format!("{time} {timezone_name}"))
            .collect::<Vec<_>>()
            .join("\n"),
    })
}

fn validate_cron_command(cmd: &ValidateCronCommand) -> Result<CommandOutput, CliError> {
    validate_count(cmd.count)?;
    let timezone_name = cmd.timezone.clone().unwrap_or_else(default_timezone_name);
    let times = preview_cron_times(&cmd.cron, &timezone_name, cmd.count)?;
    Ok(CommandOutput {
        json: json!({
            "ok": true,
            "valid": true,
            "cron": cmd.cron,
            "timezone": timezone_name,
            "times": times,
        }),
        human: format!("valid cron: {}", cmd.cron),
    })
}

async fn doctor(paths: &AppPaths) -> Result<CommandOutput, CliError> {
    let mut checks = Vec::new();

    let client = RpcClient::new(paths.socket_path.clone());
    match client
        .call::<DaemonHealthResult, _>(METHOD_DAEMON_HEALTH, DaemonHealthParams {})
        .await
    {
        Ok(health) => checks.push(check_ok(
            "daemonSocket",
            format!("reachable, version {}", health.version),
        )),
        Err(err) => checks.push(check_fail("daemonSocket", err.message)),
    }

    match client
        .call::<DaemonDiagnosticsResult, _>(METHOD_DAEMON_DIAGNOSTICS, DaemonDiagnosticsParams {})
        .await
    {
        Ok(diagnostics) => checks.push(json!({
            "name": "daemonDiagnostics",
            "status": "ok",
            "message": format!(
                "db={} bytes, logs={} bytes, schedulerEnabled={}",
                diagnostics.db_size_bytes,
                diagnostics.logs_size_bytes,
                diagnostics.scheduler_enabled
            ),
            "details": diagnostics
        })),
        Err(err) => checks.push(check_fail("daemonDiagnostics", err.message)),
    }

    match ensure_data_dir_writable(paths) {
        Ok(()) => checks.push(check_ok(
            "dataDirWritable",
            paths.data_dir.display().to_string(),
        )),
        Err(err) => checks.push(check_fail("dataDirWritable", err.to_string())),
    }

    match sqlite_read_write(paths).await {
        Ok(()) => checks.push(check_ok(
            "sqliteReadWrite",
            paths.db_path.display().to_string(),
        )),
        Err(err) => checks.push(check_fail("sqliteReadWrite", err.message)),
    }

    let codex_path = configured_codex_path(paths).await;
    match &codex_path {
        Some(path) => checks.push(check_ok("codexPathConfigured", path.clone())),
        None => checks.push(check_fail(
            "codexPathConfigured",
            "runner.codex_path is not set; using PATH lookup for version check",
        )),
    }
    let command = codex_path.unwrap_or_else(|| "codex".to_owned());
    match std::process::Command::new(&command)
        .arg("--version")
        .output()
    {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            checks.push(check_ok("codexVersion", stdout));
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            checks.push(check_fail("codexVersion", stderr));
        }
        Err(err) => checks.push(check_fail("codexVersion", err.to_string())),
    }

    match validate_iana_timezone("UTC") {
        Ok(_) => checks.push(check_ok("timezoneDb", "UTC available")),
        Err(err) => checks.push(check_fail("timezoneDb", err.to_string())),
    }

    checks.push(json!({
        "name": "notificationPermission",
        "status": "unknown",
        "message": "not implemented in CLI doctor"
    }));

    let healthy = checks
        .iter()
        .all(|check| check["status"].as_str() != Some("fail"));
    let human = checks
        .iter()
        .map(|check| {
            format!(
                "{}\t{}\t{}",
                check["status"].as_str().unwrap_or("unknown"),
                check["name"].as_str().unwrap_or("check"),
                check["message"].as_str().unwrap_or("")
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    Ok(CommandOutput {
        json: json!({ "ok": true, "healthy": healthy, "checks": checks }),
        human,
    })
}

fn check_ok(name: &str, message: impl Into<String>) -> Value {
    json!({ "name": name, "status": "ok", "message": message.into() })
}

fn check_fail(name: &str, message: impl Into<String>) -> Value {
    json!({ "name": name, "status": "fail", "message": message.into() })
}

async fn get_task_via_daemon(client: &RpcClient, id: &str) -> Result<TaskDto, CliError> {
    client
        .call::<TaskResult, _>(METHOD_TASK_GET, TaskGetParams { id: id.to_owned() })
        .await
        .map(|result| result.task)
}

async fn read_task(paths: &AppPaths, id: &str) -> Result<TaskDto, CliError> {
    let client = RpcClient::new(paths.socket_path.clone());
    match client
        .call::<TaskResult, _>(METHOD_TASK_GET, TaskGetParams { id: id.to_owned() })
        .await
    {
        Ok(result) => Ok(result.task),
        Err(err) if err.exit_code == 3 => db_get_task(paths, id).await,
        Err(err) => Err(err),
    }
}

async fn db(paths: &AppPaths) -> Result<SchedulerDb, CliError> {
    SchedulerDb::connect(&paths.db_path)
        .await
        .map_err(|err| CliError::database(err.to_string()))
}

async fn db_list_tasks(
    paths: &AppPaths,
    status: Option<TaskStatus>,
) -> Result<Vec<TaskDto>, CliError> {
    let db = db(paths).await?;
    let tasks = db
        .list_tasks()
        .await
        .map_err(|err| CliError::database(err.to_string()))?;
    Ok(tasks
        .iter()
        .filter(|task| status.map(|status| task.status == status).unwrap_or(true))
        .map(TaskDto::from)
        .collect())
}

async fn db_get_task(paths: &AppPaths, id: &str) -> Result<TaskDto, CliError> {
    let db = db(paths).await?;
    db.get_task(id)
        .await
        .map_err(|err| CliError::database(err.to_string()))?
        .as_ref()
        .map(TaskDto::from)
        .ok_or_else(|| CliError::task_not_found("task not found"))
}

async fn db_list_runs(
    paths: &AppPaths,
    task_id: &str,
    status: Option<RunStatus>,
) -> Result<Vec<RunDto>, CliError> {
    let db = db(paths).await?;
    let runs = db
        .list_runs_for_task(task_id)
        .await
        .map_err(|err| CliError::database(err.to_string()))?;
    Ok(runs
        .iter()
        .filter(|run| status.map(|status| run.status == status).unwrap_or(true))
        .map(RunDto::from)
        .collect())
}

async fn create_task_sqlite_fallback(
    paths: &AppPaths,
    cmd: &CreateCommand,
) -> Result<CommandOutput, CliError> {
    let db = db(paths).await?;
    let existing = db.list_tasks().await.map_err(scheduler_error_to_cli)?;
    let slug = unique_slug(
        cmd.fields.name.as_deref().unwrap_or_default(),
        existing.iter().map(|task| task.slug.as_str()),
    )
    .map_err(|err| CliError::validation(err.to_string()))?;
    let dto = build_create_task(&cmd.fields, slug)?;
    let mut task = Task::try_from(dto).map_err(scheduler_error_to_cli)?;
    apply_repo_path_trust_policy_sqlite(&db, &mut task).await?;
    prepare_task_schedule_sqlite(&mut task);
    task.created_by = AuditActorType::Cli.as_str().to_owned();
    task.created_by_run_id = None;
    task.updated_at = now_rfc3339();
    db.create_task(&task)
        .await
        .map_err(scheduler_error_to_cli)?;
    create_task_audit_sqlite(
        &db,
        Some(&task.id),
        "task.create",
        None,
        Some(serde_json::to_value(TaskDto::from(&task)).map_err(json_to_cli)?),
        cmd.reason.as_deref(),
    )
    .await?;
    task_summary_output(TaskDto::from(&task))
}

async fn update_task_sqlite_fallback(
    paths: &AppPaths,
    cmd: &UpdateCommand,
) -> Result<CommandOutput, CliError> {
    let db = db(paths).await?;
    let before = db
        .get_task(&cmd.id)
        .await
        .map_err(scheduler_error_to_cli)?
        .ok_or_else(|| CliError::task_not_found("task not found"))?;
    ensure_unlocked_for_cli(&before, "task.update")?;
    let before_json = serde_json::to_value(TaskDto::from(&before)).map_err(json_to_cli)?;
    let mut dto = TaskDto::from(&before);
    apply_task_patch(&mut dto, &cmd.fields, &cmd.clear)?;
    let mut task = Task::try_from(dto).map_err(scheduler_error_to_cli)?;
    task.created_at = before.created_at;
    task.created_by = before.created_by;
    task.created_by_run_id = before.created_by_run_id;
    task.deleted_at = before.deleted_at;
    task.updated_at = now_rfc3339();
    apply_repo_path_trust_policy_sqlite(&db, &mut task).await?;
    prepare_task_schedule_sqlite(&mut task);
    db.update_task(&task)
        .await
        .map_err(scheduler_error_to_cli)?;
    create_task_audit_sqlite(
        &db,
        Some(&task.id),
        "task.update",
        Some(before_json),
        Some(serde_json::to_value(TaskDto::from(&task)).map_err(json_to_cli)?),
        cmd.reason.as_deref(),
    )
    .await?;
    task_summary_output(TaskDto::from(&task))
}

async fn task_status_sqlite_fallback(
    paths: &AppPaths,
    id: &str,
    label: &str,
    method: &str,
    reason: Option<&str>,
) -> Result<CommandOutput, CliError> {
    let db = db(paths).await?;
    let mut task = db
        .get_task(id)
        .await
        .map_err(scheduler_error_to_cli)?
        .ok_or_else(|| CliError::task_not_found("task not found"))?;
    ensure_unlocked_for_cli(&task, method)?;
    let before_json = serde_json::to_value(TaskDto::from(&task)).map_err(json_to_cli)?;
    task.status = if method == METHOD_TASK_PAUSE {
        TaskStatus::Paused
    } else {
        TaskStatus::Active
    };
    if task.status == TaskStatus::Active && task.next_run_at.is_none() {
        prepare_task_schedule_sqlite(&mut task);
    }
    task.updated_at = now_rfc3339();
    db.update_task(&task)
        .await
        .map_err(scheduler_error_to_cli)?;
    create_task_audit_sqlite(
        &db,
        Some(&task.id),
        method,
        Some(before_json),
        Some(serde_json::to_value(TaskDto::from(&task)).map_err(json_to_cli)?),
        reason,
    )
    .await?;
    Ok(CommandOutput {
        json: json!({ "ok": true, "task": task_summary_json(&TaskDto::from(&task)) }),
        human: format!("{} {}", task.id, label),
    })
}

async fn delete_task_sqlite_fallback(
    paths: &AppPaths,
    cmd: &TaskActionCommand,
) -> Result<CommandOutput, CliError> {
    let db = db(paths).await?;
    let before = db
        .get_task(&cmd.id)
        .await
        .map_err(scheduler_error_to_cli)?
        .ok_or_else(|| CliError::task_not_found("task not found"))?;
    ensure_unlocked_for_cli(&before, "task.delete")?;
    let deleted = db
        .delete_task(&cmd.id, &now_rfc3339())
        .await
        .map_err(scheduler_error_to_cli)?;
    create_task_audit_sqlite(
        &db,
        Some(&cmd.id),
        "task.delete",
        Some(serde_json::to_value(TaskDto::from(&before)).map_err(json_to_cli)?),
        None,
        cmd.reason.as_deref(),
    )
    .await?;
    Ok(CommandOutput {
        json: json!({ "ok": true, "deleted": deleted }),
        human: format!("deleted {}: {}", cmd.id, deleted),
    })
}

async fn apply_repo_path_trust_policy_sqlite(
    db: &SchedulerDb,
    task: &mut Task,
) -> Result<(), CliError> {
    let Some(repo_path) = task.repo_path.clone() else {
        return Ok(());
    };
    let canonical = std::fs::canonicalize(&repo_path).map_err(|err| {
        CliError::validation(format!(
            "unable to canonicalize repo_path `{repo_path}`: {err}"
        ))
    })?;
    let canonical_str = canonical.to_string_lossy().into_owned();
    task.repo_path = Some(canonical_str.clone());

    let Some(project) = trusted_project_for_path(db, &canonical).await? else {
        return Err(CliError::validation(format!(
            "project.trust is required before scheduling repo_path `{canonical_str}`"
        )));
    };

    let Some(git_root) = project
        .git_root
        .clone()
        .filter(|root| project.kind == ProjectKind::Git && !root.trim().is_empty())
    else {
        return Err(CliError::validation(
            "project target requires a registered git repository",
        ));
    };
    task.target_mode = RunTargetMode::RepoWorktree;
    task.project_id = Some(project.id);
    task.repo_path = Some(git_root);
    Ok(())
}

async fn trusted_project_for_path(
    db: &SchedulerDb,
    path: &Path,
) -> Result<Option<Project>, CliError> {
    let projects = db.list_projects().await.map_err(scheduler_error_to_cli)?;
    Ok(projects
        .into_iter()
        .filter(|project| {
            project.trusted_at.is_some()
                && project.kind == ProjectKind::Git
                && project.git_root.is_some()
        })
        .find(|project| {
            let root = project.git_root.as_deref().unwrap_or(&project.path);
            path.starts_with(Path::new(root))
        }))
}

fn prepare_task_schedule_sqlite(task: &mut Task) {
    if task.status != TaskStatus::Active || task.next_run_at.is_some() {
        return;
    }
    match compute_next_run_at(task, Utc::now()) {
        Ok(next_run_at) => {
            task.next_run_at = next_run_at.map(format_utc_rfc3339);
            task.schedule_status = ScheduleStatus::Valid;
            task.schedule_error = None;
        }
        Err(err) => {
            task.schedule_status = ScheduleStatus::Invalid;
            task.schedule_error = Some(err.to_string());
        }
    }
}

async fn create_task_audit_sqlite(
    db: &SchedulerDb,
    task_id: Option<&str>,
    action: &str,
    before: Option<Value>,
    after: Option<Value>,
    reason: Option<&str>,
) -> Result<(), CliError> {
    let event = TaskAuditEvent {
        id: new_task_audit_event_id(),
        task_id: task_id.map(str::to_owned),
        actor_type: AuditActorType::Cli,
        actor_id: None,
        action: action.to_owned(),
        before_json: before
            .map(|value| serde_json::to_string(&value))
            .transpose()
            .map_err(json_to_cli)?,
        after_json: after
            .map(|value| serde_json::to_string(&value))
            .transpose()
            .map_err(json_to_cli)?,
        reason: reason.map(str::to_owned),
        created_at: now_rfc3339(),
    };
    db.create_task_audit_event(&event)
        .await
        .map_err(scheduler_error_to_cli)
}

async fn complete_project_fields(
    client: &RpcClient,
    task: &mut TaskDto,
    reason: Option<&str>,
) -> Result<(), CliError> {
    if task.target.mode != RunTargetMode::RepoWorktree {
        return Ok(());
    }
    let repo_path = task
        .target
        .repo_path
        .clone()
        .ok_or_else(|| CliError::validation("repo-worktree target requires --repo"))?;
    let params = ProjectTrustParams {
        path: repo_path,
        actor: Some(current_actor()),
    };
    let project: ProjectTrustResult = client
        .call(
            METHOD_PROJECT_TRUST,
            add_invocation_metadata(params, reason),
        )
        .await?;
    if project.project.kind != ProjectKind::Git || project.project.git_root.is_none() {
        return Err(CliError::validation(
            "repo-worktree target requires a git repository",
        ));
    }
    task.target.project_id = Some(project.project.id);
    task.target.repo_path = project.project.git_root;
    Ok(())
}

fn ensure_unlocked_for_cli(task: &Task, operation: &str) -> Result<(), CliError> {
    if task.locked {
        return Err(CliError::permission_denied(format!(
            "{operation} is blocked because task `{}` is locked",
            task.id
        )));
    }
    Ok(())
}

fn build_create_task(fields: &TaskFields, slug: String) -> Result<TaskDto, CliError> {
    let name = fields
        .name
        .as_ref()
        .ok_or_else(|| CliError::validation("create requires --name"))?
        .clone();
    let prompt = read_prompt(fields)?;
    let schedule = schedule_from_fields(fields, None)?;
    let target = target_from_fields(fields, None)?;
    Ok(TaskDto {
        id: String::new(),
        slug,
        name,
        status: if fields.paused {
            TaskStatus::Paused
        } else {
            TaskStatus::Active
        },
        locked: false,
        kind: schedule.kind,
        cron_expr: schedule.cron_expr,
        run_at: schedule.run_at,
        timezone: schedule.timezone,
        next_run_at: schedule.next_run_at,
        target,
        codex: TaskCodexDto {
            model: fields.model.clone(),
            reasoning_effort: fields.reasoning_effort.clone(),
            sandbox_mode: parse_enum_or_default::<SandboxMode>(fields.sandbox.as_deref())?,
            approval_policy: parse_enum_or_default::<ApprovalPolicy>(
                fields.approval_policy.as_deref(),
            )?,
        },
        prompt: TaskPromptDto {
            body: prompt,
            inject_scheduler_instructions: true,
        },
        policies: TaskPoliciesDto {
            allow_schedule_cli: fields.allow_schedule_cli.unwrap_or(true),
            missed_policy: parse_enum_or_default::<MissedPolicy>(fields.missed_policy.as_deref())?,
            overlap_policy: parse_enum_or_default::<OverlapPolicy>(
                fields.overlap_policy.as_deref(),
            )?,
            max_runtime_sec: fields.max_runtime_sec.unwrap_or(DEFAULT_MAX_RUNTIME_SEC),
            max_created_schedules_per_run: Some(max_created_schedules_value(fields)),
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
    })
}

fn apply_task_patch(
    task: &mut TaskDto,
    fields: &TaskFields,
    clear: &ClearFlags,
) -> Result<(), CliError> {
    if let Some(name) = &fields.name {
        validate_name(name)?;
        task.name = name.clone();
    }
    if fields.prompt.is_some() || fields.prompt_file.is_some() {
        task.prompt.body = read_prompt(fields)?;
    }

    if has_schedule_patch(fields) {
        let schedule = schedule_from_fields(fields, Some(task))?;
        task.kind = schedule.kind;
        task.run_at = schedule.run_at;
        task.cron_expr = schedule.cron_expr;
        task.timezone = schedule.timezone;
        task.next_run_at = schedule.next_run_at;
    } else if let Some(timezone) = &fields.timezone {
        task.timezone = validate_timezone_name(timezone)?;
        task.next_run_at = None;
    }
    if clear.clear_run_at {
        task.run_at = None;
        task.next_run_at = None;
    }
    if clear.clear_cron {
        task.cron_expr = None;
        task.next_run_at = None;
    }

    if has_target_patch(fields) {
        task.target = target_from_fields(fields, Some(task))?;
    } else if let Some(base_ref) = &fields.base_ref {
        task.target.base_ref = Some(base_ref.clone());
    }
    if clear.clear_base_ref {
        task.target.base_ref = None;
    }

    if let Some(model) = &fields.model {
        task.codex.model = Some(model.clone());
    }
    if clear.clear_model {
        task.codex.model = None;
    }
    if let Some(reasoning_effort) = &fields.reasoning_effort {
        task.codex.reasoning_effort = Some(reasoning_effort.clone());
    }
    if clear.clear_reasoning_effort {
        task.codex.reasoning_effort = None;
    }
    if let Some(sandbox) = &fields.sandbox {
        task.codex.sandbox_mode = parse_enum::<SandboxMode>(sandbox, "sandbox")?;
    }
    if let Some(approval_policy) = &fields.approval_policy {
        task.codex.approval_policy =
            parse_enum::<ApprovalPolicy>(approval_policy, "approval-policy")?;
    }
    if let Some(allow_schedule_cli) = fields.allow_schedule_cli {
        task.policies.allow_schedule_cli = allow_schedule_cli;
    }
    if let Some(max_runtime_sec) = fields.max_runtime_sec {
        validate_positive(max_runtime_sec, "max-runtime-sec")?;
        task.policies.max_runtime_sec = max_runtime_sec;
    }
    if fields.max_created_schedules.is_some() {
        task.policies.max_created_schedules_per_run = Some(max_created_schedules_value(fields));
    }
    if let Some(missed_policy) = &fields.missed_policy {
        task.policies.missed_policy = parse_enum::<MissedPolicy>(missed_policy, "missed-policy")?;
    }
    if let Some(overlap_policy) = &fields.overlap_policy {
        task.policies.overlap_policy =
            parse_enum::<OverlapPolicy>(overlap_policy, "overlap-policy")?;
    }
    if fields.paused {
        task.status = TaskStatus::Paused;
    }

    Ok(())
}

struct ScheduleFields {
    kind: TaskKind,
    run_at: Option<String>,
    cron_expr: Option<String>,
    timezone: String,
    next_run_at: Option<String>,
}

fn schedule_from_fields(
    fields: &TaskFields,
    existing: Option<&TaskDto>,
) -> Result<ScheduleFields, CliError> {
    let timezone = fields
        .timezone
        .as_ref()
        .map(|tz| validate_timezone_name(tz))
        .transpose()?
        .or_else(|| existing.map(|task| task.timezone.clone()))
        .unwrap_or_else(default_timezone_name);

    if let Some(at) = &fields.at {
        let run_at = parse_rfc3339_utc(at)
            .map(format_utc_rfc3339)
            .map_err(|err| CliError::validation(err.to_string()))?;
        return Ok(ScheduleFields {
            kind: TaskKind::Once,
            run_at: Some(run_at.clone()),
            cron_expr: None,
            timezone,
            next_run_at: Some(run_at),
        });
    }
    if let Some(cron) = &fields.cron {
        let cron_expr = validate_cron(cron)
            .map_err(|err| CliError::schedule_parse(err.to_string(), json!({ "input": cron })))?
            .expression()
            .to_owned();
        return Ok(ScheduleFields {
            kind: TaskKind::Cron,
            run_at: None,
            cron_expr: Some(cron_expr),
            timezone,
            next_run_at: None,
        });
    }
    if fields.manual {
        return Ok(ScheduleFields {
            kind: TaskKind::Manual,
            run_at: None,
            cron_expr: None,
            timezone,
            next_run_at: None,
        });
    }
    if let Some(task) = existing {
        return Ok(ScheduleFields {
            kind: task.kind,
            run_at: task.run_at.clone(),
            cron_expr: task.cron_expr.clone(),
            timezone,
            next_run_at: task.next_run_at.clone(),
        });
    }
    Err(CliError::validation(
        "create requires one of --at, --cron, or --manual",
    ))
}

fn target_from_fields(
    fields: &TaskFields,
    existing: Option<&TaskDto>,
) -> Result<TaskTargetDto, CliError> {
    if fields.chat {
        return Ok(TaskTargetDto {
            mode: RunTargetMode::Chat,
            project_id: None,
            repo_path: None,
            base_ref: None,
        });
    }
    if let Some(repo) = &fields.repo {
        let repo_path = normalize_repo_path(repo)?;
        return Ok(TaskTargetDto {
            mode: RunTargetMode::RepoWorktree,
            project_id: None,
            repo_path: Some(repo_path),
            base_ref: fields
                .base_ref
                .clone()
                .or_else(|| existing.and_then(|task| task.target.base_ref.clone())),
        });
    }
    if let Some(task) = existing {
        let mut target = task.target.clone();
        if target.mode != RunTargetMode::Chat {
            target.mode = RunTargetMode::RepoWorktree;
        }
        if fields.base_ref.is_some() {
            target.base_ref = fields.base_ref.clone();
        }
        return Ok(target);
    }
    Err(CliError::validation("create requires --chat or --repo"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ValidationMode {
    Create,
    Patch,
}

fn validate_task_fields(fields: &TaskFields, mode: ValidationMode) -> Result<(), CliError> {
    if let Some(name) = &fields.name {
        validate_name(name)?;
    } else if mode == ValidationMode::Create {
        return Err(CliError::validation("create requires --name"));
    }

    if fields.prompt.is_some() && fields.prompt_file.is_some() {
        return Err(CliError::validation(
            "--prompt and --prompt-file are mutually exclusive",
        ));
    }
    if mode == ValidationMode::Create && fields.prompt.is_none() && fields.prompt_file.is_none() {
        return Err(CliError::validation(
            "create requires --prompt or --prompt-file",
        ));
    }

    let schedule_count =
        fields.at.is_some() as u8 + fields.cron.is_some() as u8 + fields.manual as u8;
    match mode {
        ValidationMode::Create if schedule_count != 1 => {
            return Err(CliError::validation(
                "create requires exactly one of --at, --cron, or --manual",
            ));
        }
        ValidationMode::Patch if schedule_count > 1 => {
            return Err(CliError::validation(
                "--at, --cron, and --manual are mutually exclusive",
            ));
        }
        _ => {}
    }
    if let Some(at) = &fields.at {
        parse_rfc3339_utc(at).map_err(|err| CliError::validation(err.to_string()))?;
    }
    if let Some(cron) = &fields.cron {
        validate_cron(cron)
            .map_err(|err| CliError::schedule_parse(err.to_string(), json!({ "input": cron })))?;
    }
    if let Some(timezone) = &fields.timezone {
        validate_timezone_name(timezone)?;
    }

    if fields.chat && fields.repo.is_some() {
        return Err(CliError::validation(
            "--chat and --repo are mutually exclusive",
        ));
    }
    if mode == ValidationMode::Create && !fields.chat && fields.repo.is_none() {
        return Err(CliError::validation("create requires --chat or --repo"));
    }
    if let Some(repo) = &fields.repo {
        normalize_repo_path(repo)?;
    }

    if fields.prompt.is_some() || fields.prompt_file.is_some() {
        let prompt = read_prompt(fields)?;
        validate_prompt_size(&prompt)?;
    }
    if let Some(max_runtime_sec) = fields.max_runtime_sec {
        validate_positive(max_runtime_sec, "max-runtime-sec")?;
    }
    parse_optional_enum::<SandboxMode>(fields.sandbox.as_deref(), "sandbox")?;
    parse_optional_enum::<ApprovalPolicy>(fields.approval_policy.as_deref(), "approval-policy")?;
    parse_optional_enum::<MissedPolicy>(fields.missed_policy.as_deref(), "missed-policy")?;
    parse_optional_enum::<OverlapPolicy>(fields.overlap_policy.as_deref(), "overlap-policy")?;

    Ok(())
}

fn validate_clear_flags(clear: &ClearFlags, fields: &TaskFields) -> Result<(), CliError> {
    if clear.clear_run_at && fields.at.is_some() {
        return Err(CliError::validation("--clear-run-at conflicts with --at"));
    }
    if clear.clear_cron && fields.cron.is_some() {
        return Err(CliError::validation("--clear-cron conflicts with --cron"));
    }
    if clear.clear_base_ref && fields.base_ref.is_some() {
        return Err(CliError::validation(
            "--clear-base-ref conflicts with --base-ref",
        ));
    }
    if clear.clear_model && fields.model.is_some() {
        return Err(CliError::validation("--clear-model conflicts with --model"));
    }
    if clear.clear_reasoning_effort && fields.reasoning_effort.is_some() {
        return Err(CliError::validation(
            "--clear-reasoning-effort conflicts with --reasoning-effort",
        ));
    }
    Ok(())
}

fn validate_name(name: &str) -> Result<(), CliError> {
    let count = name.chars().count();
    if (1..=120).contains(&count) {
        Ok(())
    } else {
        Err(CliError::validation_details(
            "name must be 1-120 characters",
            json!({ "length": count }),
        ))
    }
}

fn validate_prompt_size(prompt: &str) -> Result<(), CliError> {
    let len = prompt.len();
    if len <= PROMPT_MAX_BYTES {
        Ok(())
    } else {
        Err(CliError::validation_details(
            "prompt must be at most 200KB",
            json!({ "bytes": len, "maxBytes": PROMPT_MAX_BYTES }),
        ))
    }
}

fn validate_positive(value: i64, field: &str) -> Result<(), CliError> {
    if value > 0 {
        Ok(())
    } else {
        Err(CliError::validation(format!("{field} must be positive")))
    }
}

fn max_created_schedules_value(fields: &TaskFields) -> i64 {
    fields.max_created_schedules.unwrap_or(5).clamp(1, 100)
}

fn validate_count(count: usize) -> Result<(), CliError> {
    if (1..=100).contains(&count) {
        Ok(())
    } else {
        Err(CliError::validation("--count must be between 1 and 100"))
    }
}

fn validate_timezone_name(timezone: &str) -> Result<String, CliError> {
    validate_iana_timezone(timezone)
        .map(|_| timezone.to_owned())
        .map_err(|err| CliError::validation(err.to_string()))
}

fn normalize_repo_path(path: &Path) -> Result<String, CliError> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|err| CliError::validation(err.to_string()))?
            .join(path)
    };
    std::fs::canonicalize(&absolute)
        .map_err(|err| {
            CliError::validation_details(
                format!("unable to canonicalize --repo path: {err}"),
                json!({ "path": path.display().to_string() }),
            )
        })
        .map(|path| path.to_string_lossy().into_owned())
}

fn read_prompt(fields: &TaskFields) -> Result<String, CliError> {
    if let Some(prompt) = &fields.prompt {
        validate_prompt_size(prompt)?;
        return Ok(prompt.clone());
    }
    let Some(path) = &fields.prompt_file else {
        return Err(CliError::validation("missing prompt"));
    };
    let bytes = std::fs::read(path).map_err(|err| {
        CliError::validation_details(
            format!("unable to read prompt file: {err}"),
            json!({ "path": path.display().to_string() }),
        )
    })?;
    if bytes.len() > PROMPT_MAX_BYTES {
        return Err(CliError::validation_details(
            "prompt must be at most 200KB",
            json!({ "bytes": bytes.len(), "maxBytes": PROMPT_MAX_BYTES }),
        ));
    }
    String::from_utf8(bytes).map_err(|err| CliError::validation(err.to_string()))
}

fn has_schedule_patch(fields: &TaskFields) -> bool {
    fields.at.is_some() || fields.cron.is_some() || fields.manual
}

fn has_target_patch(fields: &TaskFields) -> bool {
    fields.chat || fields.repo.is_some()
}

fn parse_optional_enum<T>(value: Option<&str>, field: &str) -> Result<Option<T>, CliError>
where
    T: FromStr,
    T::Err: std::fmt::Display,
{
    value.map(|value| parse_enum(value, field)).transpose()
}

fn parse_enum_or_default<T>(value: Option<&str>) -> Result<T, CliError>
where
    T: FromStr + Default,
    T::Err: std::fmt::Display,
{
    value
        .map(|value| parse_enum(value, "value"))
        .transpose()
        .map(|value| value.unwrap_or_default())
}

fn parse_enum<T>(value: &str, field: &str) -> Result<T, CliError>
where
    T: FromStr,
    T::Err: std::fmt::Display,
{
    value
        .parse::<T>()
        .map_err(|err| CliError::validation(format!("invalid {field}: {err}")))
}

fn preview_cron_times(
    expr: &str,
    timezone_name: &str,
    count: usize,
) -> Result<Vec<String>, CliError> {
    let schedule = validate_cron(expr)
        .map_err(|err| CliError::schedule_parse(err.to_string(), json!({ "input": expr })))?;
    let timezone = validate_iana_timezone(timezone_name)
        .map_err(|err| CliError::validation(err.to_string()))?;
    Ok(schedule
        .preview(timezone, Utc::now(), count)
        .map_err(|err| CliError::schedule_parse(err.to_string(), json!({ "input": expr })))?
        .into_iter()
        .map(|time| time.with_timezone(&timezone).to_rfc3339())
        .collect())
}

fn preview_task_times(task: &TaskDto, count: usize) -> Result<Vec<String>, CliError> {
    match task.kind {
        TaskKind::Manual => Ok(Vec::new()),
        TaskKind::Once => {
            let Some(run_at) = task.run_at.as_deref() else {
                return Ok(Vec::new());
            };
            let timezone = validate_iana_timezone(&task.timezone)
                .map_err(|err| CliError::validation(err.to_string()))?;
            let time =
                parse_utc_rfc3339(run_at).map_err(|err| CliError::validation(err.to_string()))?;
            Ok(vec![time.with_timezone(&timezone).to_rfc3339()])
        }
        TaskKind::Cron => {
            let cron = task.cron_expr.as_deref().ok_or_else(|| {
                CliError::schedule_parse("cron task is missing cronExpr", json!({}))
            })?;
            preview_cron_times(cron, &task.timezone, count)
        }
    }
}

fn default_timezone_name() -> String {
    if let Some(timezone) = std::env::var("TZ")
        .ok()
        .filter(|tz| validate_iana_timezone(tz).is_ok())
    {
        return timezone;
    }

    if let Ok(target) = std::fs::read_link("/etc/localtime") {
        let target = target.to_string_lossy();
        if let Some((_, timezone)) = target.rsplit_once("zoneinfo/") {
            if validate_iana_timezone(timezone).is_ok() {
                return timezone.to_owned();
            }
        }
    }

    DEFAULT_TIMEZONE.to_owned()
}

fn task_output(task: TaskDto) -> Result<CommandOutput, CliError> {
    Ok(CommandOutput {
        json: json!({ "ok": true, "task": task }),
        human: format_task_line(&task),
    })
}

fn task_summary_output(task: TaskDto) -> Result<CommandOutput, CliError> {
    Ok(CommandOutput {
        json: json!({ "ok": true, "task": task_summary_json(&task) }),
        human: format_task_line(&task),
    })
}

fn task_summary_json(task: &TaskDto) -> Value {
    json!({
        "id": task.id,
        "slug": task.slug,
        "name": task.name,
        "kind": task.kind,
        "status": task.status,
        "nextRunAt": task.next_run_at,
        "timezone": task.timezone,
        "targetMode": task.target.mode,
        "cronExpr": task.cron_expr,
        "runAt": task.run_at,
        "projectId": task.target.project_id,
        "repoPath": task.target.repo_path,
        "baseRef": task.target.base_ref,
    })
}

fn run_output(run: RunDto) -> Result<CommandOutput, CliError> {
    Ok(CommandOutput {
        json: json!({ "ok": true, "run": run }),
        human: format_run_line(&run),
    })
}

fn format_task_table(tasks: &[TaskDto]) -> String {
    let mut lines = vec!["ID\tSTATUS\tKIND\tNEXT RUN\tNAME".to_owned()];
    lines.extend(tasks.iter().map(format_task_line));
    lines.join("\n")
}

fn format_task_line(task: &TaskDto) -> String {
    format!(
        "{}\t{}\t{}\t{}\t{}",
        task.id,
        task.status,
        task.kind,
        task.next_run_at.as_deref().unwrap_or("-"),
        task.name
    )
}

fn format_run_table(runs: &[RunDto]) -> String {
    let mut lines = vec!["ID\tTASK\tSTATUS\tSCHEDULED\tSTARTED".to_owned()];
    lines.extend(runs.iter().map(format_run_line));
    lines.join("\n")
}

fn format_run_line(run: &RunDto) -> String {
    format!(
        "{}\t{}\t{}\t{}\t{}",
        run.id,
        run.task_id,
        run.status,
        run.scheduled_for.as_deref().unwrap_or("-"),
        run.started_at.as_deref().unwrap_or("-")
    )
}

fn current_actor() -> RpcActor {
    if scheduled_run_context_present() {
        RpcActor {
            actor_type: AuditActorType::ScheduledRun,
            actor_id: std::env::var("CODEX_SCHEDULER_CURRENT_RUN_ID").ok(),
        }
    } else {
        RpcActor {
            actor_type: AuditActorType::Cli,
            actor_id: None,
        }
    }
}

fn scheduled_run_context_present() -> bool {
    scheduler_marker_present()
        || nonempty_env("CODEX_SCHEDULER_RUN_TOKEN")
        || nonempty_env("CODEX_SCHEDULER_CURRENT_TASK_ID")
        || nonempty_env("CODEX_SCHEDULER_CURRENT_RUN_ID")
}

fn ensure_write_token_if_scheduled() -> Result<(), CliError> {
    let scheduled_context = scheduler_marker_present()
        || nonempty_env("CODEX_SCHEDULER_CURRENT_TASK_ID")
        || nonempty_env("CODEX_SCHEDULER_CURRENT_RUN_ID");
    let token = nonempty_env("CODEX_SCHEDULER_RUN_TOKEN");
    if scheduled_context && !token {
        return Err(CliError::permission_denied(
            "CODEX_SCHEDULER_RUN_TOKEN is required for scheduled-run write commands",
        ));
    }
    Ok(())
}

fn add_invocation_metadata<T: Serialize>(params: T, reason: Option<&str>) -> Value {
    let mut value = serde_json::to_value(params).unwrap_or_else(|_| json!({}));
    let Value::Object(object) = &mut value else {
        return value;
    };
    if let Some(token) = std::env::var("CODEX_SCHEDULER_RUN_TOKEN")
        .ok()
        .filter(|token| !token.trim().is_empty())
    {
        object.insert("token".to_owned(), Value::String(token));
    }
    if let Some(reason) = reason.filter(|reason| !reason.trim().is_empty()) {
        object.insert("reason".to_owned(), Value::String(reason.to_owned()));
    }
    if let Ok(task_id) = std::env::var("CODEX_SCHEDULER_CURRENT_TASK_ID") {
        object.insert("currentTaskId".to_owned(), Value::String(task_id));
    }
    if let Ok(run_id) = std::env::var("CODEX_SCHEDULER_CURRENT_RUN_ID") {
        object.insert("currentRunId".to_owned(), Value::String(run_id));
    }
    value
}

fn write_requires_daemon(err: CliError) -> CliError {
    if err.exit_code == 3 {
        CliError::daemon_unavailable("daemon is required for write commands")
    } else {
        err
    }
}

fn should_use_sqlite_write_fallback(paths: &AppPaths, err: &CliError) -> Result<bool, CliError> {
    if !err.is_daemon_connection_failure() {
        return Ok(false);
    }
    if !paths.allow_direct_db {
        return Ok(false);
    }
    if any_codex_scheduler_env_present() {
        return Err(CliError::permission_denied(
            "direct SQLite writes are not allowed inside scheduled runs",
        ));
    }
    Ok(true)
}

fn direct_db_env_requested() -> bool {
    truthy_env("CODEX_SCHEDULE_ALLOW_DIRECT_DB")
}

fn any_codex_scheduler_env_present() -> bool {
    std::env::vars_os().any(|(key, value)| {
        key.to_string_lossy().starts_with("CODEX_SCHEDULER")
            && !value.to_string_lossy().trim().is_empty()
    })
}

fn scheduler_marker_present() -> bool {
    std::env::var("CODEX_SCHEDULER")
        .ok()
        .is_some_and(|value| value.trim() == "1")
}

fn nonempty_env(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .is_some_and(|value| !value.trim().is_empty())
}

fn truthy_env(name: &str) -> bool {
    std::env::var(name).ok().is_some_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

fn scheduler_error_to_cli(err: scheduler_core::SchedulerError) -> CliError {
    match err {
        scheduler_core::SchedulerError::Validation(_) => CliError::validation(err.to_string()),
        scheduler_core::SchedulerError::Database(_) => CliError::database(err.to_string()),
        _ => CliError::generic(err.to_string()),
    }
}

fn json_to_cli(err: serde_json::Error) -> CliError {
    CliError::generic(err.to_string())
}

fn ensure_data_dir_writable(paths: &AppPaths) -> std::io::Result<()> {
    std::fs::create_dir_all(&paths.data_dir)?;
    let path = paths.data_dir.join(".codex-schedule-doctor");
    std::fs::write(&path, b"ok")?;
    std::fs::remove_file(path)?;
    Ok(())
}

async fn sqlite_read_write(paths: &AppPaths) -> Result<(), CliError> {
    let db = db(paths).await?;
    db.set_setting("doctor.last_check", &format_utc_rfc3339(Utc::now()))
        .await
        .map_err(|err| CliError::database(err.to_string()))?;
    db.get_setting_row("doctor.last_check")
        .await
        .map_err(|err| CliError::database(err.to_string()))?
        .ok_or_else(|| CliError::database("doctor setting was not persisted"))?;
    Ok(())
}

async fn configured_codex_path(paths: &AppPaths) -> Option<String> {
    let client = RpcClient::new(paths.socket_path.clone());
    if let Ok(result) = client
        .call::<SettingsGetResult, _>(
            METHOD_SETTINGS_GET,
            SettingsGetParams {
                key: Some("runner.codex_path".to_owned()),
            },
        )
        .await
    {
        if let Some(setting) = result.settings.first() {
            if let Ok(path) = serde_json::from_str::<String>(&setting.value_json) {
                if !path.trim().is_empty() {
                    return Some(path);
                }
            }
        }
    }
    let db = db(paths).await.ok()?;
    let setting = db
        .get_setting_row("runner.codex_path")
        .await
        .ok()
        .flatten()?;
    serde_json::from_str::<String>(&setting.value_json)
        .ok()
        .filter(|path| !path.trim().is_empty())
}
