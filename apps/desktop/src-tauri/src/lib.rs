use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use scheduler_core::ipc::{
    JsonRpcError, JsonRpcId, JsonRpcRequest, JsonRpcResponse, ProjectListResult, JSONRPC_VERSION,
    METHOD_DAEMON_DIAGNOSTICS, METHOD_DAEMON_HEALTH, METHOD_DAEMON_TICK_NOW, METHOD_PROJECT_LIST,
    METHOD_PROJECT_TRUST, METHOD_RUN_CANCEL, METHOD_RUN_GET, METHOD_RUN_LIST, METHOD_RUN_TAIL_LOG,
    METHOD_SETTINGS_GET, METHOD_SETTINGS_SET, METHOD_TASK_AUDIT_LIST, METHOD_TASK_CREATE,
    METHOD_TASK_DELETE, METHOD_TASK_GET, METHOD_TASK_LIST, METHOD_TASK_PAUSE, METHOD_TASK_RESUME,
    METHOD_TASK_RUN_NOW, METHOD_TASK_UPDATE,
};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, RunEvent, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::Mutex;

type CommandResult<T> = Result<T, String>;
const DAEMON_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(35);
const DAEMON_LOG_TAIL_BYTES: u64 = 64 * 1024;
const LOG_EXPORT_TAIL_BYTES: usize = 256 * 1024;
const PROMPT_FILE_MAX_BYTES: u64 = 200 * 1024;
const RUN_STATUS_NOTIFICATION_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Debug)]
struct AppState {
    daemon: DaemonManager,
}

#[derive(Debug)]
struct DaemonManager {
    data_dir: PathBuf,
    socket_path: PathBuf,
    child: Mutex<Option<Child>>,
    lifecycle_lock: Mutex<()>,
    request_id: AtomicU64,
    shutdown_started: AtomicBool,
}

#[derive(Debug)]
enum BackendError {
    Transport(String),
    Rpc(JsonRpcError),
    Decode(String),
}

impl std::fmt::Display for BackendError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Transport(message) | Self::Decode(message) => formatter.write_str(message),
            Self::Rpc(error) => write!(
                formatter,
                "daemon rpc error {}: {}",
                error.code, error.message
            ),
        }
    }
}

impl DaemonManager {
    fn new(data_dir: PathBuf) -> Self {
        let socket_path = data_dir.join("scheduler.sock");
        Self {
            data_dir,
            socket_path,
            child: Mutex::new(None),
            lifecycle_lock: Mutex::new(()),
            request_id: AtomicU64::new(1),
            shutdown_started: AtomicBool::new(false),
        }
    }

    async fn setup(&self, app: &AppHandle) -> Result<(), String> {
        self.ensure_daemon(app).await
    }

    async fn proxy<P: Serialize>(
        &self,
        app: &AppHandle,
        method: &str,
        params: P,
    ) -> Result<Value, String> {
        let params = serde_json::to_value(params).map_err(|err| err.to_string())?;
        self.ensure_daemon(app).await?;

        match self.call(method, params.clone()).await {
            Ok(value) => Ok(value),
            Err(BackendError::Transport(_)) => {
                self.respawn(app).await?;
                self.call(method, params)
                    .await
                    .map_err(|err| err.to_string())
            }
            Err(err) => Err(err.to_string()),
        }
    }

    async fn ensure_daemon(&self, app: &AppHandle) -> Result<(), String> {
        if self.health().await.is_ok() {
            return Ok(());
        }

        let _guard = self.lifecycle_lock.lock().await;
        if self.health().await.is_ok() {
            return Ok(());
        }

        self.spawn_or_restart(app).await?;
        for attempt in 0..6 {
            if self.health().await.is_ok() {
                return Ok(());
            }
            let delay = Duration::from_millis(100 + attempt * 150);
            tokio::time::sleep(delay).await;
        }

        Err("codex-schedulerd did not become healthy after spawn".to_owned())
    }

    async fn respawn(&self, app: &AppHandle) -> Result<(), String> {
        let _guard = self.lifecycle_lock.lock().await;
        self.terminate_child().await;
        self.spawn_child(app).await
    }

