use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{AuditActorType, Project, RunDto, RunStatus, Setting, TaskDto, TaskStatus};

pub const JSONRPC_VERSION: &str = "2.0";

pub const METHOD_DAEMON_HEALTH: &str = "daemon.health";
pub const METHOD_TASK_LIST: &str = "task.list";
pub const METHOD_TASK_GET: &str = "task.get";
pub const METHOD_TASK_CREATE: &str = "task.create";
pub const METHOD_TASK_UPDATE: &str = "task.update";
pub const METHOD_TASK_DELETE: &str = "task.delete";
pub const METHOD_TASK_PAUSE: &str = "task.pause";
pub const METHOD_TASK_RESUME: &str = "task.resume";
pub const METHOD_TASK_RUN_NOW: &str = "task.runNow";
pub const METHOD_RUN_LIST: &str = "run.list";
pub const METHOD_RUN_GET: &str = "run.get";
pub const METHOD_RUN_CANCEL: &str = "run.cancel";
pub const METHOD_RUN_TAIL_LOG: &str = "run.tailLog";
pub const METHOD_PROJECT_LIST: &str = "project.list";
pub const METHOD_PROJECT_TRUST: &str = "project.trust";
pub const METHOD_SETTINGS_GET: &str = "settings.get";
pub const METHOD_SETTINGS_SET: &str = "settings.set";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum JsonRpcId {
    String(String),
    Number(i64),
    Null,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<JsonRpcId>,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<JsonRpcId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

impl JsonRpcResponse {
    pub fn success<T: Serialize>(id: Option<JsonRpcId>, result: T) -> serde_json::Result<Self> {
        Ok(Self {
            jsonrpc: JSONRPC_VERSION.to_owned(),
            id,
            result: Some(serde_json::to_value(result)?),
            error: None,
        })
    }

    pub fn failure(id: Option<JsonRpcId>, error: JsonRpcError) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_owned(),
            id,
            result: None,
            error: Some(error),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JsonRpcErrorCode {
    ParseError,
    InvalidRequest,
    MethodNotFound,
    InvalidParams,
    InternalError,
    TaskNotFound,
    RunNotFound,
    ValidationFailed,
    PermissionDenied,
    Conflict,
    Unavailable,
    Canceled,
}

impl JsonRpcErrorCode {
    pub const fn code(self) -> i64 {
        match self {
            Self::ParseError => -32700,
            Self::InvalidRequest => -32600,
            Self::MethodNotFound => -32601,
            Self::InvalidParams => -32602,
            Self::InternalError => -32603,
            Self::TaskNotFound => -32001,
            Self::RunNotFound => -32002,
            Self::ValidationFailed => -32010,
            Self::PermissionDenied => -32020,
            Self::Conflict => -32030,
            Self::Unavailable => -32040,
            Self::Canceled => -32050,
        }
    }

    pub const fn exit_code(self) -> i32 {
        match self {
            Self::ParseError | Self::InvalidRequest | Self::InvalidParams => 2,
            Self::MethodNotFound => 2,
            Self::Unavailable => 3,
            Self::PermissionDenied => 4,
            Self::ValidationFailed | Self::Conflict => 5,
            Self::TaskNotFound | Self::RunNotFound => 6,
            Self::InternalError => 7,
            Self::Canceled => 1,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl JsonRpcError {
    pub fn new(code: JsonRpcErrorCode, message: impl Into<String>) -> Self {
        Self {
            code: code.code(),
            message: message.into(),
            data: None,
        }
    }

    pub fn with_data<T: Serialize>(
        code: JsonRpcErrorCode,
        message: impl Into<String>,
        data: T,
    ) -> serde_json::Result<Self> {
        Ok(Self {
            code: code.code(),
            message: message.into(),
            data: Some(serde_json::to_value(data)?),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcActor {
    pub actor_type: AuditActorType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor_id: Option<String>,
}

impl Default for RpcActor {
    fn default() -> Self {
        Self {
            actor_type: AuditActorType::User,
            actor_id: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonHealthParams {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonHealthResult {
    pub ok: bool,
    pub version: String,
    pub db_schema_version: i64,
    pub scheduler_enabled: bool,
    pub running_count: i64,
    pub queued_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskListParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<TaskStatus>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListResult {
    pub tasks: Vec<TaskDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskGetParams {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskResult {
    pub task: TaskDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCreateParams {
    pub task: TaskDto,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<RpcActor>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpdateParams {
    pub task: TaskDto,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<RpcActor>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskIdParams {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<RpcActor>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDeleteResult {
    pub deleted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunListParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<RunStatus>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunListResult {
    pub runs: Vec<RunDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunGetParams {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub run: RunDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCancelParams {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<RpcActor>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTailLogParams {
    pub run_id: String,
    pub stream: LogStream,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTailLogResult {
    pub run_id: String,
    pub stream: LogStream,
    pub cursor: u64,
    pub next_cursor: u64,
    pub eof: bool,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListParams {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListResult {
    pub projects: Vec<Project>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTrustParams {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<RpcActor>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTrustResult {
    pub project: Project,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SettingsGetParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsGetResult {
    pub settings: Vec<Setting>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSetParams {
    pub key: String,
    pub value: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<RpcActor>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSetResult {
    pub setting: Setting,
}
