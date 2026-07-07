use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use super::enums::{
    ApprovalPolicy, AuditActorType, CleanupPolicy, MissedPolicy, OverlapPolicy, ProjectKind,
    RunArtifactKind, RunEventSource, RunStatus, RunTargetMode, SandboxMode, ScheduleStatus,
    TaskKind, TaskStatus, TriggerType,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: ProjectKind,
    pub git_root: Option<String>,
    pub git_remote_url: Option<String>,
    pub default_branch: Option<String>,
    pub trusted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Task {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub status: TaskStatus,
    pub kind: TaskKind,
    pub cron_expr: Option<String>,
    pub run_at: Option<String>,
    pub timezone: String,
    pub next_run_at: Option<String>,
    pub last_scheduled_for: Option<String>,
    pub schedule_status: ScheduleStatus,
    pub schedule_error: Option<String>,
    pub prompt_body: String,
    pub prompt_hash: String,
    pub inject_scheduler_instructions: bool,
    pub target_mode: RunTargetMode,
    pub project_id: Option<String>,
    pub repo_path: Option<String>,
    pub base_ref: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub sandbox_mode: SandboxMode,
    pub approval_policy: ApprovalPolicy,
    pub allow_schedule_cli: bool,
    pub schedule_cli_capabilities: String,
    pub max_created_schedules_per_run: i64,
    pub missed_policy: MissedPolicy,
    pub missed_window_days: i64,
    pub overlap_policy: OverlapPolicy,
    pub max_runtime_sec: i64,
    pub max_retries: i64,
    pub retry_backoff_sec: i64,
    pub cleanup_policy: CleanupPolicy,
    pub cleanup_after_days: Option<i64>,
    pub created_by: String,
    pub created_by_run_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Run {
    pub id: String,
    pub task_id: String,
    pub trigger_type: TriggerType,
    pub scheduled_for: Option<String>,
    pub attempt: i64,
    pub status: RunStatus,
    pub status_reason: Option<String>,
    pub queued_at: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub target_mode: RunTargetMode,
    pub workspace_path: Option<String>,
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,
    pub base_ref: Option<String>,
    pub commit_before: Option<String>,
    pub commit_after: Option<String>,
    pub codex_command_json: String,
    pub codex_session_id: Option<String>,
    pub pid: Option<i64>,
    pub exit_code: Option<i64>,
    pub signal: Option<String>,
    pub stdout_log_path: Option<String>,
    pub stderr_log_path: Option<String>,
    pub events_jsonl_path: Option<String>,
    pub last_message_path: Option<String>,
    pub stdout_tail: Option<String>,
    pub stderr_tail: Option<String>,
    pub result_summary: Option<String>,
    pub findings_count: Option<i64>,
    pub created_schedule_count: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct RunEvent {
    pub id: String,
    pub run_id: String,
    pub event_index: i64,
    pub source: RunEventSource,
    pub level: String,
    pub event_type: String,
    pub message: Option<String>,
    pub payload_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct RunArtifact {
    pub id: String,
    pub run_id: String,
    pub kind: RunArtifactKind,
    pub path: String,
    pub title: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct TaskAuditEvent {
    pub id: String,
    pub task_id: Option<String>,
    pub actor_type: AuditActorType,
    pub actor_id: Option<String>,
    pub action: String,
    pub before_json: Option<String>,
    pub after_json: Option<String>,
    pub reason: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct ScheduleCapabilityToken {
    pub id: String,
    pub run_id: String,
    pub task_id: String,
    pub token_hash: String,
    pub capabilities_json: String,
    pub expires_at: String,
    pub max_creates: i64,
    pub create_count: i64,
    pub revoked_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Setting {
    pub key: String,
    pub value_json: String,
    pub updated_at: String,
}
