---
title: リリース
description: Clockhand の GitHub Releases 向け ad-hoc 署名配布、Developer ID 署名、notarization、sidecar bundle、release build 検証手順を定義する。
updated: 2026-07-11
read_when:
  - Clockhand の macOS release build、署名、notarization、配布を行うとき。
  - Tauri sidecar binary の bundle や release artifact 検証を変更するとき。
---

# リリース

Clockhand は Tauri desktop app と、次の 2 つの sidecar binary を 1 つの `.app` に同梱する。

- `codex-schedulerd`
- `codex-schedule`

GitHub Releases への upload 自体に Apple Developer ID 署名は必須ではない。ただし Apple Silicon では browser から download した app に code signature が必要なため、証明書を使わない Tauri の ad-hoc identity `-` で bundle 全体を署名する。ad-hoc signature は developer identity の証明や notarization ではなく、利用者は Gatekeeper で明示的に実行を許可する必要がある。この repository では、まず ad-hoc 署名の GitHub 配布をサポートし、警告なしで開ける配布が必要になった時点で Developer ID 署名・公証へ移行する。

## リリース受入条件

release artifact は、次をすべて満たす必要がある。

- repository root の `pnpm release:github` だけで release build と配布用 ZIP 作成が完了する。
- sidecar は Cargo の `release` profile で同じ commit から build され、`.app/Contents/MacOS/` に実行可能 file として含まれる。
- `Clockhand.app` を起動すると bundled `codex-schedulerd` を発見でき、初期 window が表示される。
- `dist/` に architecture と `adhoc` を明示した ZIP と、その SHA-256 file が生成される。
- ad-hoc 署名版の release note は Gatekeeper の手動許可手順と SHA-256 検証方法を案内する。
- frontend / Rust の test、lint、production dependency audit、documentation lint が成功する。

## GitHub Releases 向け ad-hoc 署名配布

repository root で実行する。

```bash
pnpm install --frozen-lockfile
pnpm release:github
```

`pnpm release:github` は Tauri release build を行い、`target/release/bundle/macos/Clockhand.app` を macOS の bundle metadata を保つ ZIP に格納する。Apple Silicon Mac で version `0.1.0` を build した場合の出力例:

```text
dist/Clockhand-0.1.0-macos-arm64-adhoc.zip
dist/Clockhand-0.1.0-macos-arm64-adhoc.zip.sha256
```

upload 前に bundle seal と checksum を検証する。

```bash
codesign --verify --deep --strict --verbose=2 target/release/bundle/macos/Clockhand.app
cd dist
shasum -a 256 -c Clockhand-0.1.0-macos-arm64-adhoc.zip.sha256
```

ad-hoc build に対する `spctl --assess` の `rejected` は developer identity と notarization がないことを示す期待結果であり、bundle seal の失敗とは区別する。bundle integrity は上記の `codesign --verify` で判定する。

GitHub CLI で release を作成する場合は、version と architecture が一致する 2 file を添付する。

```bash
gh release create v0.1.0 \
  dist/Clockhand-0.1.0-macos-arm64-adhoc.zip \
  dist/Clockhand-0.1.0-macos-arm64-adhoc.zip.sha256 \
  --title "Clockhand 0.1.0" \
  --verify-tag \
  --generate-notes \
  --notes "ad-hoc 署名版です。初回起動時は以下の Gatekeeper 手順と SHA-256 を確認してください。"
```

この command は外部状態を変更するため、artifact のローカル検証が完了するまで実行しない。

### 利用者向け Gatekeeper 手順

ad-hoc 署名版を初めて開く場合は、ZIP と同じ release にある SHA-256 を照合したうえで次の手順を案内する。

1. Finder で `Clockhand.app` を開き、macOS の警告を確認する。
2. `システム設定` → `プライバシーとセキュリティ` を開く。
3. Security section の `このまま開く` を選び、もう一度 `開く` を選ぶ。

Apple は、未公証または未確認 developer の app を開く手動 override には risk があると案内している。release note では `xattr` による quarantine の一括削除を標準手順にせず、macOS の確認 UI を使う。

## Sidecar build

Tauri config の `bundle.externalBin` は `apps/desktop/src-tauri/binaries/` の target-triple suffix 付き binary を bundle する。

- `tauri dev` は `pnpm sidecars:prepare` を使い、Cargo `debug` profile の sidecar を準備する。
- `tauri build` は `pnpm sidecars:prepare:release` を使い、Cargo `release` profile の sidecar を準備する。

sidecar だけを repository root から準備する場合:

```bash
pnpm sidecars:prepare
pnpm sidecars:prepare:release
```

## Developer ID 署名と Notarization

Gatekeeper の手動許可なしで配布する場合は、Apple Developer Program の Developer ID Application certificate と notarization を使う。

1. certificate を login keychain に install し、identity を確認する。

```bash
security find-identity -v -p codesigning
```

2. `apps/desktop/src-tauri/tauri.conf.json` の `bundle.macOS` に signing identity と team ID を設定する。ad-hoc build では `signingIdentity` を `-`、`providerShortName` を `null` にする。

```json
"macOS": {
  "signingIdentity": "Developer ID Application: Your Company (TEAMID)",
  "providerShortName": "TEAMID"
}
```

3. release shell または CI secret store に notarization 用 credential を設定する。

```bash
export APPLE_ID="release@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
```

`APPLE_PASSWORD` には Apple ID account password ではなく app-specific password を使う。build 後は repository root の artifact path を検証する。

```bash
codesign --verify --deep --strict --verbose=2 target/release/bundle/macos/Clockhand.app
spctl --assess --type execute --verbose target/release/bundle/macos/Clockhand.app
```

Tauri release flow で notarization が自動実行されない場合は、built ZIP、PKG、または DMG を `xcrun notarytool` に submit し、配布前に app または disk image へ ticket を staple する。
