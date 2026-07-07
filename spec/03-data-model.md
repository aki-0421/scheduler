# データモデル仕様

## 1. 概要

永続化は SQLite を使用する。日時は DB 内では原則 UTC の RFC3339 文字列または INTEGER epoch milliseconds として保存し、schedule の timezone は別 field に IANA timezone name で保存する。

## 2. 主な enum

```text
task_kind:        manual | once | cron
task_status:      active | paused | completed | deleted
schedule_status:  valid | invalid
trigger_type:     schedule | manual | cli | catchup | retry
run_status:       queued | starting | running | succeeded | failed | canceled | skipped | interrupted | timed_out
run_target_mode:  chat | repo-local | repo-worktree
sandbox_mode:     read-only | workspace-write | danger-full-access
approval_policy:  never | on-request | untrusted
missed_policy:    skip | latest_within_window | run_all_capped
overlap_policy:   skip | queue | cancel_previous
cleanup_policy:   keep | delete_on_success | delete_after_days
```

## 3. ER 概要

```text
projects 1 ── * tasks 1 ── * runs 1 ── * run_events
                      │             │
                      │             └── * run_artifacts
                      │
                      └── * task_audit_events

runs * ── 0..1 schedule_capability_tokens
```

## 4. Tables

### 4.1 `projects`

Git リポジトリまたは作業フォルダを表す。

```sql
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
```

### 4.2 `tasks`

スケジュール可能なタスク本体。

```sql
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
```

制約:

- `kind='once'` の場合 `run_at` は必須。
- `kind='cron'` の場合 `cron_expr` は必須。
- `target_mode != 'chat'` の場合 `project_id` または `repo_path` は必須。
- `target_mode='repo-worktree'` の場合 `kind='git'` project のみ許可。

### 4.3 `runs`

各実行インスタンス。

```sql
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
```

### 4.4 `run_events`

Codex CLI の JSONL event、daemon event、scheduler event を統合保存する。

```sql
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
```

### 4.5 `run_artifacts`

実行で生成された成果物。

```sql
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
```

### 4.6 `task_audit_events`

ユーザー、CLI、Codex run によるタスク変更履歴。

```sql
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
```

### 4.7 `schedule_capability_tokens`

scheduled run 内 CLI の権限 token。token 本文は保存せず hash のみ保存する。

```sql
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
```

### 4.8 `settings`

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

主な key:

```text
scheduler.enabled
daemon.global_concurrency
runner.codex_path
runner.default_model
runner.default_sandbox_mode
runner.default_approval_policy
ui.menu_bar_mode
macos.launch_at_login
notifications.enabled
worktree.root
worktree.default_cleanup_policy
```

## 5. Task JSON schema

CLI と UI はこの形を共通 DTO とする。

```json
{
  "id": "task_01J...",
  "slug": "daily-pr-review",
  "name": "Daily PR Review",
  "status": "active",
  "kind": "cron",
  "cronExpr": "0 9 * * 1-5",
  "timezone": "Asia/Tokyo",
  "nextRunAt": "2026-07-08T00:00:00Z",
  "target": {
    "mode": "repo-worktree",
    "projectId": "proj_01J...",
    "repoPath": "/Users/alice/src/my-app",
    "baseRef": "main"
  },
  "codex": {
    "model": "gpt-5-codex",
    "reasoningEffort": "default",
    "sandboxMode": "workspace-write",
    "approvalPolicy": "never"
  },
  "prompt": {
    "body": "Review yesterday's merged PRs and summarize risks.",
    "injectSchedulerInstructions": true
  },
  "policies": {
    "allowScheduleCli": true,
    "missedPolicy": "latest_within_window",
    "overlapPolicy": "skip",
    "maxRuntimeSec": 7200
  }
}
```

## 6. Run JSON schema

```json
{
  "id": "run_01J...",
  "taskId": "task_01J...",
  "triggerType": "schedule",
  "scheduledFor": "2026-07-08T00:00:00Z",
  "status": "succeeded",
  "startedAt": "2026-07-08T00:00:03Z",
  "endedAt": "2026-07-08T00:03:42Z",
  "workspacePath": "/Users/alice/Library/Application Support/Codex Scheduler/worktrees/daily-pr-review/run_01J...",
  "exitCode": 0,
  "resultSummary": "No critical issues found. 2 minor documentation suggestions.",
  "findingsCount": 2,
  "createdScheduleCount": 1
}
```

## 7. Indexes

```sql
CREATE INDEX idx_tasks_status_next_run ON tasks(status, next_run_at);
CREATE INDEX idx_runs_task_started ON runs(task_id, started_at DESC);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_audit_task_created ON task_audit_events(task_id, created_at DESC);
CREATE INDEX idx_events_run_index ON run_events(run_id, event_index);
```

## 8. Migration 方針

- schema version は `PRAGMA user_version` または `schema_migrations` table で管理する。
- migration は forward-only。
- downgrade はサポートしない。
- migration 前に DB backup を `backups/` に作成する。

## 9. Data retention

初期値:

- run history: 90 日保持。
- succeeded run logs: 30 日保持。
- failed run logs: 180 日保持。
- worktree: `keep` が初期値。ユーザーが cleanup を明示するまで削除しない。
- capability token: expires_at から 24 時間後に物理削除。
