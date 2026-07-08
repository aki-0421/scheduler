---
title: S002 Task Wizard Screen
description: Defines the task creation, follow-up, and edit wizard for prompt, target, schedule, execution, safety, and scheduler permissions.
updated: 2026-07-08
read_when:
  - Changing task creation, task editing, follow-up task prefill, wizard validation, cron preview, target trust, or advanced task policies.
  - Verifying task wizard fields, defaults, safety confirmations, or save behavior.
---

# S002 Task Wizard

Routes and surfaces: `/tasks/new`, `/tasks/new?prefillFromTask=<taskId>&sourceRun=<runId>`, and edit dialog on `/tasks`.

Purpose: Creates, follows up on, or edits scheduled Codex work with explicit prompt, target, schedule, execution, permission, retry, and cleanup controls.

Entry points: `New task`, follow-up action from run detail, and task edit action.

Exit points:

- Successful create or follow-up redirects to `/tasks?task=<newTaskId>`.
- Successful edit closes the dialog.
- Cancel returns to `/tasks` or closes the edit dialog.

Data dependencies:

- `useTask(prefillFromTask)` for follow-up prefill.
- `useProjects()` for trusted project selection.
- `useTrustProject()` for inline project trust.
- `useCreateTask()` and `useUpdateTask()` for save.
- `ipcClient.projectPickFolder()` for folder picker.
- `ipcClient.promptImportFile()` for prompt import.
- `getCronPreview()` and timezone helpers for schedule preview and validation.

Layout regions:

- Page or dialog header.
- Card header with wizard purpose copy.
- Error summary alert when validation fails.
- Main prompt and identity column.
- Target and schedule side column.
- Advanced settings details panel.
- Footer actions for cancel, save paused, and save active.

Fields and controls:

- Prompt textarea, import prompt button, task name, optional description.
- Target mode: chat workspace, existing repository, or fresh worktree.
- Project selector: trusted project or custom path.
- Repository path, browse button, base ref, and inline trust button for repository targets.
- Schedule selector: manual, once, hourly, daily, weekdays, weekly, or custom cron.
- Once date and time, preset time, weekly day, custom 5-field cron, timezone, and next-five-runs preview.
- Advanced settings: Codex path display, model, reasoning effort, sandbox, approval policy, max runtime, retries, overlap, missed runs, cleanup, schedule CLI switch, scheduler instruction switch, capability checkboxes, max created schedules, and start paused switch.
- Full filesystem access confirmation checkbox appears only for `danger-full-access`.

Defaults:

- Default cron expression is `0 9 * * 1-5`, inferred as weekdays at 09:00.
- Default timezone is the browser-resolved timezone or `Asia/Tokyo`.
- Default model is `gpt-5-codex`.
- Default reasoning effort is `default`.
- Default sandbox is `read-only`.
- Default approval policy is `never`.
- Default max runtime is `7200` seconds.
- Default missed policy is `latest_within_window`.
- Default overlap policy is `skip`.
- Default cleanup is `keep`.
- Schedule CLI is allowed by default with create, update-current, and list capabilities.

Validation and errors:

- Required: prompt, task name, timezone, model, reasoning effort.
- Repository path is required for repository targets.
- Once schedules require valid date and time for the selected timezone.
- Custom cron must be a valid 5-field expression; seconds are rejected.
- Max runtime must be at least 60 seconds.
- Retries cannot be negative.
- Max created schedules must be 1 through 100.
- Full filesystem access requires explicit confirmation.
- Validation failure shows a destructive summary with clickable field links and focuses the first error.

States:

- Follow-up prefill loading shows skeleton content.
- Repository trust state shows `Trusted` or `Not trusted`.
- Existing repository plus workspace-write shows a warning that local changes can be modified.
- Cron preview shows next five runs when valid, once preview for once schedules, manual guidance for manual tasks, or fix-schedule guidance when invalid.
- Advanced panel opens automatically when validation errors belong to advanced fields.

Accessibility:

- Field errors are associated through field components or `aria-invalid`.
- Error summary buttons scroll and focus target fields.
- Switches and checkboxes include labels and descriptions.
- Dangerous access confirmation includes an inline field-level error.

Security and safety:

- Repository tasks surface trust before save.
- `danger-full-access` is not just a dropdown value; it opens a warning and required confirmation.
- Schedule CLI capabilities are explicit and capped by `maxCreatedSchedulesPerRun`.

Acceptance criteria:

- Given an empty prompt or name, saving shows an error summary and focuses the first invalid field.
- Given a repository target without a path, saving is blocked.
- Given `danger-full-access` without confirmation, saving is blocked.
- Given a valid cron schedule, the preview lists the next five runs.
- Given successful create, the user lands on the created task detail.
- Given successful edit, the edit dialog closes and task detail data refreshes.

Known gaps:

- The UI uses explicit schedule controls and cron; natural-language schedule parsing is not implemented.
