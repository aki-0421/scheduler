---
title: S003 Task Sessions
description: Task Session screen の chat UI、tool usage display、history filter、log tail、export、cancel、follow-up requirement を定義する。
updated: 2026-07-10
read_when:
  - Runs page、task session page、run filtering、chat transcript、tool usage display、artifact action、cancel/retry/follow-up flow を変更するとき。
---

# S003 Task Sessions

ルート: `/runs`、`/runs?run=<runId>`

目的: 1 回の task execution を session として inspect し、その実行での Codex の挙動、利用された tool、stdout / stderr / event log、artifact を確認できるようにする。global history list は補助的な triage surface として残す。

入口: task detail の session history row、archived task row、global history route、follow-up / retry flow。

出口: parent task、linked follow-up task wizard、task retry、workspace または artifact の Finder open、logs export。

データ依存:

- task name と follow-up context には `useTasks()` を使う。
- filtered history には `useRuns({ status, taskId })` を使う。
- selected session detail には `useRun(runId)` を使い、active run は 3 秒ごとに refetch する。
- active run cancellation には `useCancelRun()` を使う。
- retry には `useRunTaskNow()` を使う。
- stdout、stderr、event log polling には `ipcClient.runTailLog()` を使う。
- local file operation には `ipcClient.exportRunLogs()` と `ipcClient.openPath()` を使う。

レイアウト領域:

- status filter と task filter を持つ header。header の文脈説明は title 右の `?` tooltip に置き、subtitle として常時表示しない。
- preset button、list row を持つ run history section。list count の説明文は表示しない。
- `/runs?run=<runId>` は session detail page として開く。
- session detail header は task name、run status、trigger、scheduled / started time、parent task link を持つ。
- selected session detail は `概要`、`チャット`、`プロンプト`、`出力`、`ログ`、`成果物` の tabs で表示する。
- session detail と `ログ` 内の nested tabs は tab list を content panel の外側、直上に配置し、選択中の tab content を bordered panel として表示する。
- `チャット` tab は system / user prompt、assistant output、tool call、tool result、daemon event を時系列 bubble として表示する。
- right or top action area は workspace / follow-up / cancel / retry / export logs を持つ。
- tab content の先頭には、tab label と同義の section heading や説明文を置かない。

フィールドとコントロール:

- Presets: recent、failed、review。
- Status filter: all run statuses。
- Task filter: all tasks または specific task。
- Session actions: open workspace、create follow-up task、cancel active run、retry、export logs、copy prompt / output / logs、show artifact in Finder。
- Run list row の trigger、scheduled time、duration、exit code は icon と semantic color を持つ compact token で表示する。exit code `0` は success、non-zero は error、未記録は muted とする。
- Run status と review state は text だけでなく icon と color tone で区別できる。
- Chat transcript: prompt bubble、assistant message bubble、tool call row、tool output disclosure、daemon event row。
- Logs tabs: stdout、stderr、events。

状態:

- Loading route fallback: `Loading runs...`。
- Empty filtered list: 表示領域を埋める高さで `No matching runs` と open-tasks action を表示する。
- Selected session loading: page skeleton。
- Review badge は failed、timed out、interrupted、findings、created schedules の場合に表示される。
- Active run は 3 秒ごとに log を poll する。
- missing log は availability fallback を表示する。
- output、prompt、events、artifact がない場合、それぞれ explicit empty state を持つ。
- Tool usage が structured event として取れない場合は raw event log から readable fallback を生成し、raw disclosure を保持する。

バリデーションとエラー:

- cancel、retry、open path、export failure は利用可能な error detail を含む toast を使う。
- event log は JSONL を readable event card に parse し、raw event disclosure を保持する。

アクセシビリティ:

- filter と preset は keyboard-reachable control である。
- status は color だけでなく text badge で伝える。
- chat transcript は `role="log"` または ordered list として読み上げ順を維持する。
- tool call row は tool name、status、summary を text で含む。
- log は tab と copy control で segmented される。

セキュリティと安全性:

- Finder open action は run DTO または artifact が返した path だけを使う。
- follow-up task prefill は source run context を task description に保持する。

受け入れ条件:

- preset `Failed` の場合、failed run だけが表示される。
- preset `Review` の場合、failed、timed-out、interrupted、findings、created-schedule run が表示される。
- task detail の session history row を押すと `/runs?run=<runId>` が開く。
- session detail はチャット UI で prompt、assistant output、tool usage、daemon event を確認できる。
- active run が selected の場合、run が active status を離れるまで log が poll される。
- cancel が成功した場合、scheduler data は invalidate され、detail は refresh する。
- export logs が成功した場合、user は exported local path を見る。
- `ログ` tab の stdout、stderr、events を切り替えた場合、nested tab list は panel の外にあり、選択した log と copy / export action は同じ panel 内に表示される。

既知の gap:

- review state は derived であり、persisted reviewed または archived state はない。
