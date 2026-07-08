---
title: S000 App Shell
description: Codex Scheduler の global shell、sidebar、header、root navigation behavior を定義する。
updated: 2026-07-08
read_when:
  - desktop app shell、sidebar、header、global navigation、root redirect、task sidebar behavior を変更するとき。
  - scheduler health summary、task count indicator、settings entry、mobile navigation を変更するとき。
---

# S000 App Shell

ルートと surface: global desktop shell、`/` root route、desktop sidebar、mobile navigation、header。

目的: dashboard ではなく project と scheduled task を中心にした persistent navigation を提供し、ユーザーが次に実行される task、実行中 task、archive、settings に素早く到達できるようにする。

入口: app launch、root route、すべての desktop page。

出口:

- `/` は専用 dashboard を表示せず、`/projects` へ redirect する。
- sidebar の `プロジェクト` は `/projects` へ遷移する。
- sidebar の task item は `/tasks?task=<taskId>` へ遷移する。
- sidebar の `アーカイブ済み` は `/tasks?view=archived` へ遷移する。
- bottom toolbox の settings icon は `/settings` へ遷移する。

データ依存:

- sidebar task ordering には `useTasks()` と `useRuns()` を使う。
- running / queued count には `useHealth()` を使い、5 秒ごとに refresh する。
- selected project display には `useProjects()` を使う。

レイアウト領域:

- sidebar 先頭 section は product title ではなく `プロジェクト` navigation item を表示する。`Codex Scheduler` の title section、brand mark、subtitle は sidebar に置かない。
- プロジェクトを開いている場合、sidebar の project context と page header では GitHub repository は `user(org)/repo` 形式で表示する。GitHub remote を判定できない folder project は user-editable project name を表示する。
- sidebar section 間は separator line で区切る。
- `ダッシュボード`、`タスク`、`実行履歴` の top-level navigation item は表示しない。
- sidebar main section には active scheduled task を実行予定順で表示する。recurring task は次回実行 1 件だけを表示し、実行完了後に次の `nextRunAt` 位置へ移動する。
- 実行中 task は spinner と text label で実行中状態を示す。
- 1 回きりの完了 task、paused / stopped task、deleted task は main section から外し、bottom toolbox の上に folder icon 付き `アーカイブ済み` item としてまとめる。
- sidebar 最下部には fixed icon toolbox section を置き、settings gear icon を含める。
- sidebar 全体は `user-select: none` にする。
- header は scheduler status badge と scheduler enabled toggle を表示しない。
- header の running / queued summary は text sentence ではなく icon + number を使う。例: spinner / activity icon と `0`、queue icon と `0`。
- header は primary action として `新規タスク` を持つ。
- mobile navigation は同じ情報構造を drawer 内で表現する。

フィールドとコントロール:

- Sidebar project item: icon + `プロジェクト` label。
- Sidebar task item: task name、next run relative time、running spinner または next-run icon。
- Archived item: folder icon + `アーカイブ済み` label。archived count は sidebar に表示しない。
- Toolbox: settings gear icon button。必要に応じて diagnostics などの icon-only controls を追加できる。
- Header count: running count、queued count。長い `0件実行中 · 0件待機中` 形式は使わない。

状態:

- Loading: sidebar task section は compact skeleton rows を表示する。
- Empty active tasks: main section に `予定されたタスクはありません` を表示し、`新規タスク` への compact action を出す。
- Running task: spinner、`実行中` label、active style を表示する。
- Archived exists: `アーカイブ済み` を neutral item として表示し、押すと archived list に遷移する。
- Archived empty: `アーカイブ済み` は disabled にせず、押すと empty archived list に遷移する。
- Health unavailable: count は `--` ではなく `0` を表示し、icon に muted style を使う。

バリデーションとエラー:

- sidebar data fetch failure は main content を block しない。sidebar section 内に compact error fallback を表示し、header count は 0 として扱う。

アクセシビリティ:

- icon-only toolbox item は visible tooltip または `aria-label` を持つ。
- active route は `aria-current="page"` を持つ。
- running spinner は decorative icon のみで状態を伝えず、`実行中` text を併記する。
- sidebar は user selection を無効化しても keyboard focus と screen reader navigation を妨げない。

セキュリティと安全性:

- `アーカイブ済み` は task を削除したことを意味しない。paused / stopped / completed one-shot を active schedule から外して表示するだけで、履歴は保持する。
- settings は bottom toolbox に残し、dangerous defaults や diagnostics は settings page 内で扱う。

受け入れ条件:

- desktop sidebar に `Codex Scheduler` title section が表示されない。
- sidebar 先頭 item `プロジェクト` を押すと `/projects` が開く。
- active recurring task が sidebar に複数重複表示されない。
- running task は spinner と `実行中` text で判別できる。
- completed one-shot task と paused task は sidebar main section に表示されず、`アーカイブ済み` から一覧できる。
- header に `稼働中` badge と scheduler toggle が表示されない。
- header count は icon + number で表示される。