    async fn spawn_or_restart(&self, app: &AppHandle) -> Result<(), String> {
        let stale_child = {
            let mut child = self.child.lock().await;
            if let Some(existing) = child.as_mut() {
                match existing.try_wait() {
                    Ok(Some(_status)) => {
                        *child = None;
                        None
                    }
                    Ok(None) => child.take(),
                    Err(_err) => child.take(),
                }
            } else {
                None
            }
        };
        if let Some(mut existing) = stale_child {
            let _ = tokio::task::spawn_blocking(move || terminate_process(&mut existing)).await;
        }
        self.spawn_child(app).await
    }

    async fn spawn_child(&self, app: &AppHandle) -> Result<(), String> {
        std::fs::create_dir_all(&self.data_dir).map_err(|err| err.to_string())?;
        let binary = locate_schedulerd(app)?;
        let mut command = Command::new(&binary);
        command
            .arg("--data-dir")
            .arg(&self.data_dir)
            .arg("--socket-path")
            .arg(&self.socket_path)
            .env("CODEX_SCHEDULER_DATA_DIR", &self.data_dir)
            .env("CODEX_SCHEDULER_SOCKET", &self.socket_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        make_daemon_session_leader(&mut command);
        let child = command
            .spawn()
            .map_err(|err| format!("failed to spawn {}: {err}", binary.display()))?;

        *self.child.lock().await = Some(child);
        Ok(())
    }

    async fn shutdown(&self) {
        self.shutdown_started.store(true, Ordering::SeqCst);
        self.terminate_child().await;
    }

    async fn terminate_child(&self) {
        let mut child = self.child.lock().await;
        if let Some(mut existing) = child.take() {
            let _ = tokio::task::spawn_blocking(move || terminate_process(&mut existing)).await;
        }
    }

    fn begin_shutdown(&self) -> bool {
        !self.shutdown_started.swap(true, Ordering::SeqCst)
    }

    async fn health(&self) -> Result<Value, BackendError> {
        self.call(METHOD_DAEMON_HEALTH, json!({})).await
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, BackendError> {
        let id = self.request_id.fetch_add(1, Ordering::Relaxed).to_string();
        rpc_call(&self.socket_path, id, method, params).await
    }

    async fn is_open_path_allowed(&self, app: &AppHandle, path: &Path) -> Result<bool, String> {
        for root in [
            self.data_dir.join("logs"),
            self.data_dir.join("worktrees"),
            self.data_dir.join("chat-workspaces"),
        ] {
            if canonicalize_existing(&root).is_some_and(|root| path.starts_with(root)) {
                return Ok(true);
            }
        }

        let result = self.proxy(app, METHOD_PROJECT_LIST, json!({})).await?;
        let projects = serde_json::from_value::<ProjectListResult>(result)
            .map_err(|err| format!("failed to decode trusted projects: {err}"))?;
        for project in projects
            .projects
            .into_iter()
            .filter(|project| project.trusted_at.is_some())
        {
            let root = project.git_root.unwrap_or(project.path);
            if canonicalize_existing(root).is_some_and(|root| path.starts_with(root)) {
                return Ok(true);
            }
        }

        Ok(false)
    }
}

#[cfg(unix)]
fn make_daemon_session_leader(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    // Isolate the daemon from the GUI process group. The runner separately starts
    // each Codex child in its own process group and terminates that group on
    // cancellation or timeout.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
}

#[cfg(not(unix))]
fn make_daemon_session_leader(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_process(child: &mut Child) {
    let pid = child.id() as libc::pid_t;
    // The daemon handles SIGTERM by shutting down its listener and canceling
    // active runs. It was started as a process-group leader, so signal the group
    // to include any helper processes that stayed in the daemon group.
    let _ = unsafe { libc::killpg(pid, libc::SIGTERM) };
    wait_for_process_exit(child, DAEMON_SHUTDOWN_TIMEOUT);
}

#[cfg(not(unix))]
fn terminate_process(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(unix)]
fn wait_for_process_exit(child: &mut Child, timeout: Duration) {
    let started = std::time::Instant::now();
    while started.elapsed() < timeout {
        match child.try_wait() {
            Ok(Some(_status)) => return,
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_err) => return,
        }
    }

    #[cfg(unix)]
    {
        let pid = child.id() as libc::pid_t;
        let _ = unsafe { libc::killpg(pid, libc::SIGKILL) };
    }
    #[cfg(not(unix))]
    let _ = child.kill();
    let _ = child.wait();
}

async fn rpc_call(
    socket_path: &Path,
    id: String,
    method: &str,
    params: Value,
) -> Result<Value, BackendError> {
    let request = JsonRpcRequest {
        jsonrpc: JSONRPC_VERSION.to_owned(),
        id: Some(JsonRpcId::String(id)),
        method: method.to_owned(),
        params: Some(params),
    };
    let line =
        serde_json::to_string(&request).map_err(|err| BackendError::Decode(err.to_string()))?;

    let stream = tokio::time::timeout(Duration::from_secs(2), UnixStream::connect(socket_path))
        .await
        .map_err(|_| BackendError::Transport("daemon socket connection timed out".to_owned()))?
        .map_err(|err| BackendError::Transport(err.to_string()))?;
    let (read, mut write) = stream.into_split();
    write
        .write_all(line.as_bytes())
        .await
        .map_err(|err| BackendError::Transport(err.to_string()))?;
    write
        .write_all(b"\n")
        .await
        .map_err(|err| BackendError::Transport(err.to_string()))?;
    write
        .flush()
        .await
        .map_err(|err| BackendError::Transport(err.to_string()))?;

    let mut lines = BufReader::new(read).lines();
    let response_line = tokio::time::timeout(Duration::from_secs(5), lines.next_line())
        .await
        .map_err(|_| BackendError::Transport("daemon response timed out".to_owned()))?
        .map_err(|err| BackendError::Transport(err.to_string()))?
        .ok_or_else(|| BackendError::Transport("daemon closed connection".to_owned()))?;
    let response = serde_json::from_str::<JsonRpcResponse>(&response_line)
        .map_err(|err| BackendError::Decode(err.to_string()))?;
    if let Some(error) = response.error {
        return Err(BackendError::Rpc(error));
    }
    response
        .result
        .ok_or_else(|| BackendError::Decode("daemon response did not contain result".to_owned()))
}

fn scheduler_data_dir() -> PathBuf {
    if let Some(path) = std::env::var_os("CODEX_SCHEDULER_DATA_DIR") {
        return PathBuf::from(path);
    }
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("Codex Scheduler");
    }
    PathBuf::from(".").join("Codex Scheduler")
}

fn locate_schedulerd(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("CODEX_SCHEDULERD_BIN").map(PathBuf::from) {
        if is_file(&path) {
            return Ok(path);
        }
    }

    if allow_development_daemon_lookup() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest_dir.join("../../..");
        let dev_binary = repo_root
            .join("target")
            .join("debug")
            .join(executable_name("codex-schedulerd"));
        if is_file(&dev_binary) {
            return Ok(dev_binary);
        }
    }

