use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use scheduler_core::ipc::{
    JsonRpcError, JsonRpcId, JsonRpcRequest, JsonRpcResponse, JSONRPC_VERSION,
    METHOD_DAEMON_HEALTH, METHOD_PROJECT_LIST, METHOD_PROJECT_TRUST, METHOD_RUN_CANCEL,
    METHOD_RUN_GET, METHOD_RUN_LIST, METHOD_RUN_TAIL_LOG, METHOD_SETTINGS_GET, METHOD_SETTINGS_SET,
    METHOD_TASK_CREATE, METHOD_TASK_DELETE, METHOD_TASK_GET, METHOD_TASK_LIST, METHOD_TASK_PAUSE,
    METHOD_TASK_RESUME, METHOD_TASK_RUN_NOW, METHOD_TASK_UPDATE,
};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, RunEvent, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::Mutex;

type CommandResult<T> = Result<T, String>;

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
        {
            let mut child = self.child.lock().await;
            if let Some(existing) = child.as_mut() {
                match existing.try_wait() {
                    Ok(Some(_status)) => {
                        *child = None;
                    }
                    Ok(None) => {
                        terminate_process(existing);
                        *child = None;
                    }
                    Err(_err) => {
                        *child = None;
                    }
                }
            }
        }
        self.spawn_child(app).await
    }

    async fn spawn_child(&self, app: &AppHandle) -> Result<(), String> {
        std::fs::create_dir_all(&self.data_dir).map_err(|err| err.to_string())?;
        let binary = locate_schedulerd(app)?;
        let child = Command::new(&binary)
            .arg("--data-dir")
            .arg(&self.data_dir)
            .arg("--socket-path")
            .arg(&self.socket_path)
            .env("CODEX_SCHEDULER_DATA_DIR", &self.data_dir)
            .env("CODEX_SCHEDULER_SOCKET", &self.socket_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|err| format!("failed to spawn {}: {err}", binary.display()))?;

        *self.child.lock().await = Some(child);
        Ok(())
    }

    async fn shutdown(&self) {
        self.terminate_child().await;
    }

    async fn terminate_child(&self) {
        let mut child = self.child.lock().await;
        if let Some(mut existing) = child.take() {
            terminate_process(&mut existing);
        }
    }

    async fn health(&self) -> Result<Value, BackendError> {
        self.call(METHOD_DAEMON_HEALTH, json!({})).await
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, BackendError> {
        let id = self.request_id.fetch_add(1, Ordering::Relaxed).to_string();
        rpc_call(&self.socket_path, id, method, params).await
    }
}

#[cfg(unix)]
fn terminate_process(child: &mut Child) {
    let pid = child.id() as libc::pid_t;
    // The daemon handles SIGTERM by shutting down its listener and active runs.
    let _ = unsafe { libc::kill(pid, libc::SIGTERM) };
    wait_for_process_exit(child, Duration::from_secs(3));
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

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.join("../../..");
    let dev_binary = repo_root
        .join("target")
        .join("debug")
        .join(executable_name("codex-schedulerd"));
    if is_file(&dev_binary) {
        return Ok(dev_binary);
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

    find_in_path("codex-schedulerd")
        .ok_or_else(|| "could not locate codex-schedulerd sidecar or development binary".to_owned())
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
        if file_name == executable_name(prefix) || file_name.starts_with(&format!("{prefix}-")) {
            if is_file(&path) {
                return Some(path);
            }
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

#[tauri::command]
async fn daemon_health(app: AppHandle, state: State<'_, AppState>) -> CommandResult<Value> {
    state
        .daemon
        .proxy(&app, METHOD_DAEMON_HEALTH, json!({}))
        .await
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
async fn open_path(app: AppHandle, path: String) -> CommandResult<()> {
    app.opener()
        .open_path(path, None::<String>)
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            daemon_health,
            task_list,
            task_get,
            task_create,
            task_update,
            task_delete,
            task_pause,
            task_resume,
            task_run_now,
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

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            let state = app_handle.state::<AppState>();
            tauri::async_runtime::block_on(state.daemon.shutdown());
        }
    });
}
