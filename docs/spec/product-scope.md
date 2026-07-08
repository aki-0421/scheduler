---
title: Product Scope
description: Defines the implemented product purpose, users, MVP boundary, and known implementation gaps for Codex Scheduler.
updated: 2026-07-08
read_when:
  - Changing product behavior, navigation, task creation, run history, or scheduler defaults.
  - Checking what the current branch claims as implemented scope.
---

# Product Scope

Codex Scheduler is a macOS-first desktop app for scheduling local Codex CLI work. It is built for users who already run Codex from local project folders and want recurring or delayed work to run with visible state, local logs, and explicit execution policies.

The app must feel like a local automation console for AI work, not a generic admin dashboard. The implemented UI uses compact task-first surfaces for health, upcoming work, failed runs, trusted projects, and execution settings.

## Implemented User Value

The current branch supports these core flows:

- Create, edit, pause, resume, delete, and manually run scheduler tasks.
- Create manual, once, and cron tasks.
- Target either a chat workspace, a trusted repository path directly, or a fresh Git worktree.
- Configure task prompt, timezone, model, reasoning effort, sandbox, approval policy, runtime limit, retry count, missed-run handling, overlap handling, schedule CLI capability scope, and worktree cleanup policy.
- Inspect task lists, task details, run history, run details, log tails, artifacts, audit events, and daemon diagnostics.
- Trust and untrust local folders or Git repositories before repository-backed runs are allowed to execute.
- Use `codex-schedule` from a terminal or scheduled Codex session to manage tasks through the daemon.

## Current Product Shell

The desktop app has these top-level pages:

- `Today`: scheduler health, running count, failed runs in the last day, review count, Codex CLI readiness, next runs, recent activity, and global pause/resume controls.
- `Tasks`: filterable task list, selected task detail, edit dialog, prompt/policy/audit/run inspection, and row actions.
- `Runs`: recent/failed/review presets, status and task filters, selected run detail, prompt/output/log/artifact inspection, and cancel support.
- `Projects`: project trust entry, trusted path list, trust status, active task count, and untrust confirmation.
- `Settings`: scheduler switch, notification switch, global concurrency, Codex path, default model, default sandbox, default approval policy, worktree cleanup default, schema version, fixed local paths, and diagnostics export.

## MVP Boundary

The current implementation is local-only:

- The scheduler daemon runs on the same Mac as the desktop app.
- The scheduler stores state in local SQLite.
- Runs are launched through local `codex exec`.
- Repository tasks require local path trust.
- No cloud execution, multi-user sharing, team permissions, or hosted scheduler is implemented.

The branch also includes sidecar packaging for `codex-schedulerd` and `codex-schedule`, plus release notes for macOS signing and notarization.

## Known Gaps And Constraints

These are visible in the current branch:

- Notifications are implemented as failure/timeout desktop notifications, not a complete event notification matrix.
- Run triage state is derived from failed/timed-out/interrupted statuses, findings count, and created schedule count. There is no persisted reviewed/archive state.
- Natural-language schedule parsing is not implemented; the UI uses presets plus explicit dates and 5-field cron.
- The desktop Settings page exposes some default keys that are not all seeded by the initial SQL migration. The frontend supplies defaults until the daemon returns stored values.
- The legacy `docs/RELEASE.md` is not yet an `agent-docs` managed document because it lacks front matter. This rewrite does not change it.