    let mut search_dirs = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        search_dirs.push(resource_dir.clone());
        search_dirs.push(resource_dir.join("binaries"));
    }
    if let Ok(executable_dir) = app.path().executable_dir() {
        search_dirs.push(executable_dir.clone());
        search_dirs.push(executable_dir.join("binaries"));
    }

    for dir in search_dirs {
        if let Some(path) = find_prefixed_binary(&dir, "codex-schedulerd") {
            return Ok(path);
        }
    }

    if allow_development_daemon_lookup() {
        return find_in_path("codex-schedulerd").ok_or_else(|| {
            "could not locate codex-schedulerd sidecar or development binary".to_owned()
        });
    }

    Err("could not locate codex-schedulerd sidecar".to_owned())
}

fn allow_development_daemon_lookup() -> bool {
    cfg!(debug_assertions)
        || std::env::var_os("CODEX_SCHEDULER_ALLOW_PATH_DAEMON").is_some_and(|value| value == "1")
}

fn executable_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    }
}

fn is_file(path: &Path) -> bool {
    path.is_file()
}

fn find_prefixed_binary(dir: &Path, prefix: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = path.file_name()?.to_string_lossy();
        if (file_name == executable_name(prefix) || file_name.starts_with(&format!("{prefix}-")))
            && is_file(&path)
        {
            return Some(path);
        }
    }
    None
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(executable_name(name));
        if is_file(&candidate) {
            return Some(candidate);
        }
    }
    None
}

fn canonicalize_existing(path: impl AsRef<Path>) -> Option<PathBuf> {
    std::fs::canonicalize(path).ok()
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn os_version() -> String {
    if cfg!(target_os = "macos") {
        if let Ok(output) = Command::new("sw_vers").arg("-productVersion").output() {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
                if !version.is_empty() {
                    return format!("macOS {version}");
                }
            }
        }
    }

    format!("{} {}", std::env::consts::OS, std::env::consts::ARCH)
}

