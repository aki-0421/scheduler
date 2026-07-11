---
title: リリース
description: Clockhand のクロスプラットフォーム build、tag 駆動 GitHub Release、artifact 検証、platform 署名への移行手順を定義する。
updated: 2026-07-11
read_when:
  - Clockhand の macOS、Windows、Linux release build または配布を行うとき。
  - GitHub Actions の release workflow、version tag、release asset を変更するとき。
  - Tauri sidecar binary、checksum、Developer ID、Authenticode、notarization を変更するとき。
---

# リリース

Clockhand は Tauri desktop app に次の sidecar binary を同梱する。

- `codex-schedulerd`
- `codex-schedule`

tag 駆動 release は次の 5 target、7 artifact、7 SHA-256 file を 1 つの GitHub Release で公開する。

| Target | Artifact |
| --- | --- |
| macOS Apple Silicon | `Clockhand-<version>-macos-arm64-adhoc.zip` |
| macOS Intel | `Clockhand-<version>-macos-x64-adhoc.zip` |
| Windows x64 | `Clockhand-<version>-windows-x64-setup.exe` |
| Linux x64 | `Clockhand-<version>-linux-x64.AppImage` / `.deb` |
| Linux arm64 | `Clockhand-<version>-linux-arm64.AppImage` / `.deb` |

対応範囲の契約は [プラットフォーム対応](spec/platform-support.md) を使う。Windows arm64 と RPM は現在の公開対象ではない。

## リリース受入条件

- desktop package、Tauri config、4 Rust package、desktop Rust package の version が一致する。tag はその version に `v` を付けた値である。
- tag の commit は `origin/main` に含まれる。
- 各 target の app と sidecar は同じ commit、Rust target triple、Cargo `release` profile から build する。
- frontend production build は全 static screen が Clockhand の HTML であり、`NEXT_REDIRECT` などの error payload でないことを bundle 作成前に検証する。
- packager は app main binary と両 sidecar の architecture を検証する。macOS では executable bit、bundle seal、ZIP 展開後の seal も検証する。
- 個々の artifact に `<artifact>.sha256` を付ける。
- publish job は 5 つの target manifest と 7 artifact / checksum pair を再検証する。一部でも欠けた場合は GitHub Release を作成しない。
- build job は `contents: read`、publish job だけが `contents: write` を使う。
- frontend / Rust の test、lint、audit、managed document lint が成功する。

## ローカル release build

repository root で実行する。

```bash
pnpm install --frozen-lockfile
pnpm release:github
```

script は `rustc -vV` の host triple を使う。同じ OS の別 architecture を build する場合は Rust target と native build 環境を準備し、次のように指定できる。cross-OS build は行わず、release workflow で native OS runner を使う。

```bash
TARGET_TRIPLE=x86_64-apple-darwin pnpm release:github
```

`pnpm release:github` は次を行う。

1. target に合わせた Cargo release sidecar を `apps/desktop/src-tauri/binaries/<name>-<target>[.exe]` へ準備する。
2. frontend production build と static screen verification を実行する。
3. macOS は Tauri app、Windows は NSIS、Linux は AppImage / deb を build する。
4. binary / bundle を検証し、normalized filename で `dist/` へ配置する。
5. artifact ごとの SHA-256 と `release-manifest-<target>.json` を生成する。

version の一致は単独でも検証できる。

```bash
node apps/desktop/scripts/verify-release-version.mjs v0.1.0
```

## タグ駆動 GitHub Release

通常の release は GitHub CLI から直接作成せず、`main` に含まれる release commit に version tag を付ける。version `0.1.0` の例:

```bash
git switch main
git pull --ff-only origin main
git tag -a v0.1.0 -m "Clockhand 0.1.0"
git push origin v0.1.0
```

`.github/workflows/release.yml` は次の順で進む。

1. tag commit が `origin/main` に含まれ、tag と全 package version が一致することを検証する。
2. `macos-latest` で Apple Silicon / Intel、`windows-2022` で x64、`ubuntu-22.04` で x64、公開 repository 向け `ubuntu-22.04-arm` で arm64 を build する。
3. target ごとの artifact、checksum、manifest を workflow artifact として保存する。
4. publish job がすべてを 1 directory に収集し、`verify-release-assets.mjs` で完全性と checksum を再検証する。
5. unsigned / ad-hoc の説明と platform 別の警告を含む 1 つの GitHub Release を作成する。

進行状況と結果:

```bash
gh run list --workflow release.yml --limit 5
gh release view v0.1.0
```

公開済み tag の付け替えや同名 asset の上書きは行わない。修正時は application version を上げ、新しい tag を発行する。

### 手動 fallback

workflow 障害の原因を確認し、各 native runner から集めた `release-assets/` に 5 manifest と完全な artifact set がある場合に限り手動公開する。

```bash
node apps/desktop/scripts/verify-release-assets.mjs release-assets 0.1.0
gh release create v0.1.0 release-assets/Clockhand-* \
  --title "Clockhand 0.1.0" \
  --verify-tag \
  --generate-notes
```

この command は外部状態を変更する。自動 workflow を使えない理由と完全な artifact verification が確認できるまで実行しない。

## Sidecar build contract

Tauri config の `bundle.externalBin` は `apps/desktop/src-tauri/binaries/` の target-triple suffix 付き binary を bundle する。

- `tauri dev`: `pnpm sidecars:prepare`、Cargo `debug` profile。
- `tauri build`: `pnpm sidecars:prepare:release`、Cargo `release` profile。
- Windows binary: Tauri suffix の後ろに `.exe` を付ける。

sidecar だけを準備する場合:

```bash
pnpm sidecars:prepare
pnpm sidecars:prepare:release
```

## 署名と利用者への案内

自動 workflow は secret を必要としない unsigned / ad-hoc build を作る。公開文で「署名済み」「公証済み」と表示しない。

### macOS

Tauri の ad-hoc identity `-` で app、sidecar、resource を seal する。これは developer identity の証明や notarization ではない。利用者には checksum 検証後、Finder で一度開き、`システム設定` → `プライバシーとセキュリティ` → `このまま開く` を使うよう案内する。`xattr` による quarantine 一括削除は標準手順にしない。

Gatekeeper の手動許可をなくす場合は Developer ID Application certificate と notarization credential を secret store から導入する。build 後は次を検証する。

```bash
codesign --verify --deep --strict --verbose=2 target/release/bundle/macos/Clockhand.app
spctl --assess --type execute --verbose target/release/bundle/macos/Clockhand.app
```

Tauri の自動 notarization を使わない場合は `xcrun notarytool` で submit し、配布前に ticket を staple する。

### Windows

NSIS installer は現在 Authenticode 未署名であり、SmartScreen の警告が表示される場合がある。警告をなくす場合は code-signing certificate を secret store から Windows build job に導入し、installer と必要な executable を timestamp 付きで署名し、公開前に signature verification を追加する。

### Linux

AppImage と Debian package は現在 repository signature を持たない。利用者は同梱 `.sha256` で file integrity を検証する。APT repository を提供する場合は package upload、repository metadata、signing key の lifecycle を別仕様で定義する。
