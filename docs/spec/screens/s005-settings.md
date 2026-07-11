---
title: S005 Settings
description: Settings screen の global scheduler、notification、Codex default、diagnostics control を定義する。
updated: 2026-07-11
read_when:
  - Settings page、settings key、scheduler default、notification default、diagnostics export、schema display を変更するとき。
---

# S005 Settings

ルート: `/settings`

目的: global scheduler behavior、desktop notification、Codex binary / model default、local diagnostics、schema visibility を設定する。

入口: `Settings` navigation item。

出口: save settings action と diagnostics export。

データ依存:

- settings form には frontend default 付きの `useSettings()` を使う。
- schema version には `useHealth()` を使う。
- local IPC endpoint と database path には `useDaemonDiagnostics()` の実値を使う。
- 各 setting の保存には `useSetSetting()` を使う。
- support bundle export には `ipcClient.diagnosticsExport()` を使う。

レイアウト領域:

- `設定` title を持つ header。header の文脈説明は title 右の `?` tooltip に置き、subtitle として常時表示しない。
- General section。section heading 直下の補足説明文は表示しない。
- Execution section。section heading 直下の補足説明文は表示しない。
- Diagnostics section。section heading 直下の補足説明文は表示しない。
- 各 settings section と setting row は page canvas に直接配置し、section 全体を rounded border、別背景、shadow、内側 padding を持つ panel で囲まない。section と row は separator で区切る。
- bottom の sticky save bar。

フィールドとコントロール:

- Scheduler switch は `scheduler.enabled` を control する。
- Notifications switch は `notifications.enabled` を control する。
- `Codex バイナリパスをカスタマイズ` checkbox は global control として配置する。未選択時は `PATH` 上の `codex` を使い、選択時だけ `runner.codex_path` input を表示する。保存した custom path はすべての task に共通適用し、task 固有 override は持たない。
- Default model select は `runner.default_model` を control し、Codex frontier model のみを選択肢として表示する。
- read-only local IPC endpoint と database path。endpoint は macOS / Linux の Unix socket または Windows named pipe である。
- schema version display。
- export diagnostics button。
- save settings button。

状態:

- form は settings query data から initialize され、query data が変わると reset される。
- settings mutation pending 中は save button が disabled になる。
- export pending 中は export diagnostics button が disabled になる。
- diagnostics export canceled は info toast を表示し、success は exported path を表示する。
- unknown schema version は `Unknown` を表示する。

バリデーションとエラー:

- Codex binary path customization を選択した場合、空の path は保存できない。
- save は既知の settings key をすべて送信し、すべての mutation 完了時に 1 つの success toast を表示する。
- save failure は settings error toast を表示し、query rollback は previous settings data を使う。
- diagnostics failure は diagnostics error toast を表示する。

アクセシビリティ:

- 各 editable setting は label と description を持つ。
- read-only local path は truncated monospace code block で表示される。
- sticky save action は長い settings page の bottom で reachable なままにする。

セキュリティと安全性:

- global concurrency、sandbox、approval policy、worktree cleanup、runtime、retry、overlap、missed-run、Scheduler CLI permission は app-wide の固定規則であり、Settings に表示しない。
- diagnostic export は user-initiated であり、local file に書き込む。
- local IPC endpoint と database path は daemon diagnostics が返す read-only display value である。

受け入れ条件:

- setting が変更され、Save settings が成功した場合、user は `Settings saved` を見る。
- setting save のいずれかが失敗した場合、user は error toast を見て、previous cached settings が restored される。
- diagnostics export が path を返した場合、その path は success toast に表示される。
- diagnostics export が canceled の場合、user は cancellation info toast を見る。
- settings section は page-level panel surface を持たず、separator と alignment でまとまりを判別できる。
- Settings に全体同時実行数の入力が表示されず、全体の run 数は制限されない。
- Codex binary path customization を選択すると path input が表示され、保存した global value がすべての task execution に使用される。未選択時は task execution ごとの `PATH` lookup を使う。
