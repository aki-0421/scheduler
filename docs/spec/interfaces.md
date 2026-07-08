---
title: Interfaces
description: Defines the implemented desktop UI, Tauri command, daemon JSON-RPC, and codex-schedule CLI interfaces.
updated: 2026-07-08
read_when:
  - Changing UI pages, IPC schemas, Tauri commands, daemon RPC methods, or codex-schedule behavior.
  - Writing automation that talks to Codex Scheduler.
---

# Interfaces

Codex Scheduler has three public interface layers: the desktop UI, the local daemon JSON-RPC API, and the `codex-schedule` CLI. The Tauri command layer connects the UI to daemon RPC.

## Desktop UI

The frontend uses typed IPC helpers and Zod schemas before accepting daemon data.

Implemented navigation:

- `Today`
- `Tasks`
- `Runs`
- `Projects`
- `Settings`

Task creation and editing are handled by a wizard with fields for prompt, name, description, schedule, target, repository path, base ref, model, reasoning effort, sandbox, approval policy, schedule CLI permissions, max runtime, retry count, missed-run policy, overlap policy, and cleanup policy. Cron previews are computed in the frontend for immediate user feedback.

Dangerous full-filesystem access requires explicit confirmation in the task wizard and is shown as a warning badge in task lists.

## Tauri Commands

The desktop backend exposes these commands to the frontend:

- Daemon: `daemon_health`, `daemon_diagnostics`, `daemon_tick_now`, `diagnostics_export`
- Tasks: `task_list`, `task_get`, `task_create`, `task_update`, `task_delete`, `task_pause`, `task_resume`, `task_run_now`, `task_audit_list`
- Runs: `run_list`, `run_get`, `run_cancel`, `run_tail_log`, `export_run_logs`
- Projects: `project_list`, `project_trust`, `project_untrust`, `project_pick_folder`
- Settings: `settings_get`, `settings_set`
- Utilities: `prompt_import_file`, `open_path`

Most commands proxy to daemon JSON-RPC. File import/export and path opening are implemented in the Tauri backend because they require desktop APIs or local path policy.

## Daemon JSON-RPC

The daemon accepts newline-delimited JSON-RPC 2.0 over a Unix domain socket.

Implemented method names:

- `daemon.health`
- `daemon.diagnostics`
- `daemon.tickNow`
- `task.list`
- `task.get`
- `task.create`
- `task.update`
- `task.delete`
- `task.pause`
- `task.resume`
- `task.runNow`
- `task.auditList`
- `run.list`
- `run.get`
- `run.cancel`
- `run.tailLog`
- `project.list`
- `project.trust`
- `project.untrust`
- `settings.get`
- `settings.set`

RPC error codes use standard JSON-RPC parse/request/method/params/internal values plus scheduler-specific codes for task not found, run not found, validation failure, permission denial, conflict, unavailable, and canceled.

## CLI

`codex-schedule` is a non-interactive CLI for terminal users and scheduled Codex sessions.

Implemented subcommands:

- `create`
- `update`
- `update-current`
- `list`
- `show`
- `pause`
- `resume`
- `delete`
- `run-now`
- `history`
- `next`
- `validate-cron`
- `doctor`

Global options include `--json`, `--data-dir`, `--db`, `--socket`, and `--allow-direct-db`.

Task field flags include:

- Identity and prompt: `--name`, `--description`, `--prompt`, `--prompt-file`
- Schedule: `--at`, `--cron`, `--timezone`, `--manual`
- Target: `--chat`, `--repo`, `--worktree`, `--local`, `--base-ref`
- Codex: `--model`, `--reasoning-effort`, `--sandbox`, `--approval-policy`
- Scheduler permissions and policy: `--allow-schedule-cli`, `--paused`, `--max-runtime-sec`, `--max-created-schedules`, `--missed-policy`, `--overlap-policy`
- Update clears: `--clear-run-at`, `--clear-cron`, `--clear-description`, `--clear-base-ref`, `--clear-model`, `--clear-reasoning-effort`

`--json` returns machine-readable command results. Human output remains concise and terminal-oriented.

## CLI Direct-Database Fallback

Read-style CLI actions can fall back to SQLite when the daemon is unavailable. Writes require the daemon unless the user explicitly opts into direct DB access through `--allow-direct-db` or the direct DB environment flag.

Scheduled-run writes cannot use direct DB fallback. A scheduled Codex session must have a token and reach the daemon so capability checks and audit behavior remain centralized.

## Scheduled-Run CLI Authorization

Scheduled Codex sessions use:

- `CODEX_SCHEDULER=1`
- `CODEX_SCHEDULER_CURRENT_TASK_ID`
- `CODEX_SCHEDULER_CURRENT_RUN_ID`
- `CODEX_SCHEDULER_RUN_TOKEN`
- `CODEX_SCHEDULER_SOCKET`

Token-backed sessions can only perform actions allowed by their capability list and create-count limit. Project trust changes and settings writes are denied for scheduled sessions.

