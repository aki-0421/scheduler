use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{Executor, SqlitePool};

use crate::db::migrations::{MIGRATOR, SCHEMA_VERSION};
use crate::model::*;
use crate::settings::{
    RetentionSettings, DEFAULT_RETENTION_CAPABILITY_TOKEN_DELETE_AFTER_HOURS,
    DEFAULT_RETENTION_FAILED_RUN_LOGS_DAYS, DEFAULT_RETENTION_RUN_HISTORY_DAYS,
    DEFAULT_RETENTION_SUCCEEDED_RUN_LOGS_DAYS,
    SETTING_RETENTION_CAPABILITY_TOKEN_DELETE_AFTER_HOURS, SETTING_RETENTION_FAILED_RUN_LOGS_DAYS,
    SETTING_RETENTION_RUN_HISTORY_DAYS, SETTING_RETENTION_SUCCEEDED_RUN_LOGS_DAYS,
};
use crate::time::{now_rfc3339, validate_timezone};
use crate::util::validate_slug;
use crate::{Result, SchedulerError, ValidationError};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct SchedulerDb {
    pool: SqlitePool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdempotentInsert<T> {
    pub value: T,
    pub inserted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RunHistoryCleanupCounts {
    pub task_run_references_cleared: u64,
    pub run_events_deleted: u64,
    pub run_artifacts_deleted: u64,
    pub runs_deleted: u64,
}

impl SchedulerDb {
    pub async fn connect(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let existed_before_connect = path.exists();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .foreign_keys(true)
            .busy_timeout(Duration::from_millis(5_000));
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;
        configure_sqlite(&pool, true).await?;
        if existed_before_connect && has_pending_migration(&pool).await? {
            backup_database(&pool, path).await?;
        }
        run_migrations(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn connect_in_memory() -> Result<Self> {
        let options = SqliteConnectOptions::new()
            .filename(":memory:")
            .create_if_missing(true)
            .foreign_keys(true)
            .busy_timeout(Duration::from_millis(5_000));
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await?;
        configure_sqlite(&pool, false).await?;
        run_migrations(&pool).await?;
        Ok(Self { pool })
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn run_migrations(&self) -> Result<()> {
        run_migrations(&self.pool).await
    }

    pub async fn create_project(&self, project: &Project) -> Result<()> {
        sqlx::query(
            "INSERT INTO projects (
                id, name, path, kind, git_root, git_remote_url, default_branch, trusted_at,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&project.id)
        .bind(&project.name)
        .bind(&project.path)
        .bind(project.kind)
        .bind(&project.git_root)
        .bind(&project.git_remote_url)
        .bind(&project.default_branch)
        .bind(&project.trusted_at)
        .bind(&project.created_at)
        .bind(&project.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_project(&self, id: &str) -> Result<Option<Project>> {
        Ok(sqlx::query_as::<_, Project>(
            "SELECT id, name, path, kind, git_root, git_remote_url, default_branch, trusted_at,
                    created_at, updated_at
             FROM projects WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn list_projects(&self) -> Result<Vec<Project>> {
        Ok(sqlx::query_as::<_, Project>(
            "SELECT id, name, path, kind, git_root, git_remote_url, default_branch, trusted_at,
                    created_at, updated_at
             FROM projects ORDER BY name ASC, id ASC",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn update_project(&self, project: &Project) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE projects
             SET name = ?, path = ?, kind = ?, git_root = ?, git_remote_url = ?,
                 default_branch = ?, trusted_at = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(&project.name)
        .bind(&project.path)
        .bind(project.kind)
        .bind(&project.git_root)
        .bind(&project.git_remote_url)
        .bind(&project.default_branch)
        .bind(&project.trusted_at)
        .bind(&project.updated_at)
        .bind(&project.id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn untrust_project(&self, id: &str, updated_at: &str) -> Result<Option<Project>> {
        let result = sqlx::query(
            "UPDATE projects
             SET trusted_at = NULL, updated_at = ?
             WHERE id = ?",
        )
        .bind(updated_at)
        .bind(id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Ok(None);
        }
        self.get_project(id).await
    }

    pub async fn count_active_repo_tasks_for_project(&self, project: &Project) -> Result<i64> {
        let root = project.git_root.as_deref().unwrap_or(&project.path);
        let child_prefix = if root.ends_with(std::path::MAIN_SEPARATOR) {
            root.to_owned()
        } else {
            format!("{}{}", root, std::path::MAIN_SEPARATOR)
        };
        let child_pattern = format!("{}%", escape_sql_like(&child_prefix));
        Ok(sqlx::query_scalar(
            "SELECT COUNT(1)
             FROM tasks
             WHERE status = 'active'
               AND target_mode IN ('repo-local', 'repo-worktree')
               AND (
                    project_id = ?
                    OR repo_path = ?
                    OR repo_path LIKE ? ESCAPE '!'
               )",
        )
        .bind(&project.id)
        .bind(root)
        .bind(child_pattern)
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn delete_project(&self, id: &str) -> Result<bool> {
        let result = sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn create_task(&self, task: &Task) -> Result<()> {
        self.validate_task(task).await?;
        sqlx::query(
            "INSERT INTO tasks (
                id, slug, name, description, status, locked, kind, cron_expr, run_at, timezone,
                next_run_at, last_scheduled_for, schedule_status, schedule_error, prompt_body,
                prompt_hash, inject_scheduler_instructions, target_mode, project_id, repo_path,
                base_ref, model, reasoning_effort, sandbox_mode, approval_policy,
                allow_schedule_cli, schedule_cli_capabilities, max_created_schedules_per_run,
                missed_policy, missed_window_days, overlap_policy, max_runtime_sec, max_retries,
                retry_backoff_sec, cleanup_policy, cleanup_after_days, created_by,
                created_by_run_id, created_at, updated_at, deleted_at
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )",
        )
        .bind(&task.id)
        .bind(&task.slug)
        .bind(&task.name)
        .bind(&task.description)
        .bind(task.status)
        .bind(task.locked)
        .bind(task.kind)
        .bind(&task.cron_expr)
        .bind(&task.run_at)
        .bind(&task.timezone)
        .bind(&task.next_run_at)
        .bind(&task.last_scheduled_for)
        .bind(task.schedule_status)
        .bind(&task.schedule_error)
        .bind(&task.prompt_body)
        .bind(&task.prompt_hash)
        .bind(task.inject_scheduler_instructions)
        .bind(task.target_mode)
        .bind(&task.project_id)
        .bind(&task.repo_path)
        .bind(&task.base_ref)
        .bind(&task.model)
        .bind(&task.reasoning_effort)
        .bind(task.sandbox_mode)
        .bind(task.approval_policy)
        .bind(task.allow_schedule_cli)
        .bind(&task.schedule_cli_capabilities)
        .bind(task.max_created_schedules_per_run)
        .bind(task.missed_policy)
        .bind(task.missed_window_days)
        .bind(task.overlap_policy)
        .bind(task.max_runtime_sec)
        .bind(task.max_retries)
        .bind(task.retry_backoff_sec)
        .bind(task.cleanup_policy)
        .bind(task.cleanup_after_days)
        .bind(&task.created_by)
        .bind(&task.created_by_run_id)
        .bind(&task.created_at)
        .bind(&task.updated_at)
        .bind(&task.deleted_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_task(&self, id: &str) -> Result<Option<Task>> {
        Ok(sqlx::query_as::<_, Task>(TASK_SELECT_BY_ID)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?)
    }

    pub async fn get_task_by_slug(&self, slug: &str) -> Result<Option<Task>> {
        Ok(sqlx::query_as::<_, Task>(TASK_SELECT_BY_SLUG)
            .bind(slug)
            .fetch_optional(&self.pool)
            .await?)
    }

    pub async fn list_tasks(&self) -> Result<Vec<Task>> {
        Ok(sqlx::query_as::<_, Task>(TASK_SELECT_ALL)
            .fetch_all(&self.pool)
            .await?)
    }

    pub async fn update_task(&self, task: &Task) -> Result<bool> {
        self.validate_task(task).await?;
        let result = sqlx::query(
            "UPDATE tasks SET
                slug = ?, name = ?, description = ?, status = ?, locked = ?, kind = ?, cron_expr = ?,
                run_at = ?, timezone = ?, next_run_at = ?, last_scheduled_for = ?,
                schedule_status = ?, schedule_error = ?, prompt_body = ?, prompt_hash = ?,
                inject_scheduler_instructions = ?, target_mode = ?, project_id = ?,
                repo_path = ?, base_ref = ?, model = ?, reasoning_effort = ?, sandbox_mode = ?,
                approval_policy = ?, allow_schedule_cli = ?, schedule_cli_capabilities = ?,
                max_created_schedules_per_run = ?, missed_policy = ?, missed_window_days = ?,
                overlap_policy = ?, max_runtime_sec = ?, max_retries = ?, retry_backoff_sec = ?,
                cleanup_policy = ?, cleanup_after_days = ?, created_by = ?,
                created_by_run_id = ?, updated_at = ?, deleted_at = ?
             WHERE id = ?",
        )
        .bind(&task.slug)
        .bind(&task.name)
        .bind(&task.description)
        .bind(task.status)
        .bind(task.locked)
        .bind(task.kind)
        .bind(&task.cron_expr)
        .bind(&task.run_at)
        .bind(&task.timezone)
        .bind(&task.next_run_at)
        .bind(&task.last_scheduled_for)
        .bind(task.schedule_status)
        .bind(&task.schedule_error)
        .bind(&task.prompt_body)
        .bind(&task.prompt_hash)
        .bind(task.inject_scheduler_instructions)
        .bind(task.target_mode)
        .bind(&task.project_id)
        .bind(&task.repo_path)
        .bind(&task.base_ref)
        .bind(&task.model)
        .bind(&task.reasoning_effort)
        .bind(task.sandbox_mode)
        .bind(task.approval_policy)
        .bind(task.allow_schedule_cli)
        .bind(&task.schedule_cli_capabilities)
        .bind(task.max_created_schedules_per_run)
        .bind(task.missed_policy)
        .bind(task.missed_window_days)
        .bind(task.overlap_policy)
        .bind(task.max_runtime_sec)
        .bind(task.max_retries)
        .bind(task.retry_backoff_sec)
        .bind(task.cleanup_policy)
        .bind(task.cleanup_after_days)
        .bind(&task.created_by)
        .bind(&task.created_by_run_id)
        .bind(&task.updated_at)
        .bind(&task.deleted_at)
        .bind(&task.id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn delete_task(&self, id: &str, deleted_at: &str) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE tasks
             SET status = 'deleted', deleted_at = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(deleted_at)
        .bind(deleted_at)
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn find_active_tasks_due(&self, now: &str) -> Result<Vec<Task>> {
        Ok(sqlx::query_as::<_, Task>(TASK_SELECT_ACTIVE_DUE)
            .bind(now)
            .fetch_all(&self.pool)
            .await?)
    }

    pub async fn create_run(&self, run: &Run) -> Result<()> {
        bind_run(sqlx::query(INSERT_RUN_SQL), run)
            .execute(&self.pool)
            .await
            .map(|_| ())
            .map_err(Into::into)
    }

    /// Creates an idempotent scheduled run keyed by `(task_id, scheduled_for, attempt)`.
    ///
    /// This API is intentionally limited to scheduled/catch-up enqueue paths where
    /// `scheduled_for` is a stable non-null instant. Manual, CLI, and retry runs
    /// should use `create_run` so each invocation records a distinct run.
    pub async fn create_run_idempotent(&self, run: &Run) -> Result<IdempotentInsert<Run>> {
        let scheduled_for = run.scheduled_for.as_deref().ok_or_else(|| {
            SchedulerError::Validation(ValidationError::IdempotentRunRequiresScheduledFor)
        })?;

        if !matches!(
            run.trigger_type,
            TriggerType::Schedule | TriggerType::Catchup
        ) {
            return Err(SchedulerError::Validation(
                ValidationError::IdempotentRunRequiresScheduledTrigger,
            ));
        }

        let inserted = bind_run(sqlx::query(INSERT_RUN_ON_IDEMPOTENCY_CONFLICT_SQL), run)
            .execute(&self.pool)
            .await?
            .rows_affected()
            > 0;
        let value = self
            .get_run_by_idempotency_key(&run.task_id, scheduled_for, run.attempt)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;

        Ok(IdempotentInsert { value, inserted })
    }

    pub async fn get_run(&self, id: &str) -> Result<Option<Run>> {
        Ok(sqlx::query_as::<_, Run>(RUN_SELECT_BY_ID)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?)
    }

    pub async fn get_run_by_idempotency_key(
        &self,
        task_id: &str,
        scheduled_for: &str,
        attempt: i64,
    ) -> Result<Option<Run>> {
        Ok(sqlx::query_as::<_, Run>(RUN_SELECT_BY_IDEMPOTENCY_KEY)
            .bind(task_id)
            .bind(scheduled_for)
            .bind(attempt)
            .fetch_optional(&self.pool)
            .await?)
    }

    pub async fn update_run(&self, run: &Run) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE runs SET
                task_id = ?, trigger_type = ?, scheduled_for = ?, attempt = ?, status = ?,
                status_reason = ?, queued_at = ?, started_at = ?, ended_at = ?, duration_ms = ?,
                target_mode = ?, workspace_path = ?, worktree_path = ?, branch_name = ?,
                base_ref = ?, commit_before = ?, commit_after = ?, codex_command_json = ?,
                codex_session_id = ?, pid = ?, exit_code = ?, signal = ?, stdout_log_path = ?,
                stderr_log_path = ?, events_jsonl_path = ?, last_message_path = ?,
                stdout_tail = ?, stderr_tail = ?, result_summary = ?, findings_count = ?,
                created_schedule_count = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(&run.task_id)
        .bind(run.trigger_type)
        .bind(&run.scheduled_for)
        .bind(run.attempt)
        .bind(run.status)
        .bind(&run.status_reason)
        .bind(&run.queued_at)
        .bind(&run.started_at)
        .bind(&run.ended_at)
        .bind(run.duration_ms)
        .bind(run.target_mode)
        .bind(&run.workspace_path)
        .bind(&run.worktree_path)
        .bind(&run.branch_name)
        .bind(&run.base_ref)
        .bind(&run.commit_before)
        .bind(&run.commit_after)
        .bind(&run.codex_command_json)
        .bind(&run.codex_session_id)
        .bind(run.pid)
        .bind(run.exit_code)
        .bind(&run.signal)
        .bind(&run.stdout_log_path)
        .bind(&run.stderr_log_path)
        .bind(&run.events_jsonl_path)
        .bind(&run.last_message_path)
        .bind(&run.stdout_tail)
        .bind(&run.stderr_tail)
        .bind(&run.result_summary)
        .bind(run.findings_count)
        .bind(run.created_schedule_count)
        .bind(&run.updated_at)
        .bind(&run.id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn delete_run(&self, id: &str) -> Result<bool> {
        let result = sqlx::query("DELETE FROM runs WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn list_runs_for_task(&self, task_id: &str) -> Result<Vec<Run>> {
        Ok(sqlx::query_as::<_, Run>(RUN_SELECT_BY_TASK)
            .bind(task_id)
            .fetch_all(&self.pool)
            .await?)
    }

    pub async fn list_runs_for_log_cleanup(
        &self,
        succeeded_cutoff: &str,
        failed_cutoff: &str,
    ) -> Result<Vec<Run>> {
        Ok(sqlx::query_as::<_, Run>(&format!(
            "{RUN_SELECT}
             WHERE ended_at IS NOT NULL
               AND (
                 (status = 'succeeded' AND ended_at <= ?)
                 OR (
                   status IN ('failed', 'canceled', 'skipped', 'interrupted', 'timed_out')
                   AND ended_at <= ?
                 )
               )
             ORDER BY ended_at ASC, id ASC"
        ))
        .bind(succeeded_cutoff)
        .bind(failed_cutoff)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn list_delete_after_days_worktree_runs(&self) -> Result<Vec<Run>> {
        Ok(sqlx::query_as::<_, Run>(&format!(
            "{RUN_SELECT_ALIASED}
             JOIN tasks t ON t.id = r.task_id
             WHERE t.cleanup_policy = 'delete_after_days'
               AND r.worktree_path IS NOT NULL
               AND r.ended_at IS NOT NULL
               AND r.status IN (
                 'succeeded', 'failed', 'canceled', 'skipped', 'interrupted', 'timed_out'
               )
             ORDER BY r.ended_at ASC, r.id ASC"
        ))
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn delete_terminal_runs_ended_before(
        &self,
        cutoff: &str,
    ) -> Result<RunHistoryCleanupCounts> {
        let mut tx = self.pool.begin().await?;

        let task_run_references_cleared = sqlx::query(&format!(
            "UPDATE tasks
             SET created_by_run_id = NULL
             WHERE created_by_run_id IN ({TERMINAL_RUN_HISTORY_SUBQUERY})"
        ))
        .bind(cutoff)
        .execute(&mut *tx)
        .await?
        .rows_affected();

        let run_events_deleted = sqlx::query(&format!(
            "DELETE FROM run_events
             WHERE run_id IN ({TERMINAL_RUN_HISTORY_SUBQUERY})"
        ))
        .bind(cutoff)
        .execute(&mut *tx)
        .await?
        .rows_affected();

        let run_artifacts_deleted = sqlx::query(&format!(
            "DELETE FROM run_artifacts
             WHERE run_id IN ({TERMINAL_RUN_HISTORY_SUBQUERY})"
        ))
        .bind(cutoff)
        .execute(&mut *tx)
        .await?
        .rows_affected();

        let runs_deleted = sqlx::query(&format!(
            "DELETE FROM runs
             WHERE id IN ({TERMINAL_RUN_HISTORY_SUBQUERY})"
        ))
        .bind(cutoff)
        .execute(&mut *tx)
        .await?
        .rows_affected();

        tx.commit().await?;
        Ok(RunHistoryCleanupCounts {
            task_run_references_cleared,
            run_events_deleted,
            run_artifacts_deleted,
            runs_deleted,
        })
    }

    pub async fn create_run_event(&self, event: &RunEvent) -> Result<()> {
        sqlx::query(
            "INSERT INTO run_events (
                id, run_id, event_index, source, level, event_type, message, payload_json,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&event.id)
        .bind(&event.run_id)
        .bind(event.event_index)
        .bind(event.source)
        .bind(&event.level)
        .bind(&event.event_type)
        .bind(&event.message)
        .bind(&event.payload_json)
        .bind(&event.created_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_run_event(&self, id: &str) -> Result<Option<RunEvent>> {
        Ok(sqlx::query_as::<_, RunEvent>(
            "SELECT id, run_id, event_index, source, level, event_type, message, payload_json,
                    created_at
             FROM run_events WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn list_run_events(&self, run_id: &str) -> Result<Vec<RunEvent>> {
        Ok(sqlx::query_as::<_, RunEvent>(
            "SELECT id, run_id, event_index, source, level, event_type, message, payload_json,
                    created_at
             FROM run_events WHERE run_id = ? ORDER BY event_index ASC",
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn update_run_event(&self, event: &RunEvent) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE run_events
             SET run_id = ?, event_index = ?, source = ?, level = ?, event_type = ?,
                 message = ?, payload_json = ?, created_at = ?
             WHERE id = ?",
        )
        .bind(&event.run_id)
        .bind(event.event_index)
        .bind(event.source)
        .bind(&event.level)
        .bind(&event.event_type)
        .bind(&event.message)
        .bind(&event.payload_json)
        .bind(&event.created_at)
        .bind(&event.id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn delete_run_event(&self, id: &str) -> Result<bool> {
        let result = sqlx::query("DELETE FROM run_events WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn create_run_artifact(&self, artifact: &RunArtifact) -> Result<()> {
        sqlx::query(
            "INSERT INTO run_artifacts (
                id, run_id, kind, path, title, mime_type, size_bytes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&artifact.id)
        .bind(&artifact.run_id)
        .bind(artifact.kind)
        .bind(&artifact.path)
        .bind(&artifact.title)
        .bind(&artifact.mime_type)
        .bind(artifact.size_bytes)
        .bind(&artifact.created_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_run_artifact(&self, id: &str) -> Result<Option<RunArtifact>> {
        Ok(sqlx::query_as::<_, RunArtifact>(
            "SELECT id, run_id, kind, path, title, mime_type, size_bytes, created_at
             FROM run_artifacts WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn list_run_artifacts(&self, run_id: &str) -> Result<Vec<RunArtifact>> {
        Ok(sqlx::query_as::<_, RunArtifact>(
            "SELECT id, run_id, kind, path, title, mime_type, size_bytes, created_at
             FROM run_artifacts WHERE run_id = ? ORDER BY created_at ASC, id ASC",
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn update_run_artifact(&self, artifact: &RunArtifact) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE run_artifacts
             SET run_id = ?, kind = ?, path = ?, title = ?, mime_type = ?, size_bytes = ?,
                 created_at = ?
             WHERE id = ?",
        )
        .bind(&artifact.run_id)
        .bind(artifact.kind)
        .bind(&artifact.path)
        .bind(&artifact.title)
        .bind(&artifact.mime_type)
        .bind(artifact.size_bytes)
        .bind(&artifact.created_at)
        .bind(&artifact.id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn delete_run_artifact(&self, id: &str) -> Result<bool> {
        let result = sqlx::query("DELETE FROM run_artifacts WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn create_task_audit_event(&self, event: &TaskAuditEvent) -> Result<()> {
        sqlx::query(
            "INSERT INTO task_audit_events (
                id, task_id, actor_type, actor_id, action, before_json, after_json, reason,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&event.id)
        .bind(&event.task_id)
        .bind(event.actor_type)
        .bind(&event.actor_id)
        .bind(&event.action)
        .bind(&event.before_json)
        .bind(&event.after_json)
        .bind(&event.reason)
        .bind(&event.created_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_task_audit_event(&self, id: &str) -> Result<Option<TaskAuditEvent>> {
        Ok(sqlx::query_as::<_, TaskAuditEvent>(
            "SELECT id, task_id, actor_type, actor_id, action, before_json, after_json, reason,
                    created_at
             FROM task_audit_events WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn list_task_audit_events(&self, task_id: &str) -> Result<Vec<TaskAuditEvent>> {
        Ok(sqlx::query_as::<_, TaskAuditEvent>(
            "SELECT id, task_id, actor_type, actor_id, action, before_json, after_json, reason,
                    created_at
             FROM task_audit_events WHERE task_id = ? ORDER BY created_at DESC, id DESC",
        )
        .bind(task_id)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn list_task_audit_events_limited(
        &self,
        task_id: &str,
        limit: i64,
    ) -> Result<Vec<TaskAuditEvent>> {
        Ok(sqlx::query_as::<_, TaskAuditEvent>(
            "SELECT id, task_id, actor_type, actor_id, action, before_json, after_json, reason,
                    created_at
             FROM task_audit_events
             WHERE task_id = ?
             ORDER BY created_at DESC, id DESC
             LIMIT ?",
        )
        .bind(task_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn update_task_audit_event(&self, event: &TaskAuditEvent) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE task_audit_events
             SET task_id = ?, actor_type = ?, actor_id = ?, action = ?, before_json = ?,
                 after_json = ?, reason = ?, created_at = ?
             WHERE id = ?",
        )
        .bind(&event.task_id)
        .bind(event.actor_type)
        .bind(&event.actor_id)
        .bind(&event.action)
        .bind(&event.before_json)
        .bind(&event.after_json)
        .bind(&event.reason)
        .bind(&event.created_at)
        .bind(&event.id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn delete_task_audit_event(&self, id: &str) -> Result<bool> {
        let result = sqlx::query("DELETE FROM task_audit_events WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn create_schedule_capability_token(
        &self,
        token: &ScheduleCapabilityToken,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO schedule_capability_tokens (
                id, run_id, task_id, token_hash, capabilities_json, expires_at, max_creates,
                create_count, revoked_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&token.id)
        .bind(&token.run_id)
        .bind(&token.task_id)
        .bind(&token.token_hash)
        .bind(&token.capabilities_json)
        .bind(&token.expires_at)
        .bind(token.max_creates)
        .bind(token.create_count)
        .bind(&token.revoked_at)
        .bind(&token.created_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_schedule_capability_token(
        &self,
        id: &str,
    ) -> Result<Option<ScheduleCapabilityToken>> {
        Ok(sqlx::query_as::<_, ScheduleCapabilityToken>(
            "SELECT id, run_id, task_id, token_hash, capabilities_json, expires_at, max_creates,
                    create_count, revoked_at, created_at
             FROM schedule_capability_tokens WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn get_schedule_capability_token_by_hash(
        &self,
        token_hash: &str,
    ) -> Result<Option<ScheduleCapabilityToken>> {
        Ok(sqlx::query_as::<_, ScheduleCapabilityToken>(
            "SELECT id, run_id, task_id, token_hash, capabilities_json, expires_at, max_creates,
                    create_count, revoked_at, created_at
             FROM schedule_capability_tokens WHERE token_hash = ?",
        )
        .bind(token_hash)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn update_schedule_capability_token(
        &self,
        token: &ScheduleCapabilityToken,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE schedule_capability_tokens
             SET run_id = ?, task_id = ?, token_hash = ?, capabilities_json = ?, expires_at = ?,
                 max_creates = ?, create_count = ?, revoked_at = ?, created_at = ?
             WHERE id = ?",
        )
        .bind(&token.run_id)
        .bind(&token.task_id)
        .bind(&token.token_hash)
        .bind(&token.capabilities_json)
        .bind(&token.expires_at)
        .bind(token.max_creates)
        .bind(token.create_count)
        .bind(&token.revoked_at)
        .bind(&token.created_at)
        .bind(&token.id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn revoke_schedule_capability_token(
        &self,
        token_hash: &str,
        revoked_at: &str,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE schedule_capability_tokens SET revoked_at = ? WHERE token_hash = ?",
        )
        .bind(revoked_at)
        .bind(token_hash)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn delete_schedule_capability_token(&self, id: &str) -> Result<bool> {
        let result = sqlx::query("DELETE FROM schedule_capability_tokens WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn delete_expired_schedule_capability_tokens(&self, older_than: &str) -> Result<u64> {
        let result = sqlx::query("DELETE FROM schedule_capability_tokens WHERE expires_at <= ?")
            .bind(older_than)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn count_tasks_by_status(&self) -> Result<HashMap<String, i64>> {
        let rows = sqlx::query_as::<_, (String, i64)>(
            "SELECT status, COUNT(*) FROM tasks GROUP BY status ORDER BY status ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().collect())
    }

    pub async fn count_runs_by_status(&self) -> Result<HashMap<String, i64>> {
        let rows = sqlx::query_as::<_, (String, i64)>(
            "SELECT status, COUNT(*) FROM runs GROUP BY status ORDER BY status ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().collect())
    }

    pub async fn get_setting_row(&self, key: &str) -> Result<Option<Setting>> {
        Ok(sqlx::query_as::<_, Setting>(
            "SELECT key, value_json, updated_at FROM settings WHERE key = ?",
        )
        .bind(key)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn list_settings(&self) -> Result<Vec<Setting>> {
        Ok(sqlx::query_as::<_, Setting>(
            "SELECT key, value_json, updated_at FROM settings ORDER BY key ASC",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn get_setting<T>(&self, key: &str) -> Result<Option<T>>
    where
        T: DeserializeOwned,
    {
        let Some(row) = self.get_setting_row(key).await? else {
            return Ok(None);
        };
        Ok(Some(serde_json::from_str(&row.value_json)?))
    }

    pub async fn retention_settings(&self) -> Result<RetentionSettings> {
        Ok(RetentionSettings {
            run_history_days: non_negative_setting(
                self.get_setting::<i64>(SETTING_RETENTION_RUN_HISTORY_DAYS)
                    .await?,
                DEFAULT_RETENTION_RUN_HISTORY_DAYS,
            ),
            succeeded_run_logs_days: non_negative_setting(
                self.get_setting::<i64>(SETTING_RETENTION_SUCCEEDED_RUN_LOGS_DAYS)
                    .await?,
                DEFAULT_RETENTION_SUCCEEDED_RUN_LOGS_DAYS,
            ),
            failed_run_logs_days: non_negative_setting(
                self.get_setting::<i64>(SETTING_RETENTION_FAILED_RUN_LOGS_DAYS)
                    .await?,
                DEFAULT_RETENTION_FAILED_RUN_LOGS_DAYS,
            ),
            capability_token_delete_after_hours: non_negative_setting(
                self.get_setting::<i64>(SETTING_RETENTION_CAPABILITY_TOKEN_DELETE_AFTER_HOURS)
                    .await?,
                DEFAULT_RETENTION_CAPABILITY_TOKEN_DELETE_AFTER_HOURS,
            ),
        })
    }

    pub async fn set_setting<T>(&self, key: &str, value: &T) -> Result<()>
    where
        T: Serialize,
    {
        let value_json = serde_json::to_string(value)?;
        let updated_at = now_rfc3339();
        sqlx::query(
            "INSERT INTO settings (key, value_json, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = excluded.updated_at",
        )
        .bind(key)
        .bind(value_json)
        .bind(updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete_setting(&self, key: &str) -> Result<bool> {
        let result = sqlx::query("DELETE FROM settings WHERE key = ?")
            .bind(key)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn validate_task(&self, task: &Task) -> Result<()> {
        validate_slug(&task.slug)?;
        validate_timezone(&task.timezone)?;

        if task.kind == TaskKind::Once && empty_opt(task.run_at.as_deref()) {
            return Err(SchedulerError::Validation(ValidationError::MissingRunAt));
        }

        if task.kind == TaskKind::Cron && empty_opt(task.cron_expr.as_deref()) {
            return Err(SchedulerError::Validation(ValidationError::MissingCronExpr));
        }

        if task.target_mode == RunTargetMode::RepoLocal {
            return Err(SchedulerError::Validation(
                ValidationError::ProjectTargetRequiresWorktree,
            ));
        }

        if task.target_mode == RunTargetMode::RepoWorktree && empty_opt(task.project_id.as_deref())
        {
            return Err(SchedulerError::Validation(ValidationError::MissingTarget));
        }

        if task.target_mode == RunTargetMode::RepoWorktree {
            let Some(project_id) = task
                .project_id
                .as_deref()
                .filter(|id| !id.trim().is_empty())
            else {
                return Err(SchedulerError::Validation(
                    ValidationError::RepoWorktreeRequiresGitProject,
                ));
            };

            let project = self.get_project(project_id).await?;
            let Some(project) = project.filter(|project| {
                project.kind == ProjectKind::Git && !empty_opt(project.git_root.as_deref())
            }) else {
                return Err(SchedulerError::Validation(
                    ValidationError::RepoWorktreeRequiresGitProject,
                ));
            };
            if let Some(repo_path) = task.repo_path.as_deref() {
                if Some(repo_path) != project.git_root.as_deref() {
                    return Err(SchedulerError::Validation(
                        ValidationError::ProjectTargetPathMismatch,
                    ));
                }
            }
        }

        Ok(())
    }
}

fn empty_opt(value: Option<&str>) -> bool {
    value.map(str::trim).unwrap_or_default().is_empty()
}

fn non_negative_setting(value: Option<i64>, default: i64) -> i64 {
    value.unwrap_or(default).max(0)
}

fn escape_sql_like(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        if matches!(ch, '!' | '%' | '_') {
            escaped.push('!');
        }
        escaped.push(ch);
    }
    escaped
}

pub async fn backup_database(pool: &SqlitePool, path: &Path) -> Result<Option<PathBuf>> {
    if !path.exists() {
        return Ok(None);
    }

    let Some(parent) = path.parent() else {
        return Ok(None);
    };

    let backup_dir = parent.join("backups");
    std::fs::create_dir_all(&backup_dir)?;

    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("scheduler");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("sqlite3");
    let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
    let backup_path = backup_dir.join(format!("{stem}-{timestamp}-{}.{extension}", Uuid::now_v7()));
    let backup_path_sql = backup_path.to_string_lossy().into_owned();

    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(pool)
        .await?;
    sqlx::query("VACUUM main INTO ?")
        .bind(backup_path_sql)
        .execute(pool)
        .await?;

    Ok(Some(backup_path))
}

async fn configure_sqlite(pool: &SqlitePool, use_wal: bool) -> Result<()> {
    pool.execute("PRAGMA foreign_keys = ON").await?;
    pool.execute("PRAGMA busy_timeout = 5000").await?;
    if use_wal {
        pool.execute("PRAGMA journal_mode = WAL").await?;
    }
    Ok(())
}

async fn run_migrations(pool: &SqlitePool) -> Result<()> {
    MIGRATOR.run(pool).await?;
    sqlx::query(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))
        .execute(pool)
        .await?;
    Ok(())
}

async fn has_pending_migration(pool: &SqlitePool) -> Result<bool> {
    let user_version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(pool)
        .await?;
    if user_version < SCHEMA_VERSION {
        return Ok(true);
    }

    let has_sqlx_migrations: i64 = sqlx::query_scalar(
        "SELECT COUNT(1)
         FROM sqlite_master
         WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_one(pool)
    .await?;
    if has_sqlx_migrations == 0 {
        return Ok(MIGRATOR
            .migrations
            .iter()
            .any(|migration| migration.migration_type.is_up_migration()));
    }

    let applied_rows = match sqlx::query_as::<_, (i64, Vec<u8>, i64)>(
        "SELECT version, checksum, success FROM _sqlx_migrations ORDER BY version",
    )
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(_) => return Ok(true),
    };

    let mut applied_migrations = HashMap::with_capacity(applied_rows.len());
    for (version, checksum, success) in applied_rows {
        if success == 0 {
            return Ok(true);
        }
        applied_migrations.insert(version, checksum);
    }

    for migration in MIGRATOR
        .migrations
        .iter()
        .filter(|migration| migration.migration_type.is_up_migration())
    {
        let Some(applied_checksum) = applied_migrations.get(&migration.version) else {
            return Ok(true);
        };
        if applied_checksum.as_slice() != migration.checksum.as_ref() {
            return Ok(true);
        }
    }

    Ok(false)
}

const TASK_SELECT_BY_ID: &str =
    "SELECT id, slug, name, description, status, locked, kind, cron_expr,
    run_at, timezone, next_run_at, last_scheduled_for, schedule_status, schedule_error,
    prompt_body, prompt_hash, inject_scheduler_instructions, target_mode, project_id, repo_path,
    base_ref, model, reasoning_effort, sandbox_mode, approval_policy, allow_schedule_cli,
    schedule_cli_capabilities, max_created_schedules_per_run, missed_policy, missed_window_days,
    overlap_policy, max_runtime_sec, max_retries, retry_backoff_sec, cleanup_policy,
    cleanup_after_days, created_by, created_by_run_id, created_at, updated_at, deleted_at
    FROM tasks WHERE id = ?";

const TASK_SELECT_BY_SLUG: &str =
    "SELECT id, slug, name, description, status, locked, kind, cron_expr,
    run_at, timezone, next_run_at, last_scheduled_for, schedule_status, schedule_error,
    prompt_body, prompt_hash, inject_scheduler_instructions, target_mode, project_id, repo_path,
    base_ref, model, reasoning_effort, sandbox_mode, approval_policy, allow_schedule_cli,
    schedule_cli_capabilities, max_created_schedules_per_run, missed_policy, missed_window_days,
    overlap_policy, max_runtime_sec, max_retries, retry_backoff_sec, cleanup_policy,
    cleanup_after_days, created_by, created_by_run_id, created_at, updated_at, deleted_at
    FROM tasks WHERE slug = ?";

const TASK_SELECT_ALL: &str = "SELECT id, slug, name, description, status, locked, kind, cron_expr,
    run_at, timezone, next_run_at, last_scheduled_for, schedule_status, schedule_error,
    prompt_body, prompt_hash, inject_scheduler_instructions, target_mode, project_id, repo_path,
    base_ref, model, reasoning_effort, sandbox_mode, approval_policy, allow_schedule_cli,
    schedule_cli_capabilities, max_created_schedules_per_run, missed_policy, missed_window_days,
    overlap_policy, max_runtime_sec, max_retries, retry_backoff_sec, cleanup_policy,
    cleanup_after_days, created_by, created_by_run_id, created_at, updated_at, deleted_at
    FROM tasks ORDER BY updated_at DESC, id DESC";

const TASK_SELECT_ACTIVE_DUE: &str =
    "SELECT id, slug, name, description, status, locked, kind, cron_expr,
    run_at, timezone, next_run_at, last_scheduled_for, schedule_status, schedule_error,
    prompt_body, prompt_hash, inject_scheduler_instructions, target_mode, project_id, repo_path,
    base_ref, model, reasoning_effort, sandbox_mode, approval_policy, allow_schedule_cli,
    schedule_cli_capabilities, max_created_schedules_per_run, missed_policy, missed_window_days,
    overlap_policy, max_runtime_sec, max_retries, retry_backoff_sec, cleanup_policy,
    cleanup_after_days, created_by, created_by_run_id, created_at, updated_at, deleted_at
    FROM tasks
    WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ?
    ORDER BY next_run_at ASC, id ASC";

const RUN_SELECT_BY_ID: &str = "SELECT id, task_id, trigger_type, scheduled_for, attempt, status,
    status_reason, queued_at, started_at, ended_at, duration_ms, target_mode, workspace_path,
    worktree_path, branch_name, base_ref, commit_before, commit_after, codex_command_json,
    codex_session_id, pid, exit_code, signal, stdout_log_path, stderr_log_path, events_jsonl_path,
    last_message_path, stdout_tail, stderr_tail, result_summary, findings_count,
    created_schedule_count, created_at, updated_at
    FROM runs WHERE id = ?";

const RUN_SELECT_BY_IDEMPOTENCY_KEY: &str = "SELECT id, task_id, trigger_type, scheduled_for,
    attempt, status, status_reason, queued_at, started_at, ended_at, duration_ms, target_mode,
    workspace_path, worktree_path, branch_name, base_ref, commit_before, commit_after,
    codex_command_json, codex_session_id, pid, exit_code, signal, stdout_log_path,
    stderr_log_path, events_jsonl_path, last_message_path, stdout_tail, stderr_tail,
    result_summary, findings_count, created_schedule_count, created_at, updated_at
    FROM runs WHERE task_id = ? AND scheduled_for = ? AND attempt = ?";

const RUN_SELECT_BY_TASK: &str = "SELECT id, task_id, trigger_type, scheduled_for, attempt, status,
    status_reason, queued_at, started_at, ended_at, duration_ms, target_mode, workspace_path,
    worktree_path, branch_name, base_ref, commit_before, commit_after, codex_command_json,
    codex_session_id, pid, exit_code, signal, stdout_log_path, stderr_log_path, events_jsonl_path,
    last_message_path, stdout_tail, stderr_tail, result_summary, findings_count,
    created_schedule_count, created_at, updated_at
    FROM runs WHERE task_id = ?
    ORDER BY started_at DESC, created_at DESC";

const RUN_SELECT: &str = "SELECT id, task_id, trigger_type, scheduled_for, attempt, status,
    status_reason, queued_at, started_at, ended_at, duration_ms, target_mode, workspace_path,
    worktree_path, branch_name, base_ref, commit_before, commit_after, codex_command_json,
    codex_session_id, pid, exit_code, signal, stdout_log_path, stderr_log_path, events_jsonl_path,
    last_message_path, stdout_tail, stderr_tail, result_summary, findings_count,
    created_schedule_count, created_at, updated_at
    FROM runs";

const RUN_SELECT_ALIASED: &str = "SELECT r.id, r.task_id, r.trigger_type, r.scheduled_for,
    r.attempt, r.status, r.status_reason, r.queued_at, r.started_at, r.ended_at, r.duration_ms,
    r.target_mode, r.workspace_path, r.worktree_path, r.branch_name, r.base_ref,
    r.commit_before, r.commit_after, r.codex_command_json, r.codex_session_id, r.pid,
    r.exit_code, r.signal, r.stdout_log_path, r.stderr_log_path, r.events_jsonl_path,
    r.last_message_path, r.stdout_tail, r.stderr_tail, r.result_summary, r.findings_count,
    r.created_schedule_count, r.created_at, r.updated_at
    FROM runs r";

const TERMINAL_RUN_HISTORY_SUBQUERY: &str = "SELECT id FROM runs
    WHERE ended_at IS NOT NULL
      AND ended_at <= ?
      AND status IN ('succeeded', 'failed', 'canceled', 'skipped', 'interrupted', 'timed_out')
      AND id NOT IN (SELECT run_id FROM schedule_capability_tokens)";

const INSERT_RUN_SQL: &str = "INSERT INTO runs (
    id, task_id, trigger_type, scheduled_for, attempt, status, status_reason, queued_at,
    started_at, ended_at, duration_ms, target_mode, workspace_path, worktree_path, branch_name,
    base_ref, commit_before, commit_after, codex_command_json, codex_session_id, pid, exit_code,
    signal, stdout_log_path, stderr_log_path, events_jsonl_path, last_message_path, stdout_tail,
    stderr_tail, result_summary, findings_count, created_schedule_count, created_at, updated_at
) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?
)";

const INSERT_RUN_ON_IDEMPOTENCY_CONFLICT_SQL: &str = "INSERT INTO runs (
    id, task_id, trigger_type, scheduled_for, attempt, status, status_reason, queued_at,
    started_at, ended_at, duration_ms, target_mode, workspace_path, worktree_path, branch_name,
    base_ref, commit_before, commit_after, codex_command_json, codex_session_id, pid, exit_code,
    signal, stdout_log_path, stderr_log_path, events_jsonl_path, last_message_path, stdout_tail,
    stderr_tail, result_summary, findings_count, created_schedule_count, created_at, updated_at
) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?
) ON CONFLICT(task_id, scheduled_for, attempt) DO NOTHING";

fn bind_run<'q>(
    query: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    run: &'q Run,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    query
        .bind(&run.id)
        .bind(&run.task_id)
        .bind(run.trigger_type)
        .bind(&run.scheduled_for)
        .bind(run.attempt)
        .bind(run.status)
        .bind(&run.status_reason)
        .bind(&run.queued_at)
        .bind(&run.started_at)
        .bind(&run.ended_at)
        .bind(run.duration_ms)
        .bind(run.target_mode)
        .bind(&run.workspace_path)
        .bind(&run.worktree_path)
        .bind(&run.branch_name)
        .bind(&run.base_ref)
        .bind(&run.commit_before)
        .bind(&run.commit_after)
        .bind(&run.codex_command_json)
        .bind(&run.codex_session_id)
        .bind(run.pid)
        .bind(run.exit_code)
        .bind(&run.signal)
        .bind(&run.stdout_log_path)
        .bind(&run.stderr_log_path)
        .bind(&run.events_jsonl_path)
        .bind(&run.last_message_path)
        .bind(&run.stdout_tail)
        .bind(&run.stderr_tail)
        .bind(&run.result_summary)
        .bind(run.findings_count)
        .bind(run.created_schedule_count)
        .bind(&run.created_at)
        .bind(&run.updated_at)
}
