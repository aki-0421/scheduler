---
title: S001 Tasks
description: Tasks screen の archived list、task detail、task run history、tabbed operations、lock behavior を定義する。
updated: 2026-07-09
read_when:
  - Tasks page、archived task list、task detail、task action、edit dialog、duplicate flow、lock behavior、audit display を変更するとき。
---

# S001 Tasks

ルート: `/tasks`、`/tasks?task=<taskId>`、`/tasks?view=archived`

目的: sidebar から選択された scheduled Codex task の履歴と操作を inspect できるようにし、active sidebar から外れた task を archive として確認できるようにする。

入口: sidebar task item、sidebar `アーカイブ済み` item、task wizard からの post-save redirect、task session の task link。

出口: `New task`、task edit、task duplicate、lock / unlock、session row、delete confirmation。

データ依存:

- archived list と sidebar ordering には `useTasks()` と `useRuns()` を使う。
- selected task detail には `useTask(taskId)` を使う。
- selected task history には `useRuns({ taskId })` を使い、newest-first で表示する。
- audit log には `useTaskAudits(taskId)` を使う。
- task action は `task_run_now`、`task_pause`、`task_resume`、`task_delete`、`task_update`、lock / unlock mutation を呼び出す。

レイアウト領域:

- `/tasks?view=archived`: archived task list。completed one-shot、paused / stopped、deleted task を execution newest-first で表示する。
- `/tasks?task=<taskId>`: task detail page。`概要`、`実行履歴`、`プロンプト`、`設定`、`監査ログ`、`操作` の tabs で 1 機能ずつ表示する。常時表示の right action panel は置かない。
- header の文脈説明は title 右の `?` tooltip に置く。subtitle として常時表示しない。list section には title と同義の補足説明文や count 説明文を置かない。
- detail header: task name、status、lock state、target、next run。
- tabs: `概要`、`実行履歴`、`プロンプト`、`設定`、`監査ログ`、`操作`。タスク操作は `操作` tab に集約する。
- tab content の先頭には、tab label を繰り返すだけの section heading や説明文を置かない。
- run history row は status、trigger、scheduled/start time、duration、result summary を表示し、押すと `/runs?run=<runId>` へ遷移する。
- edit / duplicate flow は right column action から開始する。

フィールドとコントロール:

- Archived sort: 実行の新しい順。実行がない archived task は updatedAt または createdAt の新しい順で末尾に置く。
- Detail actions: `操作` tab 内の run now、pause / resume、edit、duplicate、lock / unlock、delete。
- Lock: locked task は AI / scheduled-run actor からの edit、delete、pause、resume を拒否する。user actor は unlock 後に変更できる。
- Delete confirmation: run history を保持し、active schedule から task を削除する。
- Prompt and path copy buttons は tab content 内に置く。

状態:

- Loading route fallback: `Loading tasks...`。
- Empty archived list: `アーカイブ済みタスクはありません` と active task creation action。
- Selected task loading: page skeleton。
- Selected task populated: summary、session history、prompt、settings、audit log、actions を tabs で切り替える。
- Full filesystem access: row と detail に warning badge が表示される。
- Locked task: lock badge、edit / delete disabled state、unlock action を表示する。

バリデーションとエラー:

- mutation は success / failure の toast feedback を使う。
- delete は confirmation dialog で guard される。
- locked task を編集または削除しようとした場合、UI は action を disabled にし、backend から denial が返った場合は lock reason を toast で表示する。

アクセシビリティ:

- tablist は keyboard navigation を持つ。
- run history row は task-session link として識別できる accessible name を持つ。
- `操作` tab の actions は task-specific label を持つ。
- delete confirmation は明確な cancel label と destructive action label を持つ。

セキュリティと安全性:

- `danger-full-access` task は `Full access` warning badge を表示する必要がある。
- locked task は scheduled Codex session と CLI actor による destructive / mutating action を拒否する。lock / unlock は audit event に記録する。
- audit event は actor、action、timestamp、任意の before / after JSON detail を表示する。

受け入れ条件:

- sidebar task item を押すと `/tasks?task=<taskId>` が開き、その task の session history が表示される。
- recurring task の session history には複数の run が newest-first で表示される。
- session history row を押すと `/runs?run=<runId>` が開く。
- archived list は completed one-shot と paused / stopped task を実行の新しい順に表示する。
- `Run now` が成功した場合、app は scheduler data を invalidate し、`Run queued` toast を表示する。
- locked task の edit / delete action は disabled で、unlock action が visible である。
- delete が confirmed された場合、run history は Runs から引き続き discoverable である。

既知の gap:

- archive は derived view であり、独立した persisted archived flag は持たない。
