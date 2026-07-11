---
title: S000 App Shell
description: Clockhand の global shell、sidebar、header、root navigation behavior を定義する。
updated: 2026-07-11
read_when:
  - desktop app shell、sidebar、header、global navigation、root redirect、task sidebar behavior を変更するとき。
  - scheduler health summary、task count indicator、settings entry、mobile navigation を変更するとき。
---

# S000 App Shell

ルートと surface: global desktop shell、`/` root route、desktop sidebar、mobile navigation、header。

目的: dashboard ではなく scheduled task を中心にした persistent navigation を提供し、現在日時と各 task の起動予定を常に確認しながら、project、archive、settings に素早く到達できるようにする。

入口: app launch、root route、すべての desktop page。

出口:

- `/` は専用 dashboard を表示せず、`/projects` へ redirect する。
- sidebar の `プロジェクト` は `/projects` へ遷移する。
- sidebar の task item は `/tasks?task=<taskId>` へ遷移する。
- sidebar の `アーカイブ済み` は `/tasks?view=archived` へ遷移する。
- bottom toolbox の settings icon は `/settings` へ遷移する。

データ依存:

- sidebar clock は browser の local date / time を使い、分境界で更新する。daemon や network response には依存しない。
- sidebar task ordering には `useTasks()` と `useRuns()` を使う。
- running count には `useHealth()` を使い、5 秒ごとに refresh する。
- selected project display には `useProjects()` を使う。

レイアウト領域:

- sidebar の右側は header と page background が連続する content canvas とし、各 page の主内容を追加の panel surface で包まない。page-level hierarchy は spacing と separator で表現する。
- sidebar 先頭 section は現在の日付と時刻を表示する。日付は年・月・日・曜日、時刻は24時間表記の時・分とし、product title、brand mark、subtitle、navigation item は置かない。
- プロジェクトを開いている場合、sidebar の project context と page header では GitHub repository は `user(org)/repo` 形式で表示する。GitHub remote を判定できない Git project は user-editable project name を表示する。
- sidebar section 間は separator line で区切る。
- `ダッシュボード`、`タスク`、`実行履歴` の top-level navigation item は表示しない。
- sidebar main section には active scheduled task を実行予定順で表示する。recurring task は次回実行 1 件だけを表示し、実行完了後に次の `nextRunAt` 位置へ移動する。task row は 1 行目に時刻、2 行目に task name を表示する。
- 実行されていない task の 1 行目は `nextRunAt` を `M/D HH:mm` 形式で表示し、`起動予定` などの visible label は付けない。
- 実行中 task は spinner のみで状態を表し、1 行目には active run の `scheduledFor` を表示する。`scheduledFor` がない場合は `startedAt`、`queuedAt` の順に代替し、将来の `nextRunAt` は表示しない。`実行中` などの visible status text は置かない。
- 1 回きりの完了 task、paused / stopped task、deleted task は main section から外し、bottom toolbox の上に folder icon 付き `アーカイブ済み` item としてまとめる。`プロジェクト` navigation item は `アーカイブ済み` の直下に置く。
- sidebar 最下部には fixed icon toolbox section を置き、settings gear icon を含める。
- sidebar 全体は `user-select: none` にする。
- header は scheduler status badge と scheduler enabled toggle を表示しない。
- header left area は current route の breadcrumb を表示する。breadcrumb は current page title、selected task name、selected run id を使い、長い値は truncate する。
- header は running summary を activity icon + number で表示し、queued count は表示しない。
- header は primary action として `新規タスク` を持つ。
- mobile navigation は同じ情報構造を drawer 内で表現する。drawer の clock は標準 close button と重ならない右余白を確保する。

フィールドとコントロール:

