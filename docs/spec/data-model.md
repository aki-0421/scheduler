---
title: Data Model
description: Defines the current SQLite entities, DTO contracts, enums, settings, and retention records for Codex Scheduler.
updated: 2026-07-08
read_when:
  - Changing migrations, scheduler-core models, IPC DTOs, frontend schemas, settings, or retention behavior.
  - Debugging persisted task, run, project, audit, or token state.
---

# Data Model

The schema version is `1`. SQLite stores textual enum values with database constraints, and Rust/TypeScript expose the same values through strongly validated DTOs and Zod schemas.

## Primary Entities

`projects` records local folders or Git repositories that the scheduler may use. A project includes a stable ID, display name, canonical path, `git` or `folder` kind, optional Git root, optional remote URL, optional default branch, trust timestamp, and timestamps.

`tasks` records scheduled work. A task stores identity, schedule kind and state, prompt, target, Codex configuration, scheduler CLI permissions, missed/overlap/retry/runtime/cleanup policies, creator metadata, and soft-delete metadata.

`runs` records one execution attempt. A run stores task ID, trigger type, scheduled time, attempt number, status, queue/start/end timestamps, duration, target mode, workspace/worktree/branch/base information, Git snapshots, command metadata, process metadata, log paths, output tails, summary, findings count, created schedule count, and timestamps.

`run_events` records structured progress events from the daemon, Codex JSONL stdout, stdout, and stderr. Each event is ordered by `event_index` within a run.

`run_artifacts` records files, diffs, patches, logs, last messages, and worktrees produced or referenced by a run.

`task_audit_events` records task and project mutations with actor type, action, optional before/after JSON, reason, and timestamp.

`schedule_capability_tokens` records hashed run-scoped tokens that allow scheduled Codex sessions to create or update schedules within a bounded capability set and create count.

`settings` stores JSON values by key.

## Task Contract

Task DTOs use camelCase fields:

- `id`, `slug`, `name`, `description`, `status`
- `kind`: `manual`, `once`, or `cron`
- `cronExpr`, `runAt`, `timezone`, `nextRunAt`
- `target`: target mode, project ID, repository path, and base ref
- `codex`: model, reasoning effort, sandbox mode, approval policy
- `prompt`: prompt body and scheduler-instruction injection flag
- `policies`: schedule CLI access, missed-run policy, overlap policy, runtime limit, create limit, capability list, retry settings, and cleanup settings

When a DTO becomes a stored task, empty IDs are replaced with generated task IDs, prompt hashes are computed from the prompt body, and omitted policy fields receive implementation defaults:

- schedule capabilities: `schedule:create`, `schedule:update-current`, `schedule:list`
- max created schedules per run: `5`, clamped to `1..=100`
- missed window: `7` days
- retries: `0`
- retry backoff: `300` seconds
- cleanup policy: `keep`

## Run Contract

Run DTOs expose the run lifecycle and inspection data used by the UI:

- trigger, schedule, attempt, status, status reason
- queue/start/end timestamps and duration
- target/workspace/worktree/branch/base data
- process exit code, signal, and Codex session ID
- stdout/stderr/events/last-message paths
- stdout/stderr tails and result summary
- findings and created-schedule counters
- artifact list when loading a single run

Run history is sortable by start, schedule, or queue timestamps. Active statuses are `queued`, `starting`, and `running`; terminal statuses include `succeeded`, `failed`, `canceled`, `skipped`, `interrupted`, and `timed_out`.

## Enums

The shared enum vocabulary is:

- Task kinds: `manual`, `once`, `cron`
- Task statuses: `active`, `paused`, `completed`, `deleted`
- Schedule statuses: `valid`, `invalid`
- Trigger types: `schedule`, `manual`, `cli`, `catchup`, `retry`
- Run statuses: `queued`, `starting`, `running`, `succeeded`, `failed`, `canceled`, `skipped`, `interrupted`, `timed_out`
- Target modes: `chat`, `repo-local`, `repo-worktree`
- Sandbox modes: `read-only`, `workspace-write`, `danger-full-access`
- Approval policies: `never`, `on-request`, `untrusted`
- Missed-run policies: `skip`, `latest_within_window`, `run_all_capped`
- Overlap policies: `skip`, `queue`, `cancel_previous`
- Cleanup policies: `keep`, `delete_on_success`, `delete_after_days`
- Project kinds: `git`, `folder`
- Run event sources: `daemon`, `codex-jsonl`, `stdout`, `stderr`
- Run artifact kinds: `file`, `diff`, `patch`, `log`, `last-message`, `worktree`
- Audit actor types: `user`, `daemon`, `cli`, `scheduled-run`

## Settings

The Rust settings module defines these persisted keys:

- `scheduler.enabled`
- `runner.codex_path`
- `retention.run_history_days`
- `retention.succeeded_run_logs_days`
- `retention.failed_run_logs_days`
- `retention.capability_token_delete_after_hours`

The migration seeds retention settings and `worktree.default_cleanup_policy`. The frontend also understands defaults for `daemon.global_concurrency`, `runner.default_model`, `runner.default_sandbox_mode`, `runner.default_approval_policy`, `notifications.enabled`, and `worktree.default_cleanup_policy`.

## Retention Defaults

The implemented retention defaults are:

- Run history: `90` days.
- Succeeded run logs: `30` days.
- Failed run logs: `180` days.
- Expired capability token deletion: `24` hours.
- Worktree cleanup default: `keep`.

