CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('git', 'folder')),
  git_root TEXT,
  git_remote_url TEXT,
  default_branch TEXT,
  trusted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,

  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'deleted')),
  kind TEXT NOT NULL CHECK (kind IN ('manual', 'once', 'cron')),

  cron_expr TEXT,
  run_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  next_run_at TEXT,
  last_scheduled_for TEXT,
  schedule_status TEXT NOT NULL DEFAULT 'valid',
  schedule_error TEXT,

  prompt_body TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  inject_scheduler_instructions INTEGER NOT NULL DEFAULT 1,

  target_mode TEXT NOT NULL CHECK (target_mode IN ('chat', 'repo-local', 'repo-worktree')),
  project_id TEXT REFERENCES projects(id),
  repo_path TEXT,
  base_ref TEXT,

  model TEXT,
  reasoning_effort TEXT,
  sandbox_mode TEXT NOT NULL DEFAULT 'read-only',
  approval_policy TEXT NOT NULL DEFAULT 'never',

  allow_schedule_cli INTEGER NOT NULL DEFAULT 1,
  schedule_cli_capabilities TEXT NOT NULL DEFAULT '["schedule:create","schedule:update-current","schedule:list"]',
  max_created_schedules_per_run INTEGER NOT NULL DEFAULT 5,

  missed_policy TEXT NOT NULL DEFAULT 'latest_within_window',
  missed_window_days INTEGER NOT NULL DEFAULT 7,
  overlap_policy TEXT NOT NULL DEFAULT 'skip',
  max_runtime_sec INTEGER NOT NULL DEFAULT 7200,
  max_retries INTEGER NOT NULL DEFAULT 0,
  retry_backoff_sec INTEGER NOT NULL DEFAULT 300,
  cleanup_policy TEXT NOT NULL DEFAULT 'keep',
  cleanup_after_days INTEGER,

  created_by TEXT NOT NULL DEFAULT 'user',
  created_by_run_id TEXT REFERENCES runs(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  trigger_type TEXT NOT NULL,
  scheduled_for TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,

  status TEXT NOT NULL,
  status_reason TEXT,

  queued_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  duration_ms INTEGER,

  target_mode TEXT NOT NULL,
  workspace_path TEXT,
  worktree_path TEXT,
  branch_name TEXT,
  base_ref TEXT,
  commit_before TEXT,
  commit_after TEXT,

  codex_command_json TEXT NOT NULL,
  codex_session_id TEXT,
  pid INTEGER,
  exit_code INTEGER,
  signal TEXT,

  stdout_log_path TEXT,
  stderr_log_path TEXT,
  events_jsonl_path TEXT,
  last_message_path TEXT,
  stdout_tail TEXT,
  stderr_tail TEXT,

  result_summary TEXT,
  findings_count INTEGER DEFAULT 0,
  created_schedule_count INTEGER DEFAULT 0,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  UNIQUE(task_id, scheduled_for, attempt)
);

CREATE TABLE run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  event_index INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('daemon', 'codex-jsonl', 'stdout', 'stderr')),
  level TEXT NOT NULL DEFAULT 'info',
  event_type TEXT NOT NULL,
  message TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,

  UNIQUE(run_id, event_index)
);

CREATE TABLE run_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  kind TEXT NOT NULL CHECK (kind IN ('file', 'diff', 'patch', 'log', 'last-message', 'worktree')),
  path TEXT NOT NULL,
  title TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE task_audit_events (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'daemon', 'cli', 'scheduled-run')),
  actor_id TEXT,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE schedule_capability_tokens (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  token_hash TEXT NOT NULL UNIQUE,
  capabilities_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  max_creates INTEGER NOT NULL DEFAULT 5,
  create_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_tasks_status_next_run ON tasks(status, next_run_at);
CREATE INDEX idx_runs_task_started ON runs(task_id, started_at DESC);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_audit_task_created ON task_audit_events(task_id, created_at DESC);
CREATE INDEX idx_events_run_index ON run_events(run_id, event_index);

INSERT INTO settings (key, value_json, updated_at) VALUES
  ('retention.run_history_days', '90', '1970-01-01T00:00:00Z'),
  ('retention.succeeded_run_logs_days', '30', '1970-01-01T00:00:00Z'),
  ('retention.failed_run_logs_days', '180', '1970-01-01T00:00:00Z'),
  ('retention.capability_token_delete_after_hours', '24', '1970-01-01T00:00:00Z'),
  ('worktree.default_cleanup_policy', '"keep"', '1970-01-01T00:00:00Z');

PRAGMA user_version = 1;
