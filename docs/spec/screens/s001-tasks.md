---
title: S001 Tasks
description: Tasks screen の archived list、task detail の実行履歴・設定 tabs、inline editing、lock behavior を定義する。
updated: 2026-07-10
read_when:
  - Tasks page、archived task list、task detail、task action、inline editing、duplicate flow、lock behavior、audit display を変更するとき。
---

# S001 Tasks

ルート: `/tasks`、`/tasks?task=<taskId>`、`/tasks?view=archived`

目的: sidebar から選択された scheduled Codex task の履歴と操作を inspect できるようにし、active sidebar から外れた task を archive として確認できるようにする。

入口: sidebar task item、sidebar `アーカイブ済み` item、task wizard からの post-save redirect、task session の task link。

出口: `New task`、task duplicate、lock / unlock、session row、delete confirmation。

データ依存:

- archived list と sidebar ordering には `useTasks()` と `useRuns()` を使う。
- selected task detail には `useTask(taskId)` を使う。
- selected task history には `useRuns({ taskId })` を使い、newest-first で表示する。
- audit log には `useTaskAudits(taskId)` を使う。
- task action は `task_run_now`、`task_pause`、`task_resume`、`task_delete`、`task_update`、lock / unlock mutation を呼び出す。

レイアウト領域:

- `/tasks?view=archived`: archived task list。completed one-shot、paused / stopped、deleted task を execution newest-first で表示する。
- `/tasks?task=<taskId>`: task detail page。`実行履歴` と `設定` の 2 tabs だけを表示し、初期表示は `実行履歴` にする。常時表示の right action panel と edit dialog は置かない。
- header の文脈説明は title 右の `?` tooltip に置く。subtitle として常時表示しない。list section には title と同義の補足説明文や count 説明文を置かない。
- detail header: task name。
- tabs: `実行履歴`、`設定`。`実行履歴` は status、lock state、task ID、schedule、target、next run と session history を統合する。`設定` は prompt を含む editable task configuration、task actions、audit log を統合する。
- archived list と task detail の tab content は page canvas に直接配置し、外側の rounded border、別背景、shadow、内側 padding を持つ panel で囲まない。list row、definition item、audit event の区切りは divider と spacing で示す。
- tab content の先頭には、tab label を繰り返すだけの section heading や説明文を置かない。
- run history row は status、scheduled/start time、duration、result summary を表示し、押すと `/runs?run=<runId>` へ遷移する。
- Archived list row の target、schedule、last status、duration は icon と semantic color を持つ compact token を優先し、文字だけの cell を避ける。
- task description は表示しない。Archived list の補助行には target detail を使い、task detail の実行履歴先頭は status、ID、schedule、target、next run に集中する。
- edit は `設定` tab の inline form で行い、duplicate は同 tab の task action から開始する。

フィールドとコントロール:

- Archived sort: 実行の新しい順。実行がない archived task は updatedAt または createdAt の新しい順で末尾に置く。
- Detail actions: `設定` tab 内の run now、pause / resume、duplicate、lock / unlock、delete。設定変更は同 tab の `変更を保存` で確定する。
- Lock: locked task は AI / scheduled-run actor からの edit、delete、pause、resume を拒否する。user actor は unlock 後に変更できる。
- Delete confirmation: run history を保持し、active schedule から task を削除する。
- Prompt は `設定` tab の editable textarea として表示する。

状態:

- Loading route fallback: `Loading tasks...`。
- Empty archived list: 表示領域を埋める高さで `アーカイブ済みタスクはありません` と active task creation action を表示する。
- Selected task loading: page skeleton。
- Selected task populated: summary と session history を `実行履歴` に、editable configuration、audit log、actions を `設定` に表示する。
- Locked task: lock badge、disabled configuration / delete state、unlock guidance と unlock action を表示する。

バリデーションとエラー:

- mutation は success / failure の toast feedback を使う。
- delete は confirmation dialog で guard される。
- locked task を編集または削除しようとした場合、UI は action を disabled にし、backend から denial が返った場合は lock reason を toast で表示する。

アクセシビリティ:

- tablist は keyboard navigation を持つ。
- run history row は task-session link として識別できる accessible name を持つ。
- `設定` tab の actions は task-specific label を持つ。
- delete confirmation は明確な cancel label と destructive action label を持つ。

検証:

- `pnpm --filter desktop exec vitest run test/task-detail.test.tsx` は 2 tabs だけが表示されること、`実行履歴` が初期選択されること、`設定` が task creation form を inline で再利用すること、locked task の form が disabled になることを検証する。
- UI を変更した場合は `agent-browser` で `/tasks/?task=<taskId>` を開き、desktop と mobile width で横 overflow がないこと、arrow key で tabs を移動できること、unlocked task は inline save できること、locked task は unlock action 以外の設定変更を行えないことを確認する。

セキュリティと安全性:

- locked task は scheduled Codex session と CLI actor による destructive / mutating action を拒否する。lock / unlock は audit event に記録する。
- audit event は actor、action、timestamp、任意の before / after JSON detail を表示する。

受け入れ条件:

- sidebar task item を押すと `/tasks?task=<taskId>` が開き、その task の session history が表示される。
- task detail は `実行履歴` と `設定` の 2 tabs だけを持ち、`実行履歴` が初期表示される。
- recurring task の session history には複数の run が newest-first で表示される。
- session history row を押すと `/runs?run=<runId>` が開く。
- archived list は completed one-shot と paused / stopped task を実行の新しい順に表示する。
- `Run now` が成功した場合、app は scheduler data を invalidate し、`Run queued` toast を表示する。
- locked task の edit / delete action は disabled で、unlock action が visible である。
- `設定` tab は新規 task 作成画面と同じ field、section order、responsive layout を再利用し、dialog を開かずに編集・保存できる。
- prompt、task actions、audit log は `設定` tab に統合され、独立した `プロンプト`、`監査ログ`、`操作` tabs は表示されない。
- delete が confirmed された場合、run history は Runs から引き続き discoverable である。
- task detail の tab list は横方向にスクロールせず、狭い幅でもすべての tab が表示される。
- archived list と task detail の各 tab content は page-level panel surface を持たず、row divider と section spacing で情報を判別できる。
- archived list、task detail、edit / duplicate flow のいずれにも task description は表示されない。

既知の gap:

- archive は derived view であり、独立した persisted archived flag は持たない。
