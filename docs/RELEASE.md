---
title: リリース
description: Codex Scheduler の macOS 署名、notarization、sidecar bundle、release build 検証手順を定義する。
updated: 2026-07-08
read_when:
  - Codex Scheduler の macOS release build、署名、notarization、配布を行うとき。
  - Tauri sidecar binary の bundle や release artifact 検証を変更するとき。
---

# リリース

## macOS 署名と Notarization

Codex Scheduler は、Tauri desktop app と 2 つの sidecar binary を同梱する。

- `codex-schedulerd`
- `codex-schedule`

どちらの sidecar も `apps/desktop/src-tauri/tauri.conf.json` の `bundle.externalBin` で bundle される。これらは release artifact として扱う。同じ commit から build し、`pnpm sidecars:prepare` で期待される `binaries/` 配置にコピーし、最終的な app bundle が `.app` 全体と一緒に署名することを確認する。

### 前提条件

1. Apple Developer ID Application certificate を login keychain にインストールする。
2. identity が見えることを確認する。

```bash
security find-identity -v -p codesigning
```

3. `apps/desktop/src-tauri/tauri.conf.json` に Tauri macOS signing identity を設定する。

```json
"macOS": {
  "signingIdentity": "Developer ID Application: Your Company (TEAMID)",
  "providerShortName": "TEAMID"
}
```

ローカルの unsigned build では `signingIdentity` を `null` のままにする。

### Notarization 環境

release shell または CI secret store に次の環境変数を設定する。

```bash
export APPLE_ID="release@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
```

`APPLE_PASSWORD` には Apple ID account password ではなく、app-specific password を使う。

### Build Flow

repository root から実行する。

```bash
pnpm install
pnpm sidecars:prepare
pnpm --filter desktop tauri build
```

`bundle.macOS.signingIdentity` が設定されている場合、Tauri build は `.app` bundle を署名する。bundle される sidecar は `tauri build` の前に存在している必要がある。存在しない場合、最終 bundle が unsigned になったり、必要な executable を欠いたりする可能性がある。

build 後に app と sidecar を検証する。

```bash
codesign --verify --deep --strict --verbose=2 apps/desktop/src-tauri/target/release/bundle/macos/Codex\ Scheduler.app
spctl --assess --type execute --verbose apps/desktop/src-tauri/target/release/bundle/macos/Codex\ Scheduler.app
```

設定済みの Tauri release flow で notarization が自動実行されない場合は、同じ Apple ID、password、team ID を使って built archive を `xcrun notarytool` に submit し、配布前に app または DMG へ staple する。
