---
title: プラットフォーム対応
description: Clockhand の対応 OS / architecture、local IPC、runtime path、build、GitHub Release artifact の契約を定義する。
updated: 2026-07-11
read_when:
  - 対応 OS、architecture、local IPC、process control、runtime path を変更するとき。
  - Tauri bundle、sidecar target、CI matrix、GitHub Release asset を変更するとき。
---

# プラットフォーム対応

Clockhand の desktop app、scheduler daemon、CLI、Codex runner は同一ホスト上で動く。source tree は OS ごとに fork せず、共通の protocol / domain code と、小さな platform adapter で構成する。

## リリース対象

tag リリースは次の target を native runner 上で build する。

| OS | Architecture | Rust target | 公開 artifact |
| --- | --- | --- | --- |
| macOS | Apple Silicon | `aarch64-apple-darwin` | `.app.zip` |
| macOS | Intel | `x86_64-apple-darwin` | `.app.zip` |
| Windows | x64 | `x86_64-pc-windows-msvc` | NSIS installer `.exe` |
| Linux | x64 | `x86_64-unknown-linux-gnu` | `.AppImage` と `.deb` |
| Linux | arm64 | `aarch64-unknown-linux-gnu` | `.AppImage` と `.deb` |

すべての artifact に個別の `.sha256` を付ける。Git tag、desktop package version、Tauri version、Rust package version は一致しなければ release しない。Windows arm64、Linux の RPM 系 native package は現在の公開対象に含めない。

## Runtime path

database、log、token、lock は OS の local application data directory 下の `Codex Scheduler` directory に保存する。既存ユーザーと CLI contract の互換性のため directory 名は維持する。

- macOS: `$HOME/Library/Application Support/Codex Scheduler`
- Windows: `%LOCALAPPDATA%\Codex Scheduler`
- Linux: `$XDG_DATA_HOME/Codex Scheduler`。`XDG_DATA_HOME` がない場合は `$HOME/.local/share/Codex Scheduler`

desktop app、daemon、CLI は同じ path resolver を使う。test と明示的な daemon argument では data directory を override できる。

## Local IPC

JSON Lines の JSON-RPC 2.0 protocol は OS 間で共通とする。transport だけを切り替える。

- macOS / Linux: data directory 下の Unix domain socket `scheduler.sock`。file mode は owner-only の `0600`。
- Windows: data directory の canonical identity から導出する local named pipe。remote client を拒否し、DACL で作成 user にだけ full access を許可する。

endpoint の導出、connect retry、stream abstraction は `scheduler-core` に置き、desktop、daemon、CLI で重複実装しない。protocol の method、request / response schema、capability token は transport によって変えない。

## Process lifecycle

daemon と runner は child process が残らないように停止する。macOS / Linux は process group に signal を送り、Windows は child process tree を停止する。cancellation 後は必ず child の終了を回収し、run status と log を確定する。

## Build と CI

- CI は macOS、Windows、Linux の native runner で Rust workspace を compile / test する。frontend の lint、test、static export も別 job で検証する。
- sidecar は Tauri が build する target triple と同じ target / profile で build し、`binaries/<name>-<target-triple>[.exe]` として bundle する。
- release workflow は platform artifact をすべて build でき、checksum と期待する asset の組を検証できたときだけ、単一の GitHub Release を公開する。一部の platform build だけで release を公開しない。

## 署名の境界

現在の公開 workflow は secret なしで再現できる unsigned / ad-hoc build を作る。macOS の Developer ID signing / notarization、Windows Authenticode、Linux repository signing は認証情報を導入する別ステップであり、未設定時に署名済みと表示しない。
