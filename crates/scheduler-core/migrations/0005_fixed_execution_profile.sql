ALTER TABLE tasks ADD COLUMN codex_path TEXT;

UPDATE tasks
SET sandbox_mode = 'danger-full-access',
    approval_policy = 'never',
    inject_scheduler_instructions = 1,
    allow_schedule_cli = 1,
    schedule_cli_capabilities = '["schedule:create","schedule:update-current","schedule:update-any","schedule:pause-current","schedule:run-now","schedule:list"]',
    max_created_schedules_per_run = 0,
    missed_policy = 'skip',
    missed_window_days = 0,
    overlap_policy = 'skip',
    max_runtime_sec = 0,
    max_retries = 0,
    retry_backoff_sec = 0,
    cleanup_policy = 'keep',
    cleanup_after_days = NULL;

UPDATE schedule_capability_tokens
SET capabilities_json = '["schedule:create","schedule:update-current","schedule:update-any","schedule:pause-current","schedule:run-now","schedule:list"]',
    max_creates = 0
WHERE revoked_at IS NULL;

UPDATE task_audit_events
SET before_json = json_remove(
    before_json,
    '$.codex.sandboxMode',
    '$.codex.approvalPolicy',
    '$.prompt.injectSchedulerInstructions',
    '$.policies'
)
WHERE before_json IS NOT NULL
  AND json_valid(before_json);

UPDATE task_audit_events
SET after_json = json_remove(
    after_json,
    '$.codex.sandboxMode',
    '$.codex.approvalPolicy',
    '$.prompt.injectSchedulerInstructions',
    '$.policies'
)
WHERE after_json IS NOT NULL
  AND json_valid(after_json);

DELETE FROM settings
WHERE key IN (
    'runner.default_sandbox_mode',
    'runner.default_approval_policy',
    'worktree.default_cleanup_policy'
);

PRAGMA user_version = 5;
