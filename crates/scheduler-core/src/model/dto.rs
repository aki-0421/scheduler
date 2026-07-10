use serde::{Deserialize, Serialize};

use super::enums::{
    ApprovalPolicy, CleanupPolicy, MissedPolicy, OverlapPolicy, ProjectKind, RunStatus,
    RunTargetMode, SandboxMode, TaskKind, TaskStatus, TriggerType,
};
use super::ids::{new_run_id, new_task_id};
use super::tables::{Project, Run, Setting, Task};
use crate::time::now_rfc3339;
use crate::util::prompt_hash;
use crate::{Result, SchedulerError};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub status: TaskStatus,
    #[serde(default)]
    pub locked: bool,
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPromptDto {
    pub body: String,
}

pub const SCHEDULE_CLI_CAPABILITIES: &[&str] = &[
    "schedule:create",
    "schedule:update-current",
    "schedule:update-any",
    "schedule:pause-current",
    "schedule:run-now",
    "schedule:list",
];

impl From<&Task> for TaskDto {
    fn from(task: &Task) -> Self {
        Self {
            id: task.id.clone(),
            slug: task.slug.clone(),
            name: task.name.clone(),
            status: task.status,
            locked: task.locked,
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
            },
            prompt: TaskPromptDto {
                body: task.prompt_body.clone(),
            },
        }
    }
}

impl TryFrom<TaskDto> for Task {
    type Error = SchedulerError;

    fn try_from(dto: TaskDto) -> Result<Self> {
        let now = now_rfc3339();
        let capabilities = SCHEDULE_CLI_CAPABILITIES
            .iter()
            .map(|capability| (*capability).to_owned())
            .collect::<Vec<_>>();

        Ok(Self {
            id: if dto.id.is_empty() {
                new_task_id()
            } else {
                dto.id
            },
            slug: dto.slug,
            name: dto.name,
            status: dto.status,
            locked: dto.locked,
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
            inject_scheduler_instructions: true,
            target_mode: dto.target.mode,
            project_id: dto.target.project_id,
            repo_path: dto.target.repo_path,
            base_ref: dto.target.base_ref,
            model: dto.codex.model,
            reasoning_effort: dto.codex.reasoning_effort,
            sandbox_mode: SandboxMode::DangerFullAccess,
            approval_policy: ApprovalPolicy::Never,
            allow_schedule_cli: true,
            schedule_cli_capabilities: serde_json::to_string(&capabilities)?,
            max_created_schedules_per_run: 0,
            missed_policy: MissedPolicy::Skip,
            missed_window_days: 0,
            overlap_policy: OverlapPolicy::Skip,
            max_runtime_sec: 0,
            max_retries: 0,
            retry_backoff_sec: 0,
            cleanup_policy: CleanupPolicy::Keep,
            cleanup_after_days: None,
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
pub struct RunArtifactDto {
    pub id: String,
    pub run_id: String,
    pub kind: super::enums::RunArtifactKind,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<i64>,
    pub created_at: String,
}

impl From<&super::tables::RunArtifact> for RunArtifactDto {
    fn from(artifact: &super::tables::RunArtifact) -> Self {
        Self {
            id: artifact.id.clone(),
            run_id: artifact.run_id.clone(),
            kind: artifact.kind,
            path: artifact.path.clone(),
            title: artifact.title.clone(),
            mime_type: artifact.mime_type.clone(),
            size_bytes: artifact.size_bytes,
            created_at: artifact.created_at.clone(),
        }
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
    #[serde(default)]
    pub attempt: i64,
    pub status: RunStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_reason: Option<String>,
    #[serde(default)]
    pub queued_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    #[serde(default)]
    pub target_mode: RunTargetMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_after: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signal: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdout_log_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr_log_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events_jsonl_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_message_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdout_tail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr_tail: Option<String>,
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
            attempt: run.attempt,
            status: run.status,
            status_reason: run.status_reason.clone(),
            queued_at: run.queued_at.clone(),
            started_at: run.started_at.clone(),
            ended_at: run.ended_at.clone(),
            duration_ms: run.duration_ms,
            target_mode: run.target_mode,
            workspace_path: run.workspace_path.clone(),
            worktree_path: run.worktree_path.clone(),
            branch_name: run.branch_name.clone(),
            base_ref: run.base_ref.clone(),
            commit_before: run.commit_before.clone(),
            commit_after: run.commit_after.clone(),
            codex_session_id: run.codex_session_id.clone(),
            exit_code: run.exit_code,
            signal: run.signal.clone(),
            stdout_log_path: run.stdout_log_path.clone(),
            stderr_log_path: run.stderr_log_path.clone(),
            events_jsonl_path: run.events_jsonl_path.clone(),
            last_message_path: run.last_message_path.clone(),
            stdout_tail: run.stdout_tail.clone(),
            stderr_tail: run.stderr_tail.clone(),
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
            attempt: if self.attempt > 0 { self.attempt } else { 1 },
            status: self.status,
            status_reason: self.status_reason,
            queued_at: if self.queued_at.is_empty() {
                now.clone()
            } else {
                self.queued_at
            },
            started_at: self.started_at,
            ended_at: self.ended_at,
            duration_ms: self.duration_ms,
            target_mode: if self.target_mode == RunTargetMode::Chat {
                target_mode
            } else {
                self.target_mode
            },
            workspace_path: self.workspace_path,
            worktree_path: self.worktree_path,
            branch_name: self.branch_name,
            base_ref: self.base_ref,
            commit_before: self.commit_before,
            commit_after: self.commit_after,
            codex_command_json,
            codex_session_id: self.codex_session_id,
            pid: None,
            exit_code: self.exit_code,
            signal: self.signal,
            stdout_log_path: self.stdout_log_path,
            stderr_log_path: self.stderr_log_path,
            events_jsonl_path: self.events_jsonl_path,
            last_message_path: self.last_message_path,
            stdout_tail: self.stdout_tail,
            stderr_tail: self.stderr_tail,
            result_summary: self.result_summary,
            findings_count: Some(self.findings_count),
            created_schedule_count: Some(self.created_schedule_count),
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: ProjectKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_remote_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trusted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl From<&Project> for ProjectDto {
    fn from(project: &Project) -> Self {
        Self {
            id: project.id.clone(),
            name: project.name.clone(),
            path: project.path.clone(),
            kind: project.kind,
            git_root: project.git_root.clone(),
            git_remote_url: project.git_remote_url.clone(),
            default_branch: project.default_branch.clone(),
            trusted_at: project.trusted_at.clone(),
            created_at: project.created_at.clone(),
            updated_at: project.updated_at.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingDto {
    pub key: String,
    pub value_json: String,
    pub updated_at: String,
}

impl From<&Setting> for SettingDto {
    fn from(setting: &Setting) -> Self {
        Self {
            key: setting.key.clone(),
            value_json: setting.value_json.clone(),
            updated_at: setting.updated_at.clone(),
        }
    }
}