fn read_daemon_log_tail(data_dir: &Path) -> Value {
    let path = data_dir.join("logs").join("daemon.log");
    let mut file = match std::fs::File::open(&path) {
        Ok(file) => file,
        Err(err) => {
            return json!({
                "path": path.to_string_lossy(),
                "available": false,
                "error": err.to_string(),
            });
        }
    };

    let size_bytes = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    let offset = size_bytes.saturating_sub(DAEMON_LOG_TAIL_BYTES);
    if let Err(err) = file.seek(SeekFrom::Start(offset)) {
        return json!({
            "path": path.to_string_lossy(),
            "available": false,
            "sizeBytes": size_bytes,
            "error": err.to_string(),
        });
    }

    let mut bytes = Vec::new();
    if let Err(err) = file.read_to_end(&mut bytes) {
        return json!({
            "path": path.to_string_lossy(),
            "available": false,
            "sizeBytes": size_bytes,
            "error": err.to_string(),
        });
    }

    let tail = String::from_utf8_lossy(&bytes);
    json!({
        "path": path.to_string_lossy(),
        "available": true,
        "sizeBytes": size_bytes,
        "truncatedBytes": offset,
        "tailBytesLimit": DAEMON_LOG_TAIL_BYTES,
        "tail": redact_sensitive_log_lines(&tail),
    })
}

fn redact_sensitive_log_lines(input: &str) -> String {
    input
        .lines()
        .map(|line| {
            let lower = line.to_ascii_lowercase();
            if lower.contains("token")
                || lower.contains("secret")
                || lower.contains("api_key")
                || lower.contains("apikey")
                || lower.contains("authorization")
                || lower.contains("bearer ")
                || lower.contains("password")
            {
                "[redacted sensitive log line]"
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

async fn read_run_log_tail(
    app: &AppHandle,
    state: &AppState,
    run_id: &str,
    stream: &str,
) -> CommandResult<String> {
    let result = state
        .daemon
        .proxy(
            app,
            METHOD_RUN_TAIL_LOG,
            json!({
                "runId": run_id,
                "stream": stream,
                "cursor": 0_u64,
                "limit": LOG_EXPORT_TAIL_BYTES
            }),
        )
        .await?;
    Ok(result
        .get("data")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned())
}

#[derive(Debug, Clone)]
struct RunStatusSnapshot {
    task_id: String,
    status: String,
}

fn run_status_snapshot(value: &Value) -> BTreeMap<String, RunStatusSnapshot> {
    value
        .get("runs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|run| {
            let id = run.get("id")?.as_str()?.to_owned();
            let task_id = run.get("taskId")?.as_str()?.to_owned();
            let status = run.get("status")?.as_str()?.to_owned();
            Some((id, RunStatusSnapshot { task_id, status }))
        })
        .collect()
}

fn task_name_map(value: &Value) -> BTreeMap<String, String> {
    value
        .get("tasks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|task| {
            let id = task.get("id")?.as_str()?.to_owned();
            let name = task.get("name")?.as_str()?.to_owned();
            Some((id, name))
        })
        .collect()
}

fn notification_failure_status(status: &str) -> bool {
    matches!(status, "failed" | "timed_out")
}

fn status_label(status: &str) -> &'static str {
    match status {
        "timed_out" => "timed out",
        "failed" => "failed",
        _ => "needs attention",
    }
}

async fn notifications_enabled(app: &AppHandle, state: &AppState) -> bool {
    let Ok(result) = state
        .daemon
        .proxy(
            app,
            METHOD_SETTINGS_GET,
            json!({ "key": "notifications.enabled" }),
        )
        .await
    else {
        return true;
    };

    let Some(setting) = result
        .get("settings")
        .and_then(Value::as_array)
        .and_then(|settings| settings.first())
    else {
        return true;
    };

    let value_json = setting
        .get("valueJson")
        .or_else(|| setting.get("value_json"))
        .and_then(Value::as_str)
        .unwrap_or("true");
    serde_json::from_str::<bool>(value_json).unwrap_or(true)
}

async fn notify_run_status_changes(
    app: &AppHandle,
    state: &AppState,
    failures: Vec<RunStatusSnapshot>,
) {
    if failures.is_empty() || !notifications_enabled(app, state).await {
        return;
    }

    let task_names = state
        .daemon
        .proxy(app, METHOD_TASK_LIST, json!({}))
        .await
        .map(|value| task_name_map(&value))
        .unwrap_or_default();

    for failure in failures {
        let task_name = task_names
            .get(&failure.task_id)
            .map(String::as_str)
            .unwrap_or("Scheduled task");
        let body = format!("{task_name}: {}", status_label(&failure.status));
        let _ = app
            .notification()
            .builder()
            .title("Codex Scheduler run failed")
            .body(body)
            .show();
    }
}

fn start_run_status_notification_poll(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut previous: BTreeMap<String, RunStatusSnapshot> = BTreeMap::new();
        let mut initialized = false;

        loop {
            let state = app.state::<AppState>();
            if state.daemon.shutdown_started.load(Ordering::SeqCst) {
                break;
            }

            if let Ok(result) = state.daemon.proxy(&app, METHOD_RUN_LIST, json!({})).await {
                let current = run_status_snapshot(&result);
                if initialized {
                    let failures = current
                        .iter()
                        .filter_map(|(id, snapshot)| {
                            if !notification_failure_status(&snapshot.status) {
                                return None;
                            }
                            if previous
                                .get(id)
                                .is_some_and(|prior| notification_failure_status(&prior.status))
                            {
                                return None;
                            }
                            Some(snapshot.clone())
                        })
                        .collect::<Vec<_>>();
                    notify_run_status_changes(&app, &state, failures).await;
                }

                previous = current;
                initialized = true;
            }

            tokio::time::sleep(RUN_STATUS_NOTIFICATION_INTERVAL).await;
        }
    });
}

