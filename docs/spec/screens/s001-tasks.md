---
title: S001 Tasks
description: Tasks screen の archived list、task detail の実行履歴・設定 tabs、header actions、inline editing を定義する。
updated: 2026-07-10
read_when:
  - Tasks page、archived task list、task detail、task action、inline editing、duplicate flow、lock behavior を変更するとき。
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
- task action は `task_run_now`、`task_pause`、`task_resume`、`task_delete`、`task_update`、lock / unlock mutation を呼び出す。

レイアウト領域:

- `/tasks?view=archived`: archived task list。completed one-shot、paused / stopped、deleted task を execution newest-first で表示する。
- `/tasks?task=<taskId>`: task detail page。`実行履歴` と `設定` の 2 tabs だけを表示し、初期表示は `実行履歴` にする。常時表示の right action panel と edit dialog は置かない。
- header の文脈説明は title 右の `?` tooltip に置く。subtitle として常時表示しない。list section には title と同義の補足説明文や count 説明文を置かない。
- detail header: task name と、その右側に right-aligned task actions。最優先の run now は primary button、schedule state の pause / resume は secondary button として直接表示する。duplicate、lock / unlock、delete は label 付きの `管理` menu にまとめ、delete は separator で他の管理 action から分離する。狭い width では title の下へ折り返す。
- tabs: `実行履歴`、`設定`。`実行履歴` は session history table だけを表示する。`設定` は prompt を含む editable task configuration だけを表示し、task action や変更履歴は置かない。
- archived list と task detail の tab content は page canvas に直接配置し、外側の rounded border、別背景、shadow、内側 padding を持つ panel で囲まない。list row の区切りは divider と spacing で示す。
- tab content の先頭には、tab label を繰り返すだけの section heading や説明文を置かない。
- run history row は status、scheduled/start time、duration、result summary を表示し、押すと `/runs?run=<runId>` へ遷移する。
- Archived list row の target、schedule、last status、duration は icon と semantic color を持つ compact token を優先し、文字だけの cell を避ける。
- task description は表示しない。Archived list の補助行には target detail を使う。task detail の `実行履歴` には task summary、ID、schedule、target、next run を表示しない。
- edit は `設定` tab の inline form で行い、duplicate は detail header action から開始する。

フィールドとコントロール:

- Archived sort: 実行の新しい順。実行がない archived task は updatedAt または createdAt の新しい順で末尾に置く。
- Detail actions: detail header 内の run now、pause / resume、`管理` menu。menu は duplicate、lock / unlock、delete をこの順で持つ。設定変更は `設定` tab の `変更を保存` で確定する。
- Lock: locked task は AI エージェントが使う CLI / scheduled-run actor からの edit、delete、pause、resume を拒否する。desktop UI の user actor は lock 中も edit、delete、pause、resume できる。
- Delete confirmation: run history を保持し、active schedule から task を削除する。
- Prompt は `設定` tab の editable textarea として表示する。

状態:

- Loading route fallback: `Loading tasks...`。
- Empty archived list: 表示領域を埋める高さで `アーカイブ済みタスクはありません` と active task creation action を表示する。
- Selected task loading: page skeleton。
- Selected task populated: session history table を `実行履歴` に、editable configuration を `設定` に、task actions を detail header に表示する。
- Locked task: configuration と user action は通常どおり利用できる。detail header の `管理` trigger に lock icon を表示し、menu 内に unlock action を置く。settings 内に lock warning や unlock guidance は表示しない。
- Deleted task: run now は disabled、pause / resume は表示しない。duplicate と lock / unlock は `管理` menu から利用でき、delete は disabled にする。

バリデーションとエラー:

- mutation は success / failure の toast feedback を使う。
- delete は confirmation dialog で guard される。
- desktop UI は lock state にかかわらず edit、delete、pause、resume を許可する。CLI / scheduled-run actor による mutation は backend が拒否する。

アクセシビリティ:

- tablist は keyboard navigation を持つ。
- run history row は task-session link として識別できる accessible name を持つ。
- detail header の actions は task-specific label を持つ。
- `管理` menu は trigger 名で目的を明示し、arrow key、Escape、focus return を keyboard で利用できる。
- delete confirmation は明確な cancel label と destructive action label を持つ。

検証:

- `pnpm --filter desktop exec vitest run test/task-detail.test.tsx test/task-actions.test.tsx` は 2 tabs だけが表示されること、`実行履歴` が初期選択されて table 以外を持たないこと、`設定` が task creation form を inline で再利用すること、locked task の form と user action が利用できること、run now・pause / resume・`管理` menu の hierarchy を検証する。
- UI を変更した場合は `agent-browser` で `/tasks/?task=<taskId>` を開き、desktop と mobile width で横 overflow がないこと、arrow key で tabs と `管理` menu を操作できること、lock state にかかわらず inline save と user action を利用できることを確認する。

セキュリティと安全性:

- locked task は scheduled Codex session と CLI actor による destructive / mutating action を拒否する。desktop UI の user actor は lock 中も操作でき、lock / unlock は audit event に記録する。

受け入れ条件:

- sidebar task item を押すと `/tasks?task=<taskId>` が開き、その task の session history が表示される。
- task detail は `実行履歴` と `設定` の 2 tabs だけを持ち、`実行履歴` が初期表示される。
- recurring task の session history には複数の run が newest-first で表示される。
- session history row を押すと `/runs?run=<runId>` が開く。
- archived list は completed one-shot と paused / stopped task を実行の新しい順に表示する。
- `Run now` が成功した場合、app は scheduler data を invalidate し、`Run queued` toast を表示する。
- locked task でも desktop UI の edit / delete / pause / resume action と設定保存を利用でき、`管理` trigger に lock state、menu 内に unlock action が表示される。
- `設定` tab は新規 task 作成画面と同じ field、section order、responsive layout を再利用し、dialog を開かずに編集・保存できる。
- detail header の右側に primary の run now、secondary の pause / resume、duplicate・lock / unlock・delete を構造化した `管理` menu が表示される。
- `実行履歴` tab は session history table だけを表示し、task summary や設定値を表示しない。
- `設定` tab は editable configuration だけを表示し、task actions と変更履歴を表示しない。
- delete が confirmed された場合、run history は Runs から引き続き discoverable である。
- task detail の tab list は横方向にスクロールせず、狭い幅でもすべての tab が表示される。
- archived list と task detail の各 tab content は page-level panel surface を持たず、row divider と section spacing で情報を判別できる。
- archived list、task detail、edit / duplicate flow のいずれにも task description は表示されない。

既知の gap:

- archive は derived view であり、独立した persisted archived flag は持たない。
