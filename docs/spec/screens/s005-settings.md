---
title: S005 Settings
description: Settings screen の global scheduler、notification、execution default、permission default、diagnostics control を定義する。
updated: 2026-07-09
read_when:
  - Settings page、settings key、scheduler default、notification default、diagnostics export、schema display を変更するとき。
---

# S005 Settings

ルート: `/settings`

目的: global scheduler behavior、desktop notification、Codex execution default、permission default、local diagnostics、schema visibility を設定する。

入口: `Settings` navigation item。

出口: save settings action と diagnostics export。

データ依存:

- settings form には frontend default 付きの `useSettings()` を使う。
- schema version には `useHealth()` を使う。
- 各 setting の保存には `useSetSetting()` を使う。
- support bundle export には `ipcClient.diagnosticsExport()` を使う。

レイアウト領域:

- `設定` title を持つ header。header の文脈説明は title 右の `?` tooltip に置き、subtitle として常時表示しない。
- General section。section heading 直下の補足説明文は表示しない。
- Execution section。section heading 直下の補足説明文は表示しない。
- Permissions section。section heading 直下の補足説明文は表示しない。
- Diagnostics section。section heading 直下の補足説明文は表示しない。
- bottom の sticky save bar。

フィールドとコントロール:

- Scheduler switch は `scheduler.enabled` を control する。
- Notifications switch は `notifications.enabled` を control する。
- Global concurrency number input は `daemon.global_concurrency` を control する。
- Codex path input は `runner.codex_path` を control する。
- Default model select は `runner.default_model` を control し、Codex frontier model のみを選択肢として表示する。
- Default sandbox select は `runner.default_sandbox_mode` を control する。
- Default approval policy select は `runner.default_approval_policy` を control する。
- Worktree cleanup select は `worktree.default_cleanup_policy` を control する。
- read-only socket path と database path。
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

- global concurrency は input minimum `1` を持つ。
- save は既知の settings key をすべて送信し、すべての mutation 完了時に 1 つの success toast を表示する。
- save failure は settings error toast を表示し、query rollback は previous settings data を使う。
- diagnostics failure は diagnostics error toast を表示する。

アクセシビリティ:

- 各 editable setting は label と description を持つ。
- read-only local path は truncated monospace code block で表示される。
- sticky save action は長い settings page の bottom で reachable なままにする。

セキュリティと安全性:

- permission default は general setting とは別に group 化される。
- diagnostic export は user-initiated であり、local file に書き込む。
- socket path と database path は read-only display value である。

受け入れ条件:

- setting が変更され、Save settings が成功した場合、user は `Settings saved` を見る。
- setting save のいずれかが失敗した場合、user は error toast を見て、previous cached settings が restored される。
- diagnostics export が path を返した場合、その path は success toast に表示される。
- diagnostics export が canceled の場合、user は cancellation info toast を見る。

既知の gap:

- frontend が表示する一部の setting は、initial migration で seed されていない場合も default である。
