---
title: S001 Tasks
description: Tasks screen の list、filter、detail、row action、audit requirement を定義する。
updated: 2026-07-08
read_when:
  - Tasks page、task list、task detail、task action、edit dialog、audit display を変更するとき。
---

# S001 Tasks

ルート: `/tasks`

目的: scheduled Codex task を scan、filter、inspect、operate できるようにする。prompt、policy、recent run、audit context を含む。

入口: `Tasks` navigation item、`View tasks` link、`?task=<taskId>` を持つ Today upcoming row、task wizard からの post-save redirect。

出口: `New task`、row action menu、selected run reference、edit dialog、delete confirmation。

データ依存:

- status で filter された list には `useTasks(status?)` を使う。
- last-run summary には `useRuns()` を使う。
- selected detail には `useTask(taskId)` を使う。
- audit log には `useTaskAudits(taskId)` を使う。
- task row action は `task_run_now`、`task_pause`、`task_resume`、`task_delete` を呼び出す。

レイアウト領域:

- status filter と `New task` action を持つ header。
- count summary を持つ task list section。
- task name、target badge、full-access warning、description または target detail、schedule、status、next run、last run を持つ row。
- `task` query parameter がある場合、list の下に selected task detail を表示する。
- task wizard を含む edit task dialog。

フィールドとコントロール:

- Status filter: `All statuses`、`Active`、`Paused`、`Completed`、`Deleted`。
- Row primary action: `Run now`。
- Row menu actions: pause または resume、edit、delete。
- Delete confirmation: run history を保持し、active schedule から task を削除する。
- Task detail action は row action と同等で、prompt と path の copy button を公開する。

状態:

- Loading route fallback: `Loading tasks...`。
- Empty list: `No tasks yet` と `New task`。
- Selected task loading: inline loading panel。
- Selected task populated: summary、prompt、schedule and target、execution and safety、recent runs、audit log。
- Full filesystem access: row と detail に warning badge が表示される。

バリデーションとエラー:

- mutation は success / failure の toast feedback を使う。
- delete は confirmation dialog で guard される。

アクセシビリティ:

- row menu は `role="menu"` を使い、open 時に最初の enabled menu item に focus する。
- menu trigger は `aria-haspopup`、`aria-expanded`、task-specific label を持つ。
- delete confirmation は明確な cancel label と destructive action label を持つ。

セキュリティと安全性:

- `danger-full-access` task は `Full access` warning badge を表示する必要がある。
- audit event は actor、action、timestamp、任意の before / after JSON detail を表示する。

受け入れ条件:

- status filter がある場合、その status と一致する task だけが IPC layer から request される。
- `?task=<id>` がある場合、selected row が視覚的に mark され、detail section がその task を load する。
- `Run now` が成功した場合、app は scheduler data を invalidate し、`Run queued` toast を表示する。
- delete が confirmed された場合、run history は Runs から引き続き discoverable である。

既知の gap:

- Task detail recent runs table は informational であり、各 run row は `/runs?run=<runId>` に link しない。