#[tauri::command]
async fn daemon_health(app: AppHandle, state: State<'_, AppState>) -> CommandResult<Value> {
    state
        .daemon
        .proxy(&app, METHOD_DAEMON_HEALTH, json!({}))
        .await
}

#[tauri::command]
async fn daemon_diagnostics(app: AppHandle, state: State<'_, AppState>) -> CommandResult<Value> {
    state
        .daemon
        .proxy(&app, METHOD_DAEMON_DIAGNOSTICS, json!({}))
        .await
}

#[tauri::command]
async fn daemon_tick_now(app: AppHandle, state: State<'_, AppState>) -> CommandResult<Value> {
    state
        .daemon
        .proxy(&app, METHOD_DAEMON_TICK_NOW, json!({}))
        .await
}

#[tauri::command]
async fn diagnostics_export(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<Option<String>> {
    let picked = app
        .dialog()
        .file()
        .set_title("Export diagnostics")
        .set_file_name("codex-scheduler-diagnostics.json")
        .add_filter("JSON", &["json"])
        .blocking_save_file();
    let Some(path) = picked
        .map(|path| {
            path.into_path()
                .map_err(|err| format!("invalid diagnostics export path: {err}"))
        })
        .transpose()?
    else {
        return Ok(None);
    };

    let health = state
        .daemon
        .proxy(&app, METHOD_DAEMON_HEALTH, json!({}))
        .await?;
    let diagnostics = match state
        .daemon
        .proxy(&app, METHOD_DAEMON_DIAGNOSTICS, json!({}))
        .await
    {
        Ok(value) => json!({
            "available": true,
            "data": value,
        }),
        Err(err) => json!({
            "available": false,
            "error": err,
            "todo": "daemon.diagnostics was unavailable; export contains daemon.health only.",
        }),
    };
    let payload = json!({
        "schemaVersion": 1,
        "generatedAtUnixSec": now_unix_secs(),
        "app": {
            "name": app.package_info().name,
            "version": app.package_info().version.to_string(),
        },
        "system": {
            "osVersion": os_version(),
        },
        "daemon": {
            "health": health,
            "diagnostics": diagnostics,
            "log": read_daemon_log_tail(&state.daemon.data_dir),
        },
        "redaction": {
            "environmentCaptured": false,
            "secretsCaptured": false,
            "notes": [
                "Environment variables are not collected.",
                "Daemon log lines containing token, secret, api key, authorization, bearer, or password markers are redacted."
            ],
        },
    });

    let contents = serde_json::to_vec_pretty(&payload).map_err(|err| err.to_string())?;
    std::fs::write(&path, contents)
        .map_err(|err| format!("failed to write diagnostics export: {err}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn export_run_logs(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
) -> CommandResult<Option<String>> {
    let picked = app
        .dialog()
        .file()
        .set_title("Export run logs")
        .set_file_name(format!("codex-scheduler-{run_id}-logs.txt"))
        .add_filter("Text", &["txt", "log"])
        .blocking_save_file();
    let Some(path) = picked
        .map(|path| {
            path.into_path()
                .map_err(|err| format!("invalid run log export path: {err}"))
        })
        .transpose()?
    else {
        return Ok(None);
    };

    let stdout = read_run_log_tail(&app, &state, &run_id, "stdout").await?;
    let stderr = read_run_log_tail(&app, &state, &run_id, "stderr").await?;
    let events = read_run_log_tail(&app, &state, &run_id, "events").await?;
    let contents = format!(
        "Codex Scheduler run log export\nrunId: {run_id}\n\n== stdout tail ==\n{stdout}\n\n== stderr tail ==\n{stderr}\n\n== events JSONL tail ==\n{events}\n"
    );
    std::fs::write(&path, contents)
        .map_err(|err| format!("failed to write run log export: {err}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn import_prompt_file_contents(path: &Path) -> CommandResult<String> {
    let metadata = std::fs::metadata(path)
        .map_err(|err| format!("prompt file metadata is unavailable: {err}"))?;
    if !metadata.is_file() {
        return Err("prompt path is not a file".to_owned());
    }
    if metadata.len() > PROMPT_FILE_MAX_BYTES {
        return Err("prompt file is larger than 200KB".to_owned());
    }
    std::fs::read_to_string(path)
        .map_err(|err| format!("failed to read prompt file as UTF-8 text: {err}"))
}

#[tauri::command]
async fn prompt_import_file(app: AppHandle) -> CommandResult<Option<String>> {
    let picked = app
        .dialog()
        .file()
        .set_title("Import prompt file")
        .add_filter("Text", &["txt", "md", "markdown"])
        .blocking_pick_file();
    let Some(path) = picked
        .map(|path| {
            path.into_path()
                .map_err(|err| format!("invalid prompt file path: {err}"))
        })
        .transpose()?
    else {
        return Ok(None);
    };
    import_prompt_file_contents(&path).map(Some)
}

#[tauri::command]
async fn task_list(
    app: AppHandle,
    state: State<'_, AppState>,
    status: Option<String>,
) -> CommandResult<Value> {
    state
        .daemon
        .proxy(&app, METHOD_TASK_LIST, json!({ "status": status }))
        .await
}

#[tauri::command]
async fn task_get(app: AppHandle, state: State<'_, AppState>, id: String) -> CommandResult<Value> {
    state
        .daemon
        .proxy(&app, METHOD_TASK_GET, json!({ "id": id }))
        .await
}

#[tauri::command]
async fn task_create(
    app: AppHandle,
    state: State<'_, AppState>,
    task: Value,
) -> CommandResult<Value> {
    state
        .daemon
        .proxy(&app, METHOD_TASK_CREATE, json!({ "task": task }))
        .await
}

#[tauri::command]
async fn task_update(
    app: AppHandle,
    state: State<'_, AppState>,
    task: Value,
) -> CommandResult<Value> {
    state
        .daemon
        .proxy(&app, METHOD_TASK_UPDATE, json!({ "task": task }))
        .await
}

#[tauri::command]
async fn task_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<Value> {
    state
        .daemon
        .proxy(&app, METHOD_TASK_DELETE, json!({ "id": id }))
        .await
}

#[tauri::command]
async fn task_pause(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<Value> {
    state
        .daemon
        .proxy(&app, METHOD_TASK_PAUSE, json!({ "id": id }))
        .await
}

#[tauri::command]
async fn task_resume(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<Value> {
    state
        .daemon
        .proxy(&app, METHOD_TASK_RESUME, json!({ "id": id }))
        .await
}

#[tauri::command]
async fn task_run_now(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<Value> {
    state
        .daemon
        .proxy(&app, METHOD_TASK_RUN_NOW, json!({ "id": id }))
        .await
}

#[tauri::command]
async fn task_audit_list(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    limit: Option<i64>,
) -> CommandResult<Value> {
    state
        .daemon
        .proxy(
            &app,
            METHOD_TASK_AUDIT_LIST,
            json!({ "taskId": task_id, "limit": limit }),
        )
        .await
}

#[tauri::command]
async fn run_list(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: Option<String>,
    status: Option<String>,
) -> CommandResult<Value> {
    state
        .daemon
        .proxy(
            &app,
            METHOD_RUN_LIST,
            json!({ "taskId": task_id, "status": status }),
        )
        .await
}

#[tauri::command]
async fn run_get(app: AppHandle, state: State<'_, AppState>, id: String) -> CommandResult<Value> {
    state
        .daemon
        .proxy(&app, METHOD_RUN_GET, json!({ "id": id }))
        .await
}

#[tauri::command]
async fn run_cancel(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<Value> {
    state
        .daemon
        .proxy(&app, METHOD_RUN_CANCEL, json!({ "id": id }))
        .await
}

#[tauri::command]
async fn run_tail_log(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
    stream: String,
    cursor: Option<u64>,
    limit: Option<usize>,
) -> CommandResult<Value> {
    state
        .daemon
        .proxy(
            &app,
            METHOD_RUN_TAIL_LOG,
            json!({
                "runId": run_id,
                "stream": stream,
                "cursor": cursor,
                "limit": limit
            }),
        )
        .await
}

#[tauri::command]
async fn project_list(app: AppHandle, state: State<'_, AppState>) -> CommandResult<Value> {
    state
        .daemon
        .proxy(&app, METHOD_PROJECT_LIST, json!({}))
        .await
}

#[tauri::command]
async fn project_trust(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> CommandResult<Value> {
    state
        .daemon
        .proxy(&app, METHOD_PROJECT_TRUST, json!({ "path": path }))
        .await
}

#[tauri::command]
async fn settings_get(
    app: AppHandle,
    state: State<'_, AppState>,
    key: Option<String>,
) -> CommandResult<Value> {
    state
        .daemon
        .proxy(&app, METHOD_SETTINGS_GET, json!({ "key": key }))
        .await
}

#[tauri::command]
async fn settings_set(
    app: AppHandle,
    state: State<'_, AppState>,
    key: String,
    value: Value,
) -> CommandResult<Value> {
    state
        .daemon
        .proxy(
            &app,
            METHOD_SETTINGS_SET,
            json!({ "key": key, "value": value }),
        )
        .await
}

#[tauri::command]
async fn project_pick_folder(app: AppHandle) -> CommandResult<Option<String>> {
    let picked = app.dialog().file().blocking_pick_folder();
    picked
        .map(|path| {
            path.into_path()
                .map(|path| path.to_string_lossy().into_owned())
                .map_err(|err| err.to_string())
        })
        .transpose()
}

#[tauri::command]
async fn open_path(app: AppHandle, state: State<'_, AppState>, path: String) -> CommandResult<()> {
    let path = std::fs::canonicalize(&path)
        .map_err(|err| format!("path does not exist or cannot be opened: {err}"))?;
    if !state.daemon.is_open_path_allowed(&app, &path).await? {
        return Err(
            "path is outside Codex Scheduler data directories and trusted project roots".to_owned(),
        );
    }
    app.opener()
        .open_path(path.to_string_lossy().into_owned(), None::<String>)
        .map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = scheduler_data_dir();
    let state = AppState {
        daemon: DaemonManager::new(data_dir),
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(state)
        .setup(|app| {
            let app_handle = app.handle().clone();
            let state = app.state::<AppState>();
            tauri::async_runtime::block_on(state.daemon.setup(&app_handle))?;
            start_run_status_notification_poll(app_handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            daemon_health,
            daemon_diagnostics,
            daemon_tick_now,
            diagnostics_export,
            export_run_logs,
            prompt_import_file,
            task_list,
            task_get,
            task_create,
            task_update,
            task_delete,
            task_pause,
            task_resume,
            task_run_now,
            task_audit_list,
            run_list,
            run_get,
            run_cancel,
            run_tail_log,
            project_list,
            project_trust,
            settings_get,
            settings_set,
            project_pick_folder,
            open_path
        ])
        .build(tauri::generate_context!())
        .expect("error while building Codex Scheduler");

    app.run(|app_handle, event| match event {
        RunEvent::ExitRequested { api, code, .. } => {
            let state = app_handle.state::<AppState>();
            if state.daemon.begin_shutdown() {
                api.prevent_exit();
                for window in app_handle.webview_windows().values() {
                    let _ = window.hide();
                }

                let app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_handle.state::<AppState>();
                    state.daemon.shutdown().await;
                    app_handle.exit(code.unwrap_or(0));
                });
            }
        }
        RunEvent::Exit => {
            let state = app_handle.state::<AppState>();
            if state.daemon.begin_shutdown() {
                tauri::async_runtime::block_on(state.daemon.shutdown());
            }
        }
        _ => {}
    });
}
