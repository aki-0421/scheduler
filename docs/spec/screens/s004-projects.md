---
title: S004 Projects Screen
description: Defines the Projects screen for trusting and untrusting local folders or Git repositories used by scheduled Codex runs.
updated: 2026-07-08
read_when:
  - Changing project trust management, trusted path display, untrust confirmation, or repository path safety behavior.
  - Verifying local project trust and active task impact behavior.
---

# S004 Projects

Route: `/projects`

Purpose: Lets users explicitly trust and untrust local folders or Git repositories before repository-backed scheduled runs can execute.

Entry points: `Projects` navigation item and task wizard trust guidance.

Exit points: trusted path list, inline empty-state focus action, and untrust confirmation.

Data dependencies:

- `useProjects()` for trusted path records.
- `useTasks()` for active task counts affected by trust changes.
- `useTrustProject()` and `useUntrustProject()` for mutations.

Layout regions:

- Header with page purpose.
- Trust project path form.
- Trusted paths table or empty state.
- Remove-trust confirmation dialog.

Fields and controls:

- Project path input with placeholder `/Users/alice/src/my-app`.
- `Trust path` submit button.
- Table columns: project, path, trust, active tasks, default branch, actions.
- `Remove trust` action is disabled when the project is already untrusted or mutation is pending.

States:

- Empty input submit shows `Enter a project path.` toast and focuses the path input.
- Empty project list shows `No trusted projects` and focuses the path input when action is used.
- Trusted and untrusted badges show trust status and timestamp or `Not trusted`.
- Remove-trust success toast includes affected active task count.

Validation and errors:

- Path must be non-empty after trimming before trust mutation.
- Trust and untrust failures show error toasts with available details.
- Untrust requires confirmation and explains active tasks may fail until trust is restored or tasks move.

Accessibility:

- Path input has `aria-label="Project path"`.
- Remove-trust buttons include project-specific `aria-label`.
- Confirmation dialog has clear cancel and destructive actions.

Security and safety:

- Trust is explicit and local-path based.
- Removing trust does not delete local files or run history.
- Active task impact is calculated and shown before untrust.

Acceptance criteria:

- Given a blank path, the trust mutation is not sent and focus returns to the input.
- Given a successful trust, the input clears and project list refreshes.
- Given untrust is confirmed, affected active task count appears in the success toast.
- Given a project has active tasks, the confirmation describes the failure risk.

Known gaps:

- The Projects page accepts typed paths; folder picking is only exposed in the task wizard.
