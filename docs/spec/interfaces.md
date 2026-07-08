---
title: インターフェース
description: 実装済み desktop UI、Tauri command、daemon JSON-RPC、codex-schedule CLI interface を定義する。
updated: 2026-07-08
read_when:
  - UI page、IPC schema、Tauri command、daemon RPC method、codex-schedule behavior を変更するとき。
  - Codex Scheduler と通信する automation を書くとき。
---

# インターフェース

Codex Scheduler には 3 つの public interface layer がある。desktop UI、local daemon JSON-RPC API、`codex-schedule` CLI である。Tauri command layer は UI を daemon RPC に接続する。

## Desktop UI

frontend は daemon data を受け入れる前に typed IPC helper と Zod schema を使う。

実装済み navigation:

- `Projects`
- sidebar scheduled task list
- `Archived`
- bottom toolbox `Settings`

`/` は dashboard を表示せず `/projects` に redirect する。sidebar は project entry、next-run order の task entry、archived task entry、bottom toolbox を持つ。header は scheduler badge と scheduler toggle を表示せず、running / queued を icon + number で表示する。

task creation、editing、duplication は wizard で扱う。field は prompt、name、description、schedule、target、project selection、base ref、model、reasoning effort、sandbox、approval policy、schedule CLI permission、max runtime、retry count、missed-run policy、overlap policy、cleanup policy、lock state を含む。cron preview は immediate user feedback のため frontend で計算される。

危険な full-filesystem access は task wizard で明示的な confirmation を必要とし、task list では warning badge として表示される。

task detail は `/tasks?task=<taskId>` で開き、session history、prompt、settings、audit log を tab で表示する。session row は `/runs?run=<runId>` に遷移し、run detail は chat UI で prompt、assistant output、tool usage、daemon event を表示する。

## Tauri Commands

desktop backend は次の command を frontend に公開する。

- Daemon: `daemon_health`, `daemon_diagnostics`, `daemon_tick_now`, `diagnostics_export`
- Tasks: `task_list`, `task_get`, `task_create`, `task_update`, `task_duplicate`, `task_delete`, `task_pause`, `task_resume`, `task_lock`, `task_unlock`, `task_run_now`, `task_audit_list`
- Runs: `run_list`, `run_get`, `run_cancel`, `run_tail_log`, `export_run_logs`
- Projects: `project_list`, `project_add`, `project_update`, `project_remove`, `project_pick_folder`
- Settings: `settings_get`, `settings_set`
- Utilities: `prompt_import_file`, `open_path`

ほとんどの command は daemon JSON-RPC に proxy する。file import / export と path opening は desktop API または local path policy を必要とするため、Tauri backend で実装される。

## Daemon JSON-RPC

daemon は Unix domain socket 上で newline-delimited JSON-RPC 2.0 を受け入れる。

実装済み method name:

- `daemon.health`
- `daemon.diagnostics`
- `daemon.tickNow`
- `task.list`
- `task.get`
- `task.create`
- `task.update`
- `task.duplicate`
- `task.delete`
- `task.pause`
- `task.resume`
- `task.lock`
- `task.unlock`
- `task.runNow`
- `task.auditList`
- `run.list`
- `run.get`
- `run.cancel`
- `run.tailLog`
- `project.list`
- `project.add`
- `project.update`
- `project.remove`
- `settings.get`
- `settings.set`

RPC error code は standard JSON-RPC parse / request / method / params / internal value と、task not found、run not found、validation failure、permission denial、conflict、unavailable、canceled の scheduler-specific code を使う。

## CLI

`codex-schedule` は terminal user と scheduled Codex session のための non-interactive CLI である。

実装済み subcommand:

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

global option には `--json`、`--data-dir`、`--db`、`--socket`、`--allow-direct-db` が含まれる。

task field flag には次が含まれる。

- Identity and prompt: `--name`, `--description`, `--prompt`, `--prompt-file`
- Schedule: `--at`, `--cron`, `--timezone`, `--manual`
- Target: `--chat`, `--repo`, `--worktree`, `--local`, `--base-ref`
- Codex: `--model`, `--reasoning-effort`, `--sandbox`, `--approval-policy`
- Scheduler permissions and policy: `--allow-schedule-cli`, `--paused`, `--max-runtime-sec`, `--max-created-schedules`, `--missed-policy`, `--overlap-policy`
- Update clears: `--clear-run-at`, `--clear-cron`, `--clear-description`, `--clear-base-ref`, `--clear-model`, `--clear-reasoning-effort`

`--json` は machine-readable command result を返す。human output は concise で terminal-oriented のままにする。

## CLI Direct-Database Fallback

read-style CLI action は daemon が unavailable のとき SQLite に fallback できる。write は、ユーザーが `--allow-direct-db` または direct DB environment flag で明示的に direct DB access に opt in しない限り daemon を必要とする。

scheduled-run write は direct DB fallback を使えない。scheduled Codex session は token を持ち、daemon に到達する必要がある。これにより capability check と audit behavior を centralized に保つ。

locked task に対する `task.update`、`task.delete`、`task.pause`、`task.resume` は scheduled-run actor から拒否される。`task.lock` と `task.unlock` は user actor のみが実行できる。

## Scheduled-Run CLI Authorization

scheduled Codex session は次を使う。

- `CODEX_SCHEDULER=1`
- `CODEX_SCHEDULER_CURRENT_TASK_ID`
- `CODEX_SCHEDULER_CURRENT_RUN_ID`
- `CODEX_SCHEDULER_RUN_TOKEN`
- `CODEX_SCHEDULER_SOCKET`

token-backed session は capability list と create-count limit で許可された action だけを実行できる。project add / update / remove と settings write は scheduled session では denied される。
