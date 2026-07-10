---
title: S003 Task Sessions
description: Task Session の長時間 chat transcript、task context overlay、tool usage disclosure、history filter、cancel / retry requirement を定義する。
updated: 2026-07-11
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
- selected session detail には `useRun(runId)` を使い、active run は 1 秒ごとに refetch して terminal status と final output への切り替えを追従する。
- active run cancellation には `useCancelRun()` を使う。
- retry には `useRunTaskNow()` を使う。
- tool call と agent message の transcript には event log を使い、`ipcClient.runTailLog()` で取得する。

開発検証:

- `apps/desktop/lib/mock-long-codex-log.ts` は実際の Codex CLI JSON event log から個人パスと ID を置換した長時間 session fixture である。development mock の `/runs?run=run_demo_long` で、1 chunk を超える取得、10 件の途中 agent message、37 件の tool call、末尾の final output をまとめて確認できる。
- transcript parsing または cursor pagination を変更した場合は `pnpm --filter desktop test` を実行し、長い terminal run の後半まで欠落しないことを確認する。

レイアウト領域:

- status filter と task filter を持つ header。header の文脈説明は title 右の `?` tooltip に置き、subtitle として常時表示しない。
- preset button、list row を持つ run history section。list count の説明文は表示しない。
- `/runs?run=<runId>` は global history list、filter、preset を描画しない独立した session detail page として開く。
- session detail は tabs、overview、別 session の history を持たず、最大幅を抑えた 1 本の chat transcript だけを表示する。
- session header は parent task link、task name、run status、開始時刻を compact に表示する。右側の action は `タスク情報`、`タスクプロンプト`、active run の cancel または terminal run の retry の順に置く。
- `タスク情報` は現在の task settings を読み取り専用の right sheet で表示する。task status、lock、schedule、next run、timezone、model、reasoning effort、target、project path、base ref を対象とし、prompt は含めない。
- `タスクプロンプト` は現在の task prompt を dialog で表示し、copy action を持つ。
- transcript 本文には task prompt を置かず、agent message、tool call、final output の順序を event log に従って維持する。terminal run では最後の `agent_message` だけを final output とし、それ以前の `agent_message` はモデルがユーザーへ公開した途中出力として時系列に残す。公開された agent message と final output は CommonMark と GFM の Markdown としてレンダリングし、強調、link、list、task list、blockquote、table、inline code、code block を表示する。モデルが意図した会話上のレイアウトを保つため、空行だけでなく単独の改行も改行として描画する。`reasoning` item は途中出力として扱わず表示しない。
- Codex の `thread.started`、`turn.started`、`turn.completed` など内部 lifecycle event は通常表示しない。`turn.failed` と `error` は会話中の error row として表示する。
- command、web search、file change、MCP tool call は外枠の card を持たない muted な 1 行ログとして表示する。tool type は文字 label ではなく識別可能な icon だけを表示し、accessible name と native title には文字 label を残す。短い要約の背景は 8px radius とし、横幅は内容に合わせ、利用可能幅を超える場合だけ truncate する。完了と失敗の status text は視覚的には表示せず読み上げだけに残し、実行中だけを visible status として表示する。通常行には背景色を付けず、失敗行は status icon や text を追加せず淡い error background だけで区別する。detail disclosure の indicator は行頭に置かず行末へ置き、pointer hover または keyboard focus の間だけ表示する。command output、arguments、result は disclosure 内に置き、既定では閉じる。known tool の raw event 全体は重複表示しない。
- 同じ item ID の `item.started` と `item.completed` は 1 行に統合し、実行中から完了または失敗へ status を更新する。
- terminal run の final output は最後の `agent_message` を優先し、event log にない場合だけ `resultSummary` を fallback に使う。final output は icon と見出しを持たず、transcript の最後に背景色の異なる surface として 1 回だけ表示する。copy action はレンダリング前の Markdown source をコピーする。Markdown heading level 1 は session page の `h1` と競合させず `h2` として描画し、後続 level も 1 段下げる。table と code block は transcript 幅を広げず内部 scroll で確認できる。
- event log は 1 回の `runTailLog` 上限を超えることを前提に、terminal run でも EOF まで cursor pagination で読み切る。active run は 250ms 間隔の non-overlapping tail poll を使い、各 response chunk を次の chunk や EOF を待たず transcript に追加する。現在の EOF まで読み切った後だけ次の poll を予約し、同時 request を発生させない。
- active run が terminal status に変わるときは、同じ run の accumulated transcript と cursor を保持し、現在 cursor から final tail read を 1 回行う。status transition のために transcript を空へ戻したり先頭から再取得したりしない。
- live transcript は Codex が出力した complete JSONL event 単位で更新する。存在しない token delta を補間する typewriter animation は使わず、runner が生成した tool start / complete と public agent message を到着順に即時表示する。

フィールドとコントロール:

- Presets: recent、failed、review。
- Status filter: all run statuses。
- Task filter: all tasks または specific task。
- Session actions: parent task へ戻る、task settings sheet、task prompt dialog、cancel active run、retry terminal run。
- Run list row の trigger、scheduled time、duration、exit code は icon と semantic color を持つ compact token で表示する。exit code `0` は success、non-zero は error、未記録は muted とする。
- Run status と review state は text だけでなく icon と color tone で区別できる。
- Chat transcript: Markdown をレンダリングした public な途中 assistant message、muted compact tool row、collapsed tool detail、背景で区別した Markdown final output。

状態:

- Loading route fallback: `Loading runs...`。
- Empty filtered list: 表示領域を埋める高さで `No matching runs` と open-tasks action を表示する。
- Selected session loading: page skeleton。
- Review badge は failed、timed out、interrupted、findings、created schedules の場合に表示される。
- Active run は event log を 250ms 間隔で tail し、取得した各 chunk を即時 append する。log file がまだ作成されていない間は active status のまま retry し、terminal run だけを unavailable として確定する。terminal run も初回 load で EOF まで取得する。
- Active run の初回接続中は `実行ログに接続しています…`、接続後に event がまだない場合は `新しい実行ログを待っています…` と表示する。実行中に `ツール呼び出しの記録がありません` と確定表示せず、terminal status になってから empty record を確定する。
- missing event log は tool call が記録されていない旨を transcript 内で簡潔に表示する。
- output がない場合は transcript 内に explicit empty state を持つ。task prompt がない場合は prompt dialog 内で明示する。
- structured event を parse できない行は画面全体を壊さず無視する。error event の raw payload は disclosure から確認できる。

バリデーションとエラー:

- cancel と retry failure は利用可能な error detail を含む toast を使う。
- event log は JSONL を readable transcript entry に parse し、tool の開始 / 完了 event を item ID で統合する。

アクセシビリティ:

- filter と preset は keyboard-reachable control である。
- status は color だけでなく text badge で伝える。
- chat transcript は `role="log"` または ordered list として読み上げ順を維持し、active run で追加された public entry を polite live update として通知する。
- tool call row は視覚上 icon だけで表す tool type に accessible name を付け、status と summary も読み上げ可能にする。detail disclosure は native keyboard interaction で開閉でき、行末 indicator は hover に加えて keyboard focus でも表示する。完了と失敗 status は screen reader text として保持する。
- task settings sheet と task prompt dialog は focus trap、Escape close、visible title を持つ accessible overlay primitive を使う。

セキュリティと安全性:

- transcript に command output や tool arguments を表示するときも HTML として解釈せず text として表示する。
- agent message と final output の Markdown に含まれる raw HTML は無視し、`dangerouslySetInnerHTML` や raw HTML plugin は使わない。link と image URL は Markdown renderer の safe URL transform を通す。

受け入れ条件:

- preset `Failed` の場合、failed run だけが表示される。
- preset `Review` の場合、failed、timed-out、interrupted、findings、created-schedule run が表示される。
- task detail の session history row を押すと `/runs?run=<runId>` が開く。
- `/runs?run=<runId>` では global history、filter、preset、tabs、overview、raw log panel、artifact panel を表示しない。
- session detail の transcript は task prompt を常時表示せず、Markdown としてレンダリングした公開済み途中 agent message、tool usage、Markdown final output を時系列に確認できる。private reasoning と raw HTML は表示しない。
- `タスク情報` を押すと current task settings が right sheet で開き、prompt は表示しない。
- `タスクプロンプト` を押すと current task prompt が dialog で開き、copy できる。
- tool call は開始 / 完了を muted な 1 行に統合し、command output や tool result は初期状態で閉じている。tool type は icon のみ、summary surface は 8px radius の内容幅で、失敗行は icon や text を増やさず淡い error background だけを持つ。折りたたみ indicator は行末にあり、hover または keyboard focus のときだけ見える。大量の完了 tool が status label や card border で画面を占有しない。
- final output は icon と visible heading を持たず、背景色の異なる 1 つの surface として transcript の末尾に表示される。
- agent message と final output の emphasis、link、list、table、inline code、code block が Markdown source 記号を露出せず表示され、単独改行を含む source の改行位置が画面でも維持される。copy action は元の Markdown source を保持する。
- 1 chunk を超える長い event log でも EOF まで取得され、途中 agent message、後半の tool call、final output が欠落しない。
- active run の event log response は EOF 到達を待たず response chunk ごとに画面へ反映され、次の tail poll は前の request 完了から 250ms 後にだけ開始される。
- active run が terminal status に変わっても表示済み entry は消えず、保持した cursor から最終 event が取得されて final output へ切り替わる。
- lifecycle event は transcript を占有せず、error event だけが user-visible row になる。
- active run が selected の場合、run が active status を離れるまで log が poll される。
- cancel が成功した場合、scheduler data は invalidate され、detail は refresh する。
- failed / interrupted / timed-out session の `再実行` は新しい manual run を enqueue する。scheduler 自身は自動 retry を作成しない。
- run history list と session detail は同時に表示されず、browser back または parent task link で session 選択画面へ戻れる。

既知の gap:

- review state は derived であり、persisted reviewed または archived state はない。
- task prompt dialog は現在の task prompt を参照しており、run 開始時点の prompt snapshot は保持していない。
