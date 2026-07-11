---
title: アーキテクチャ
description: 実装済み Clockhand の process layout、crate、app shell、sidecar、storage、runtime path を説明する。
updated: 2026-07-11
read_when:
  - desktop shell、daemon process、sidecar packaging、Rust workspace、IPC、persistent runtime path を変更するとき。
  - UI、daemon、CLI、runner、SQLite database がどう接続されるか debug するとき。
---

# アーキテクチャ

Clockhand は、Next.js static frontend と Rust sidecar を持つ Tauri v2 desktop app である。app process は window を所有し、user action を proxy する。daemon は scheduling、persistence、run execution を所有する。session CLI は daemon と通信する独立 binary であり、scheduled Codex run のために `PATH` に置くことができる。

## ワークスペース構成

repository は pnpm と Cargo の workspace である。

- `apps/desktop`: Tauri v2 app、Next.js App Router frontend、shadcn-style UI primitive、Tailwind CSS、TypeScript IPC schema、Vitest test。
- `crates/scheduler-core`: 共有 Rust data model、SQLite repository layer、migration、JSON-RPC contract、platform data path / local transport adapter、settings、ID、time utility、schedule engine。
- `crates/schedulerd`: scheduler daemon、platform-local JSON-RPC server、run queue、retention cleanup、task audit handling、Codex executor bridge。
- `crates/codex-runner`: Codex CLI detection and invocation、prompt composition、workspace preparation、worktree handling、log capture、JSONL event extraction、environment redaction、timeout/cancel behavior、result normalization。
- `crates/schedule-cli`: human と scheduled Codex session 向けの `codex-schedule` command line interface。

## デスクトップアプリ

desktop frontend は Tauri 内で提供される static Next.js app である。開発中は `127.0.0.1:4317` で動作し、default port の無関係な Next server に誤って接続することを避ける。frontend は `@tauri-apps/api/core` 経由で Tauri command を呼び出す。開発や test で Tauri 内で動いていない場合は mock IPC に fallback する。

Tauri の初期 window は static export の `/projects/` を直接開く。root `/` も browser 用 fallback として `/projects/` へ client navigation する通常の static HTML を生成し、Next.js server redirect の `NEXT_REDIRECT` error payload を release bundle に含めてはならない。production build は `/`、`/projects`、`/tasks`、`/tasks/new`、`/runs`、`/settings` の各出力が Clockhand の HTML document であり、route 固有の描画 marker を持ち、Next.js error marker を含まないことを検証する。release QA は native app の初期 window がプロジェクト画面を描画することも確認する。

Tauri backend は daemon sidecar を管理する。

- override env var、現在の app executable と同じ directory、Tauri の bundled resource / executable path、development build path、または `PATH` から platform の executable suffix を付けた `codex-schedulerd` を探す。bundle 内では app executable の隣と `binaries` directory を優先する。
- `--data-dir` と `--socket-path` を指定して daemon を起動する。
- transport failure を daemon respawn と command retry 1 回の signal として扱う。
- app shutdown 時に macOS / Linux では daemon process group、Windows では daemon process tree を終了する。
- 主に daemon JSON-RPC method へ proxy する Tauri command を公開する。

## Daemon

`codex-schedulerd` は same-user local service である。macOS / Linux では app data directory 配下の Unix domain socket、Windows では data directory identity から導出した named pipe に bind する。migration を実行し、interrupted run を recover し、scheduler loop と retention cleanup loop を開始し、newline-delimited JSON-RPC request を受け付ける。

local endpoint は local control surface である。Unix socket は `0700` data directory 内の `0600` file、Windows named pipe は remote client 拒否と current-user-only DACL で保護する。その user の caller は、scheduled-run metadata と run-scoped token を提示しない限り local user として扱われる。scheduled Codex session の scheduler mutation restriction は capability check と task lock、project file isolation は run 固有 worktree によって enforcement される。Codex 自体は固定 full-access profile で実行する。

## 実行時パス

default app data directory は compatibility のため legacy product name `Codex Scheduler` を維持し、OS 標準の local application data root 下に置く。

```text
macOS   $HOME/Library/Application Support/Codex Scheduler
Windows %LOCALAPPDATA%\Codex Scheduler
Linux   $XDG_DATA_HOME/Codex Scheduler
```

Linux で `XDG_DATA_HOME` がない場合は `$HOME/.local/share/Codex Scheduler` を使う。desktop、daemon、CLI は `scheduler-core` の同じ resolver を使う。

その root 配下の重要な file と directory:

- `scheduler.sqlite3`: SQLite database。
- macOS / Linux の `scheduler.sock`、または Windows の path-derived named pipe: daemon local endpoint。
- `logs/`: run ごとの log directory。
- `worktrees/<task-slug>/wt-<UUIDv7>`: taskごとに整理され、実行ごとに timestamp-ordered random name を持つ isolated Git worktree。
- `chat-workspaces/`: temporary chat-only workspace。

desktop backend は logs、worktrees、chat workspaces、registered project roots 配下の path だけを open する。

## Sidecar の packaging

Tauri config は 2 つの Rust sidecar を bundle する。

- `codex-schedulerd`
- `codex-schedule`

`pnpm sidecars:prepare` は Cargo `debug` profile、`pnpm sidecars:prepare:release` は Cargo `release` profile で binary を build し、target-triple suffix と Windows の `.exe` suffix 付き executable を Tauri の `binaries/` directory にコピーする。Tauri dev は前者、Tauri build は後者を launch または packaging の前に実行する。repository root の同名 script は desktop package へ委譲する。`pnpm release:github` は target OS に応じて macOS app、Windows NSIS、Linux AppImage / deb を選び、binary architecture と checksum を検証する。

## 永続化

SQLite は task、run、project、audit record、capability token、setting、run metadata の source of truth である。repository layer は `sqlx`、file-backed database の WAL mode、foreign key、5 秒の busy timeout を使う。既存 file に pending migration を適用する前に、repository は database backup を作成する。

Run body data は database metadata と file に分かれる。

- DB row は status、timestamp、command metadata、tail、summary、artifact reference、counter を保存する。
- File は full stdout、stderr、Codex JSONL event、last message、command JSON、redacted environment JSON を保存する。
