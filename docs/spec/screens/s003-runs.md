---
title: S003 Task Sessions
description: Task Session の chat transcript、task context overlay、tool usage disclosure、history filter、cancel / retry requirement を定義する。
updated: 2026-07-10
read_when:
  - Runs page、task session page、run filtering、task context overlay、chat transcript、tool usage display、cancel / retry flow を変更するとき。
---

# S003 Task Sessions

ルート: `/runs`、`/runs?run=<runId>`

目的: 1 回の task execution を独立した chat session として inspect し、利用された tool と最終 output を会話の流れのまま確認できるようにする。task prompt と task settings は header から必要なときだけ参照する。global history list は session を選ぶ triage surface として `/runs` にだけ残す。

入口: task detail の session history row、archived task row、global history route。

出口: parent task、task retry。

データ依存:

- selected session の task name、task prompt、task settings には `useTask(taskId)` を使う。
- filtered history には `useRuns({ status, taskId })` を使う。
- selected session detail には `useRun(runId)` を使い、active run は 3 秒ごとに refetch する。
- active run cancellation には `useCancelRun()` を使う。
- retry には `useRunTaskNow()` を使う。
- tool call と agent message の transcript には event log を使い、`ipcClient.runTailLog()` で取得する。

レイアウト領域:

- status filter と task filter を持つ header。header の文脈説明は title 右の `?` tooltip に置き、subtitle として常時表示しない。
- preset button、list row を持つ run history section。list count の説明文は表示しない。
- `/runs?run=<runId>` は global history list、filter、preset を描画しない独立した session detail page として開く。
- session detail は tabs、overview、別 session の history を持たず、最大幅を抑えた 1 本の chat transcript だけを表示する。
- session header は parent task link、task name、run status、開始時刻を compact に表示する。右側の action は `タスク情報`、`タスクプロンプト`、active run の cancel または terminal run の retry の順に置く。
- `タスク情報` は現在の task settings を読み取り専用の right sheet で表示する。task status、lock、schedule、next run、timezone、model、reasoning effort、target、project path、base ref を対象とし、prompt は含めない。
- `タスクプロンプト` は現在の task prompt を dialog で表示し、copy action を持つ。
- transcript 本文には task prompt を置かず、agent message、tool call、final output の順序を event log に従って維持する。
- Codex の `thread.started`、`turn.started`、`turn.completed` など内部 lifecycle event は通常表示しない。`turn.failed` と `error` は会話中の error row として表示する。
- command、web search、file change、MCP tool call は tool name、短い要約、status だけを常時表示する。command output、arguments、result は disclosure 内に置き、既定では閉じる。known tool の raw event 全体は重複表示しない。
- 同じ item ID の `item.started` と `item.completed` は 1 行に統合し、実行中から完了または失敗へ status を更新する。
- `resultSummary` と最後の `agent_message` が同じ内容の場合は重複表示せず、1 つの final output として表示する。

フィールドとコントロール:

- Presets: recent、failed、review。
- Status filter: all run statuses。
- Task filter: all tasks または specific task。
- Session actions: parent task へ戻る、task settings sheet、task prompt dialog、cancel active run、retry terminal run。
- Run list row の trigger、scheduled time、duration、exit code は icon と semantic color を持つ compact token で表示する。exit code `0` は success、non-zero は error、未記録は muted とする。
- Run status と review state は text だけでなく icon と color tone で区別できる。
- Chat transcript: assistant message、compact tool row、collapsed tool detail、final output。

状態:

- Loading route fallback: `Loading runs...`。
- Empty filtered list: 表示領域を埋める高さで `No matching runs` と open-tasks action を表示する。
- Selected session loading: page skeleton。
- Review badge は failed、timed out、interrupted、findings、created schedules の場合に表示される。
- Active run は 3 秒ごとに log を poll する。
- missing event log は tool call が記録されていない旨を transcript 内で簡潔に表示する。
- output がない場合は transcript 内に explicit empty state を持つ。task prompt がない場合は prompt dialog 内で明示する。
- structured event を parse できない行は画面全体を壊さず無視する。error event の raw payload は disclosure から確認できる。

バリデーションとエラー:

- cancel と retry failure は利用可能な error detail を含む toast を使う。
- event log は JSONL を readable transcript entry に parse し、tool の開始 / 完了 event を item ID で統合する。

アクセシビリティ:

- filter と preset は keyboard-reachable control である。
- status は color だけでなく text badge で伝える。
- chat transcript は `role="log"` または ordered list として読み上げ順を維持する。
- tool call row は tool name、status、summary を text で含み、detail disclosure は native keyboard interaction で開閉できる。
- task settings sheet と task prompt dialog は focus trap、Escape close、visible title を持つ accessible overlay primitive を使う。

セキュリティと安全性:

- transcript に command output や tool arguments を表示するときも HTML として解釈せず text として表示する。

受け入れ条件:

- preset `Failed` の場合、failed run だけが表示される。
- preset `Review` の場合、failed、timed-out、interrupted、findings、created-schedule run が表示される。
- task detail の session history row を押すと `/runs?run=<runId>` が開く。
- `/runs?run=<runId>` では global history、filter、preset、tabs、overview、raw log panel、artifact panel を表示しない。
- session detail の transcript は task prompt を常時表示せず、agent message、tool usage、final output を時系列に確認できる。
- `タスク情報` を押すと current task settings が right sheet で開き、prompt は表示しない。
- `タスクプロンプト` を押すと current task prompt が dialog で開き、copy できる。
- tool call は開始 / 完了を 1 行に統合し、command output や tool result は初期状態で閉じている。
- lifecycle event は transcript を占有せず、error event だけが user-visible row になる。
- active run が selected の場合、run が active status を離れるまで log が poll される。
- cancel が成功した場合、scheduler data は invalidate され、detail は refresh する。
- failed / interrupted / timed-out session の `再実行` は新しい manual run を enqueue する。scheduler 自身は自動 retry を作成しない。
- run history list と session detail は同時に表示されず、browser back または parent task link で session 選択画面へ戻れる。

既知の gap:

- review state は derived であり、persisted reviewed または archived state はない。
- task prompt dialog は現在の task prompt を参照しており、run 開始時点の prompt snapshot は保持していない。
