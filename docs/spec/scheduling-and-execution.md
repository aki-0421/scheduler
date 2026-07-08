---
title: Scheduling And Execution
description: Defines schedule calculation, daemon tick behavior, run lifecycle, Codex runner behavior, logs, retries, and cleanup.
updated: 2026-07-08
read_when:
  - Changing cron behavior, missed-run handling, overlap handling, run execution, Codex invocation, logs, retries, or cleanup.
  - Debugging why a task did or did not run.
---

# Scheduling And Execution

The scheduler daemon decides when to enqueue runs. The runner prepares a workspace, invokes Codex, records output, and returns normalized execution status to the daemon.

## Schedule Kinds

`manual` tasks do not receive automatic `nextRunAt` values and only run through explicit run-now actions.

`once` tasks require `runAt`. Their next run is the stored timestamp. After the daemon creates the scheduled run, the task is treated as completed for automatic scheduling purposes.

`cron` tasks require a 5-field cron expression and an IANA timezone. Seconds and year fields are rejected. Common cron syntax such as ranges, steps, and day-of-month/day-of-week OR semantics is supported through the Rust cron parser.

## Timezone And DST Rules

The schedule engine stores and compares instants as UTC RFC3339 timestamps while evaluating cron expressions in the task timezone.

Tested cron behavior includes:

- `* * * * *` can schedule at one-minute granularity.
- Six-field cron expressions are rejected because seconds are not supported.
- Invalid cron values and macro-style expressions such as `@daily` are rejected.
- Spring-forward nonexistent local times roll forward to the next valid instant.
- Fall-back ambiguous local times use the first wall-clock occurrence and skip the repeated wall-clock hour for recurring previews.

## Daemon Tick

The daemon performs an initial tick at startup, then sleeps until the next configured tick interval or an explicit tick notification. The default config aligns around minute-level scheduling, and tests can override the interval. `daemon.tickNow` wakes the scheduler loop for immediate due-run evaluation.

The daemon checks `scheduler.enabled` before queueing scheduled work. Disabled schedulers continue serving RPC requests but do not automatically enqueue due tasks.

## Missed Runs

Cron missed-run handling is policy-driven:

- `skip`: do not enqueue catch-up runs.
- `latest_within_window`: enqueue only the latest eligible missed occurrence within the task window.
- `run_all_capped`: enqueue missed occurrences up to the configured cap.

The implementation protects scans with occurrence limits and computes the following `nextRunAt` after handling missed runs.

## Overlap Handling

When a task is due while a previous run is still active, the overlap policy decides the outcome:

- `skip`: create or record a skipped run with reason `previous_run_still_running`.
- `queue`: allow a later queued run.
- `cancel_previous`: request cancellation for the active run and continue with the next one.

## Retry Handling

The scheduler can create retry attempts for transient failures when the task has retries remaining. Retry timing is based on `retry_backoff_sec` and the next attempt number. Permanent failures do not retry.

## Codex Invocation

The runner detects the Codex CLI by configured path or `PATH`, caches capability data by canonical binary path, and verifies both `codex --version` and `codex exec --help`.

The generated command uses `codex exec` with JSON output, no color when supported, a working directory, optional model, optional reasoning effort, sandbox mode, `--output-last-message`, and stdin prompt input. Scheduled runs currently pass `approval_policy="never"` through `--config`; a task value other than `never` is recorded as a warning and overridden for execution. Unsupported critical flags cause a preflight failure rather than a partial unsafe run.

`danger-full-access` requires the run request to set `allow_danger_full_access=true`.

## Workspace Modes

`chat` creates a scheduler-owned chat workspace under app data and does not require a project.

`repo-local` runs directly in a trusted repository path.

`repo-worktree` creates an isolated Git worktree under the scheduler worktree root, selects a base ref from task or project defaults, creates a scheduler branch, captures Git state before and after execution, and applies the task cleanup policy.

Repository modes require trusted roots. Symlink escape attempts under the worktree directory are rejected.

## Prompt Composition

Every run prompt contains scheduler metadata and the user task instructions. Scheduler CLI instructions are injected only when all of these are true:

- the task allows scheduler instruction injection,
- the task allows schedule CLI access,
- a run-scoped token is available.

The injected instructions are capability-sensitive. For example, when a run only has `schedule:update-current`, the prompt describes update-current usage and omits schedule creation examples. The injection event is also persisted to the run events JSONL file.

## Run Environment

The runner adds scheduler environment variables such as current task ID, current run ID, socket path, timezone, app version, and run token. It prepends the app CLI directory to `PATH` when available so `codex-schedule` can be found from scheduled Codex sessions.

Redacted environment JSON preserves non-secret scheduler identifiers and masks tokens, API keys, passwords, and similar secrets.

## Logs And Results

Each run records:

- full stdout log,
- full stderr log,
- valid Codex JSONL events extracted from stdout,
- last-message file,
- command JSON,
- redacted environment JSON,
- stdout and stderr tails,
- optional Codex session ID,
- optional summary truncated to 2,000 characters,
- artifacts persisted from runner output.

Non-JSON stdout lines are kept in stdout logs but excluded from `events.jsonl`; the run receives an `invalid_stdout_jsonl` warning.

## Cancellation And Timeout

The runner starts Codex in a process group. Cancellation and timeout terminate the group. Timeouts become `timed_out`; cancellations become `canceled`.

## Cleanup

Retention cleanup runs after an initial delay and then hourly. It removes expired capability tokens, old terminal run history, old logs according to success/failure retention windows, and eligible `delete_after_days` worktrees.

Worktree cleanup refuses to delete dirty worktrees. `delete_on_success` cleanup removes successful isolated worktrees immediately after a successful run while preserving the created branch.
