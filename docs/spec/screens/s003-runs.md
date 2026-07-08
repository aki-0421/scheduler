---
title: S003 Runs
description: Runs screen の history、filter、detail、log tail、export、cancel、follow-up requirement を定義する。
updated: 2026-07-08
read_when:
  - Runs page、run filtering、run detail、log display、artifact action、cancel/retry/follow-up flow を変更するとき。
---

# S003 Runs

ルート: `/runs`

目的: execution history を inspect し、failure または review-worthy run を triage し、log を tail し、evidence を export し、active run を cancel し、task retry と follow-up task 作成を行えるようにする。

入口: `Runs` navigation item、Today recent activity row、`View runs` link。

出口: selected run detail、linked follow-up task wizard、task retry、workspace または artifact の Finder open、logs export。

データ依存:

- task name と follow-up context には `useTasks()` を使う。
- filtered history には `useRuns({ status, taskId })` を使う。
- selected detail には `useRun(runId)` を使い、active run は 3 秒ごとに refetch する。
- active run cancellation には `useCancelRun()` を使う。
- retry には `useRunTaskNow()` を使う。
- stdout、stderr、event log polling には `ipcClient.runTailLog()` を使う。
- local file operation には `ipcClient.exportRunLogs()` と `ipcClient.openPath()` を使う。

レイアウト領域:

- status filter と task filter を持つ header。
- count、preset button、list row を持つ run history section。
- `run` query parameter がある場合、list の下に selected run detail を表示する。
- run identity、trigger、status、workspace / follow-up / cancel / retry action を持つ detail header。
- metadata、prompt、output、log、artifact の detail section。

フィールドとコントロール:

- Presets: recent、failed、review。
- Status filter: all run statuses。
- Task filter: all tasks または specific task。
- Detail actions: open workspace、create follow-up task、cancel active run、retry、export logs、copy prompt / output / logs、show artifact in Finder。
- Logs tabs: stdout、stderr、events。

状態:

- Loading route fallback: `Loading runs...`。
- Empty filtered list: `No matching runs` と open-tasks action。
- Selected run loading: inline loading panel。
- Review badge は failed、timed out、interrupted、findings、created schedules の場合に表示される。
- Active run は 3 秒ごとに log を poll する。
- missing log は availability fallback を表示する。
- output、prompt、events、artifact がない場合、それぞれ explicit empty state を持つ。

バリデーションとエラー:

- cancel、retry、open path、export failure は利用可能な error detail を含む toast を使う。
- event log は JSONL を readable event card に parse し、raw event disclosure を保持する。

アクセシビリティ:

- filter と preset は keyboard-reachable control である。
- status は color だけでなく text badge で伝える。
- log は tab と copy control で segmented される。

セキュリティと安全性:

- Finder open action は run DTO または artifact が返した path だけを使う。
- follow-up task prefill は source run context を task description に保持する。

受け入れ条件:

- preset `Failed` の場合、failed run だけが表示される。
- preset `Review` の場合、failed、timed-out、interrupted、findings、created-schedule run が表示される。
- active run が selected の場合、run が active status を離れるまで log が poll される。
- cancel が成功した場合、scheduler data は invalidate され、detail は refresh する。
- export logs が成功した場合、user は exported local path を見る。

既知の gap:

- review state は derived であり、persisted reviewed または archived state はない。