- Sidebar clock: local date `YYYY年M月D日（曜）`、local time `HH:mm`。秒は表示しない。
- Sidebar task item: 1 行目の `M/D HH:mm`、2 行目の task name、running spinner または next-run icon。完全な日時と状態は title / accessible name から確認できる。
- Archived item: folder icon + `アーカイブ済み` label。archived count は sidebar に表示しない。
- Sidebar project item: icon + `プロジェクト` label。`アーカイブ済み` の次に表示する。
- Toolbox: settings gear icon button。必要に応じて diagnostics などの icon-only controls を追加できる。
- Header count: running count。長い `0件実行中` 形式や queued count は使わない。
- Header breadcrumb: `プロジェクト`、`アーカイブ済み`、`アーカイブ済み / <task name>`、`アーカイブ済み / 新規タスク`、`<task name> / <run id>`、`設定`。run detail の task name は task detail への link とする。
- Page header: title cluster と action controls は同じ行内で垂直中央揃えにする。page-level explanation は常時 subtitle として表示せず、title 右の `?` help trigger の tooltip に置く。

状態:

- Clock mounting: hydration mismatch を避けるため server / initial render は placeholder を表示し、client mount 後に local date / time へ切り替える。
- Loading: sidebar task section は compact skeleton rows を表示する。
- Empty active tasks: main section に `予定されたタスクはありません` を表示し、`新規タスク` への compact action を出す。
- Running task: spinner と active style を表示する。visible status label は表示しない。
- Archived exists: `アーカイブ済み` を neutral item として表示し、押すと archived list に遷移する。
- Archived empty: `アーカイブ済み` は disabled にせず、押すと empty archived list に遷移する。
- Health unavailable: running count は `--` ではなく `0` を表示し、icon に muted style を使う。

バリデーションとエラー:

- sidebar data fetch failure は main content を block しない。sidebar section 内に compact error fallback を表示し、header count は 0 として扱う。

検証:

- `pnpm --filter desktop exec vitest run test/app-shell.test.tsx` は、client mount 後の current date / time、running task が active run の実行対象時刻を表示すること、visible status label がないこと、`アーカイブ済み` と `プロジェクト` の DOM order、run breadcrumb、header count を検証する。
- UI を変更した場合は `agent-browser` で desktop width の `/projects/` と mobile drawer を開き、clock、task の時刻と名前が 2 行で表示されること、実行中 task に spinner だけが表示されること、navigation order、drawer close button との非重複、document の横 overflow がないことを確認する。

アクセシビリティ:

- sidebar clock は semantic な `time` element と machine-readable `dateTime` を持ち、decorative な minute update を live announcement にしない。
- icon-only toolbox item は visible tooltip または `aria-label` を持つ。
- active route は `aria-current="page"` を持つ。
- running spinner と next-run icon は decorative icon とし、visible text を増やさず icon wrapper の accessible name で状態を伝える。
- sidebar は user selection を無効化しても keyboard focus と screen reader navigation を妨げない。

セキュリティと安全性:

- `アーカイブ済み` は task を削除したことを意味しない。paused / stopped / completed one-shot を active schedule から外して表示するだけで、履歴は保持する。
- settings は bottom toolbox に残し、dangerous defaults や diagnostics は settings page 内で扱う。

受け入れ条件:

- desktop sidebar に `Clockhand` title section が表示されない。
- sidebar 先頭に現在の日付と24時間表記の時刻が表示され、時刻は分境界で更新される。
- `プロジェクト` は `アーカイブ済み` の直下に表示され、押すと `/projects` が開く。
- active recurring task が sidebar に複数重複表示されない。
- 各 scheduled task は 1 行目に label なしの `M/D HH:mm`、2 行目に task name を表示する。実行されていない task は `nextRunAt`、running task は active run の実行対象時刻を使い、running 状態は spinner のみで視覚的に判別できる。
- completed one-shot task と paused task は sidebar main section に表示されず、`アーカイブ済み` から一覧できる。
- header に `稼働中` badge と scheduler toggle が表示されない。
- header に breadcrumb が表示される。
- header は running count だけを icon + number で表示し、queued count を表示しない。
- mobile drawer の current time と close button は重ならない。
- sidebar の右側では page-level section、list、table、form、tab content に装飾目的の panel surface が表示されない。
