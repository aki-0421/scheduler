---
title: S000 Today Screen
description: Defines the Today dashboard screen for scheduler health, upcoming work, recent activity, and scheduler operations.
updated: 2026-07-08
read_when:
  - Changing the Today dashboard, scheduler health summary, upcoming runs, recent activity, or Today operations.
  - Verifying dashboard behavior for scheduler status, Codex CLI readiness, failures, or review counts.
---

# S000 Today

Route: `/`

Purpose: Gives users a compact operating view of scheduler health, queued work, recent failures, review load, Codex CLI readiness, and maintenance actions.

Entry points: default app route and `Today` navigation item.

Exit points: `View tasks`, upcoming run rows, `View runs`, recent activity rows, `Open diagnostics`, and operation buttons.

Data dependencies:

- `useTasks()` for active task queue, next run sorting, and task names.
- `useRuns()` for running count, failed-last-day count, needs-review count, and recent activity.
- `useHealth()` every 5 seconds for daemon version, scheduler enabled state, and schema health.
- `useDaemonDiagnostics()` every 15 seconds for Codex CLI readiness.
- `useSettings()` for scheduler enabled and Codex path fallback.
- `useDaemonTickNow()` and `useSetSetting()` for operations.

Layout regions:

- Page header with title `Today` and next-run-oriented description.
- Summary chips for scheduler, running now, failed today, needs review, and Codex CLI.
- Upcoming runs list ordered by `nextRunAt`.
- Recent activity list ordered by start or scheduled time.
- Scheduler operations section with due-run check, pause schedules, and diagnostics entry.

Fields and controls:

- `Check due runs` calls the daemon tick command and shows success or error toast.
- `Pause schedules` sets `scheduler.enabled` to `false` and shows success or error toast.
- `Open diagnostics` currently links to `/runs`.

States:

- Empty tasks: show `No tasks yet` with create-first-task action.
- Tasks without next run: show `No upcoming runs` with open-tasks action.
- Empty runs: show `No runs yet` with open-tasks action.
- Codex CLI status is `Ready`, `Missing`, `Not checked`, or `Unavailable`.
- Scheduler status is `On` or `Paused`.

Security and safety:

- Global pause is visible as an operation, not hidden in settings.
- Failed and review counts must not rely on color alone; labels and numeric values are always visible.

Acceptance criteria:

- Given at least one active task with `nextRunAt`, the earliest task appears first in Upcoming runs.
- Given a failed or timed-out run within the last 24 hours, Failed today increments.
- Given a run with failure, timeout, findings, or created schedules, Needs review increments.
- Given the daemon tick command fails, the user sees a failure toast with available error detail.

Known gaps:

- `Open diagnostics` routes to Runs rather than a dedicated diagnostics screen.
- Pause schedules has no matching resume action on Today.
