---
title: S000 Today
description: Today screen の health summary、upcoming run、recent activity、scheduler operation requirement を定義する。
updated: 2026-07-08
read_when:
  - Today page、scheduler health summary、upcoming run、recent activity、global pause、diagnostics entry を変更するとき。
---

# S000 Today

ルート: `/`

目的: scheduler health、queued work、recent failure、review load、Codex CLI readiness、maintenance action を compact な operation view としてユーザーに提供する。

入口: default app route と `Today` navigation item。

出口: `View tasks`、upcoming run row、`View runs`、recent activity row、`Open diagnostics`、operation button。

データ依存:

- active task queue、next run sorting、task name には `useTasks()` を使う。
- running count、failed-last-day count、needs-review count、recent activity には `useRuns()` を使う。
- daemon version、scheduler enabled state、schema health には 5 秒ごとの `useHealth()` を使う。
- Codex CLI readiness には 15 秒ごとの `useDaemonDiagnostics()` を使う。
- scheduler enabled と Codex path fallback には `useSettings()` を使う。
- operation には `useDaemonTickNow()` と `useSetSetting()` を使う。

レイアウト領域:

- title `Today` と next-run-oriented description を持つ page header。
- scheduler、running now、failed today、needs review、Codex CLI の summary chip。
- `nextRunAt` 順の upcoming runs list。
- start time または scheduled time 順の recent activity list。
- due-run check、pause schedules、diagnostics entry を持つ scheduler operations section。

フィールドとコントロール:

- `Check due runs` は daemon tick command を呼び出し、success または error toast を表示する。
- `Pause schedules` は `scheduler.enabled` を `false` に設定し、success または error toast を表示する。
- `Open diagnostics` は現在 `/runs` に link する。

状態:

- Empty tasks: `No tasks yet` と create-first-task action を表示する。
- Tasks without next run: `No upcoming runs` と open-tasks action を表示する。
- Empty runs: `No runs yet` と open-tasks action を表示する。
- Codex CLI status は `Ready`、`Missing`、`Not checked`、`Unavailable`。
- Scheduler status は `On` または `Paused`。

セキュリティと安全性:

- global pause は settings に隠さず operation として visible にする。
- failed count と review count は color だけに依存してはならない。label と numeric value を常に visible にする。

受け入れ条件:

- `nextRunAt` を持つ active task が 1 つ以上ある場合、earliest task が Upcoming runs の先頭に表示される。
- 過去 24 時間以内に failed または timed-out run がある場合、Failed today が増える。
- failure、timeout、finding、created schedule を持つ run がある場合、Needs review が増える。
- daemon tick command が失敗した場合、利用可能な error detail を含む failure toast が表示される。

既知の gap:

- `Open diagnostics` は専用 diagnostics screen ではなく Runs に route する。
- Today の Pause schedules には対応する resume action がない。
