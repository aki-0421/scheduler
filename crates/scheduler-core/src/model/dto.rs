use serde::{Deserialize, Serialize};

use super::enums::{
    ApprovalPolicy, CleanupPolicy, MissedPolicy, OverlapPolicy, RunStatus, RunTargetMode,
    SandboxMode, TaskKind, TaskStatus, TriggerType,
};
use super::ids::{new_run_id, new_task_id};
use super::tables::{Run, Task};
use crate::time::now_rfc3339;
use crate::util::prompt_hash;
use crate::{Result, SchedulerError};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    pub slug: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub status: TaskStatus,
    pub kind: TaskKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron_expr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_at: Option<String>,
    pub timezone: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<String>,
    pub target: TaskTargetDto,
    pub codex: TaskCodexDto,
    pub prompt: TaskPromptDto,
    pub policies: TaskPoliciesDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTargetDto {
    pub mode: RunTargetMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_ref: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCodexDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    pub sandbox_mode: SandboxMode,
    pub approval_policy: ApprovalPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPromptDto {
    pub body: String,
    pub inject_scheduler_instructions: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPoliciesDto {
    pub allow_schedule_cli: bool,
    pub missed_policy: MissedPolicy,
    pub overlap_policy: OverlapPolicy,
    pub max_runtime_sec: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule_cli_capabilities: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missed_window_days: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_retries: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_backoff_sec: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_policy: Option<CleanupPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_after_days: Option<i64>,
}

impl From<&Task> for TaskDto {
    fn from(task: &Task) -> Self {
        let schedule_cli_capabilities =
            serde_json::from_str::<Vec<String>>(&task.schedule_cli_capabilities).ok();

        Self {
            id: task.id.clone(),
            slug: task.slug.clone(),
            name: task.name.clone(),
            description: task.description.clone(),
            status: task.status,
            kind: task.kind,
            cron_expr: task.cron_expr.clone(),
            run_at: task.run_at.clone(),
            timezone: task.timezone.clone(),
            next_run_at: task.next_run_at.clone(),
            target: TaskTargetDto {
                mode: task.target_mode,
                project_id: task.project_id.clone(),
                repo_path: task.repo_path.clone(),
                base_ref: task.base_ref.clone(),
            },
            codex: TaskCodexDto {
                model: task.model.clone(),
                reasoning_effort: task.reasoning_effort.clone(),
                sandbox_mode: task.sandbox_mode,
                approval_policy: task.approval_policy,
            },
            prompt: TaskPromptDto {
                body: task.prompt_body.clone(),
                inject_scheduler_instructions: task.inject_scheduler_instructions,
            },
            policies: TaskPoliciesDto {
                allow_schedule_cli: task.allow_schedule_cli,
                missed_policy: task.missed_policy,
                overlap_policy: task.overlap_policy,
                max_runtime_sec: task.max_runtime_sec,
                schedule_cli_capabilities,
                missed_window_days: Some(task.missed_window_days),
                max_retries: Some(task.max_retries),
                retry_backoff_sec: Some(task.retry_backoff_sec),
                cleanup_policy: Some(task.cleanup_policy),
                cleanup_after_days: task.cleanup_after_days,
            },
        }
    }
}

impl TryFrom<TaskDto> for Task {
    type Error = SchedulerError;

    fn try_from(dto: TaskDto) -> Result<Self> {
        let now = now_rfc3339();
        let capabilities = dto.policies.schedule_cli_capabilities.unwrap_or_else(|| {
            vec![
                "schedule:create".to_owned(),
                "schedule:update-current".to_owned(),
                "schedule:list".to_owned(),
            ]
        });

        Ok(Self {
            id: if dto.id.is_empty() {
                new_task_id()
            } else {
                dto.id
            },
            slug: dto.slug,
            name: dto.name,
            description: dto.description,
            status: dto.status,
            kind: dto.kind,
            cron_expr: dto.cron_expr,
            run_at: dto.run_at,
            timezone: dto.timezone,
            next_run_at: dto.next_run_at,
            last_scheduled_for: None,
            schedule_status: Default::default(),
            schedule_error: None,
            prompt_hash: prompt_hash(&dto.prompt.body),
            prompt_body: dto.prompt.body,
            inject_scheduler_instructions: dto.prompt.inject_scheduler_instructions,
            target_mode: dto.target.mode,
            project_id: dto.target.project_id,
            repo_path: dto.target.repo_path,
            base_ref: dto.target.base_ref,
            model: dto.codex.model,
            reasoning_effort: dto.codex.reasoning_effort,
            sandbox_mode: dto.codex.sandbox_mode,
            approval_policy: dto.codex.approval_policy,
            allow_schedule_cli: dto.policies.allow_schedule_cli,
            schedule_cli_capabilities: serde_json::to_string(&capabilities)?,
            missed_policy: dto.policies.missed_policy,
            missed_window_days: dto.policies.missed_window_days.unwrap_or(7),
            overlap_policy: dto.policies.overlap_policy,
            max_runtime_sec: dto.policies.max_runtime_sec,
            max_retries: dto.policies.max_retries.unwrap_or(0),
            retry_backoff_sec: dto.policies.retry_backoff_sec.unwrap_or(300),
            cleanup_policy: dto.policies.cleanup_policy.unwrap_or_default(),
            cleanup_after_days: dto.policies.cleanup_after_days,
            created_by: "user".to_owned(),
            created_by_run_id: None,
            created_at: now.clone(),
            updated_at: now,
            deleted_at: None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDto {
    pub id: String,
    pub task_id: String,
    pub trigger_type: TriggerType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduled_for: Option<String>,
    pub status: RunStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_summary: Option<String>,
    pub findings_count: i64,
    pub created_schedule_count: i64,
}

impl From<&Run> for RunDto {
    fn from(run: &Run) -> Self {
        Self {
            id: run.id.clone(),
            task_id: run.task_id.clone(),
            trigger_type: run.trigger_type,
            scheduled_for: run.scheduled_for.clone(),
            status: run.status,
            started_at: run.started_at.clone(),
            ended_at: run.ended_at.clone(),
            workspace_path: run.workspace_path.clone(),
            exit_code: run.exit_code,
            result_summary: run.result_summary.clone(),
            findings_count: run.findings_count.unwrap_or_default(),
            created_schedule_count: run.created_schedule_count.unwrap_or_default(),
        }
    }
}

impl RunDto {
    pub fn into_run_with_defaults(
        self,
        target_mode: RunTargetMode,
        codex_command_json: String,
    ) -> Run {
        let now = now_rfc3339();
        Run {
            id: if self.id.is_empty() {
                new_run_id()
            } else {
                self.id
            },
            task_id: self.task_id,
            trigger_type: self.trigger_type,
            scheduled_for: self.scheduled_for,
            attempt: 1,
            status: self.status,
            status_reason: None,
            queued_at: now.clone(),
            started_at: self.started_at,
            ended_at: self.ended_at,
            duration_ms: None,
            target_mode,
            workspace_path: self.workspace_path,
            worktree_path: None,
            branch_name: None,
            base_ref: None,
            commit_before: None,
            commit_after: None,
            codex_command_json,
            codex_session_id: None,
            pid: None,
            exit_code: self.exit_code,
            signal: None,
            stdout_log_path: None,
            stderr_log_path: None,
            events_jsonl_path: None,
            last_message_path: None,
            stdout_tail: None,
            stderr_tail: None,
            result_summary: self.result_summary,
            findings_count: Some(self.findings_count),
            created_schedule_count: Some(self.created_schedule_count),
            created_at: now.clone(),
            updated_at: now,
        }
    }
}
