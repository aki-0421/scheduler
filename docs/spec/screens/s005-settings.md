---
title: S005 Settings Screen
description: Defines the Settings screen for scheduler switches, execution defaults, permission defaults, diagnostics, local paths, and schema visibility.
updated: 2026-07-08
read_when:
  - Changing settings fields, default execution configuration, permission defaults, diagnostics export, or settings save behavior.
  - Verifying scheduler settings, diagnostics export, schema display, or settings error handling.
---

# S005 Settings

Route: `/settings`

Purpose: Configures global scheduler behavior, desktop notifications, Codex execution defaults, permission defaults, local diagnostics, and schema visibility.

Entry points: `Settings` navigation item.

Exit points: save settings action and diagnostics export.

Data dependencies:

- `useSettings()` with frontend defaults for the settings form.
- `useHealth()` for schema version.
- `useSetSetting()` for saving each setting.
- `ipcClient.diagnosticsExport()` for support bundle export.

Layout regions:

- Header with settings purpose.
- General section.
- Execution section.
- Permissions section.
- Diagnostics section.
- Sticky save bar at the bottom.

Fields and controls:

- Scheduler switch controls `scheduler.enabled`.
- Notifications switch controls `notifications.enabled`.
- Global concurrency number input controls `daemon.global_concurrency`.
- Codex path input controls `runner.codex_path`.
- Default model input controls `runner.default_model`.
- Default sandbox select controls `runner.default_sandbox_mode`.
- Default approval policy select controls `runner.default_approval_policy`.
- Worktree cleanup select controls `worktree.default_cleanup_policy`.
- Read-only socket path and database path.
- Schema version display.
- Export diagnostics button.
- Save settings button.

States:

- Form initializes from settings query data and resets when query data changes.
- Save button is disabled while settings mutation is pending.
- Export diagnostics button is disabled while export is pending.
- Diagnostics export canceled shows info toast; success shows exported path.
- Unknown schema version displays `Unknown`.

Validation and errors:

- Global concurrency has input minimum `1`.
- Save sends all known settings keys and shows one success toast when all mutations finish.
- Save failure shows settings error toast and query rollback uses previous settings data.
- Diagnostics failure shows diagnostics error toast.

Accessibility:

- Each editable setting has a label and description.
- Read-only local paths are displayed in truncated monospace code blocks.
- Sticky save action remains reachable at the bottom of long settings pages.

Security and safety:

- Permission defaults are grouped separately from general settings.
- Diagnostic export is user-initiated and writes to a local file.
- Socket and database paths are read-only display values.

Acceptance criteria:

- Given a setting changes and Save settings succeeds, the user sees `Settings saved`.
- Given any setting save fails, the user sees an error toast and previous cached settings are restored.
- Given diagnostics export returns a path, the path appears in the success toast.
- Given diagnostics export is canceled, the user sees a cancellation info toast.

Known gaps:

- Some settings shown by the frontend are defaults even when not seeded by the initial migration.
