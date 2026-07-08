---
title: S001 Tasks Screen
description: Defines the Tasks screen for task listing, filtering, row actions, selected task detail, and task audit inspection.
updated: 2026-07-08
read_when:
  - Changing task list behavior, task filters, selected task detail, task row actions, or task audit display.
  - Verifying task operations such as run now, pause, resume, edit, or delete.
---

# S001 Tasks

Route: `/tasks`

Purpose: Lets users scan, filter, inspect, and operate on scheduled Codex tasks, including prompt, policy, recent runs, and audit context.

Entry points: `Tasks` navigation item, `View tasks` links, Today upcoming rows with `?task=<taskId>`, and post-save redirect from the task wizard.

Exit points: `New task`, row action menu, selected run references, edit dialog, and delete confirmation.

Data dependencies:

- `useTasks(status?)` for the list filtered by status.
- `useRuns()` for last-run summaries.
- `useTask(taskId)` for selected detail.
- `useTaskAudits(taskId)` for audit log.
- Task row actions call `task_run_now`, `task_pause`, `task_resume`, and `task_delete`.

Layout regions:

- Header with status filter and `New task` action.
- Task list section with count summary.
- Rows with task name, target badge, full-access warning, description or target detail, schedule, status, next run, and last run.
- Selected task detail below the list when `task` query parameter is present.
- Edit task dialog containing the task wizard.

Fields and controls:

- Status filter: `All statuses`, `Active`, `Paused`, `Completed`, and `Deleted`.
- Row primary action: `Run now`.
- Row menu actions: pause or resume, edit, delete.
- Delete confirmation: preserves run history and removes task from active schedules.
- Task detail actions mirror row actions and expose copy buttons for prompt and paths.

States:

- Loading route fallback: `Loading tasks...`.
- Empty list: `No tasks yet` with `New task`.
- Selected task loading: inline loading panel.
- Selected task populated: summary, prompt, schedule and target, execution and safety, recent runs, audit log.
- Full filesystem access: warning badge appears in rows and detail.

Validation and errors:

- Mutations use toast feedback for success and failure.
- Delete is guarded by confirmation dialog.

Accessibility:

- Row menu uses `role="menu"` and focuses the first enabled menu item when opened.
- Menu trigger has `aria-haspopup`, `aria-expanded`, and task-specific label.
- Delete confirmation has explicit cancel and destructive action labels.

Security and safety:

- `danger-full-access` tasks must show a `Full access` warning badge.
- Audit events show actor, action, timestamp, and optional before/after JSON details.

Acceptance criteria:

- Given a status filter, only tasks matching that status are requested from the IPC layer.
- Given `?task=<id>`, the selected row is visually marked and the detail section loads that task.
- Given `Run now` succeeds, the app invalidates scheduler data and shows a `Run queued` toast.
- Given delete is confirmed, run history remains discoverable through Runs.

Known gaps:

- Task detail recent runs table is informational and does not link each run row to `/runs?run=<runId>`.
