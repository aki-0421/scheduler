# Codex Scheduler

Codex Scheduler は、ローカル Codex CLI 実行をスケジュールする macOS ファーストのデスクトップ scaffold です。このプロジェクトは `docs/spec/` の仕様に沿っており、Tauri v2 shell、Next.js static frontend、scheduler daemon、session CLI、共有 core、Codex runner の各 Rust crate で構成されています。

## 仕様

- `docs/spec/index.md` - 現在の実装ベース仕様セットの入口。
- `docs/spec/product-scope.md` - プロダクトの目的、ユーザー価値、MVP 境界。
- `docs/spec/architecture.md` - Tauri、Next.js、daemon、CLI、IPC、永続化のアーキテクチャ。
- `docs/spec/scheduling-and-execution.md` - スケジュール計算、daemon tick、runner 挙動、ログ、retry、cleanup。

## 開発

JavaScript 依存関係をインストールします。

```bash
pnpm install
```

開発中にデスクトップアプリを起動します。

```bash
pnpm --filter desktop tauri dev
```

デスクトップ frontend は開発時に `127.0.0.1:4317` を使います。これにより、Tauri が既定ポート上の無関係な Next.js server に接続することを避けます。

Tauri config は `codex-schedulerd` と `codex-schedule` を sidecar として bundle します。`pnpm --filter desktop tauri dev` と Tauri build は先に `pnpm sidecars:prepare` を実行し、これらの Rust binary を build して Tauri の target-triple suffix 付きで `apps/desktop/src-tauri/binaries/` にコピーします。

Rust test を実行します。

```bash
cargo test --workspace
```

workspace lint と package test を実行します。

```bash
pnpm lint
pnpm test
```

static frontend を build します。

```bash
pnpm --filter desktop build
```
