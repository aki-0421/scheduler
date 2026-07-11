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
- `crates/scheduler-core`: 共有 Rust data model、SQLite repository layer、migration、JSON-RPC contract、settings、ID、time utility、schedule engine。
- `crates/schedulerd`: scheduler daemon、Unix-domain-socket JSON-RPC server、run queue、retention cleanup、task audit handling、Codex executor bridge。
- `crates/codex-runner`: Codex CLI detection and invocation、prompt composition、workspace preparation、worktree handling、log capture、JSONL event extraction、environment redaction、timeout/cancel behavior、result normalization。
- `crates/schedule-cli`: human と scheduled Codex session 向けの `codex-schedule` command line interface。

## デスクトップアプリ

desktop frontend は Tauri 内で提供される static Next.js app である。開発中は `127.0.0.1:4317` で動作し、default port の無関係な Next server に誤って接続することを避ける。frontend は `@tauri-apps/api/core` 経由で Tauri command を呼び出す。開発や test で Tauri 内で動いていない場合は mock IPC に fallback する。

Tauri backend は daemon sidecar を管理する。

- override env var、現在の app executable と同じ directory、Tauri の bundled resource / executable path、development build path、または `PATH` から `codex-schedulerd` を探す。release `.app` では `Contents/MacOS` にある app executable の隣を最優先する。
- `--data-dir` と `--socket-path` を指定して daemon を起動する。
- transport failure を daemon respawn と command retry 1 回の signal として扱う。
- app shutdown 時に daemon process group を終了する。
- 主に daemon JSON-RPC method へ proxy する Tauri command を公開する。

## Daemon

`codex-schedulerd` は same-user local service である。app data directory 配下の Unix domain socket に bind し、migration を実行し、interrupted run を recover し、scheduler loop と retention cleanup loop を開始し、newline-delimited JSON-RPC request を受け付ける。

daemon socket は local control surface である。same-UID caller は、scheduled-run metadata と run-scoped token を提示しない限り local user として扱われる。scheduled Codex session の scheduler mutation restriction は capability check と task lock、project file isolation は run 固有 worktree によって enforcement される。Codex 自体は固定 full-access profile で実行する。

## 実行時パス

default app data directory は compatibility のため legacy product name を維持し、次を使う。

```text
~/Library/Application Support/Codex Scheduler
```

その root 配下の重要な file と directory:

- `scheduler.sqlite3`: SQLite database。
- `scheduler.sock`: daemon Unix socket。
- `logs/`: run ごとの log directory。
- `worktrees/<task-slug>/wt-<UUIDv7>`: taskごとに整理され、実行ごとに timestamp-ordered random name を持つ isolated Git worktree。
- `chat-workspaces/`: temporary chat-only workspace。

desktop backend は logs、worktrees、chat workspaces、registered project roots 配下の path だけを open する。

## Sidecar の packaging

Tauri config は 2 つの Rust sidecar を bundle する。

- `codex-schedulerd`
- `codex-schedule`

`pnpm sidecars:prepare` は Cargo `debug` profile、`pnpm sidecars:prepare:release` は Cargo `release` profile で binary を build し、target-triple suffix 付き executable を Tauri の `binaries/` directory にコピーする。Tauri dev は前者、Tauri build は後者を launch または packaging の前に実行する。repository root の同名 script は desktop package へ委譲する。

## 永続化

SQLite は task、run、project、audit record、capability token、setting、run metadata の source of truth である。repository layer は `sqlx`、file-backed database の WAL mode、foreign key、5 秒の busy timeout を使う。既存 file に pending migration を適用する前に、repository は database backup を作成する。

Run body data は database metadata と file に分かれる。

- DB row は status、timestamp、command metadata、tail、summary、artifact reference、counter を保存する。
- File は full stdout、stderr、Codex JSONL event、last message、command JSON、redacted environment JSON を保存する。
