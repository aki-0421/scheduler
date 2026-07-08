---
title: S003 Runs Screen
description: Defines the Runs screen for run history, triage filters, selected run detail, logs, artifacts, cancellation, retry, and follow-up creation.
updated: 2026-07-08
read_when:
  - Changing run history, run filters, run detail, log tailing, artifact display, retry, cancellation, or follow-up task creation.
  - Verifying run triage behavior, active run polling, or run export flows.
---

# S003 Runs

Route: `/runs`

Purpose: Lets users inspect execution history, triage failures or review-worthy runs, tail logs, export evidence, cancel active runs, retry tasks, and create follow-up tasks.

Entry points: `Runs` navigation item, Today recent activity rows, and `View runs` links.

Exit points: selected run detail, linked follow-up task wizard, task retry, workspace or artifact Finder open, and logs export.

Data dependencies:

- `useTasks()` for task names and follow-up context.
- `useRuns({ status, taskId })` for filtered history.
- `useRun(runId)` for selected detail, refetching active runs every 3 seconds.
- `useCancelRun()` for active run cancellation.
- `useRunTaskNow()` for retry.
- `ipcClient.runTailLog()` for stdout, stderr, and event log polling.
- `ipcClient.exportRunLogs()` and `ipcClient.openPath()` for local file operations.

Layout regions:

- Header with status filter and task filter.
- Run history section with count, preset buttons, and list rows.
- Selected run detail below the list when `run` query parameter is present.
- Detail header with run identity, trigger, status, workspace/follow-up/cancel/retry actions.
- Detail sections for metadata, prompt, output, logs, and artifacts.

Fields and controls:

- Presets: recent, failed, review.
- Status filter: all run statuses.
- Task filter: all tasks or a specific task.
- Detail actions: open workspace, create follow-up task, cancel active run, retry, export logs, copy prompt/output/logs, show artifact in Finder.
- Logs tabs: stdout, stderr, events.

States:

- Loading route fallback: `Loading runs...`.
- Empty filtered list: `No matching runs` with open-tasks action.
- Selected run loading: inline loading panel.
- Review badge appears for failed, timed out, interrupted, findings, or created schedules.
- Active runs poll logs every 3 seconds.
- Missing logs show an availability fallback.
- No output, prompt, events, or artifacts each has an explicit empty state.

Validation and errors:

- Cancel, retry, open path, and export failures use toasts with available error detail.
- Event logs parse JSONL into readable event cards and retain raw event disclosure.

Accessibility:

- Filters and presets are keyboard-reachable controls.
- Status is conveyed by text badges, not color alone.
- Logs are segmented with tabs and copy controls.

Security and safety:

- Finder open actions only use paths returned by run DTOs or artifacts.
- Follow-up task prefill preserves source run context in the task description.

Acceptance criteria:

- Given preset `Failed`, only failed runs are displayed.
- Given preset `Review`, failed, timed-out, interrupted, findings, or created-schedule runs are displayed.
- Given an active run is selected, logs are polled until the run leaves an active status.
- Given cancel succeeds, scheduler data invalidates and the detail refreshes.
- Given export logs succeeds, the user sees the exported local path.

Known gaps:

- Review state is derived; there is no persisted reviewed or archived state.
