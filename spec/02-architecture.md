# アーキテクチャ仕様

## 1. 全体構成

```text
┌────────────────────────────────────────────────────────────────────┐
│                       Codex Scheduler.app                          │
│                                                                    │
│  ┌──────────────────────┐     ┌────────────────────────────────┐   │
│  │ Next.js static UI     │     │ Tauri Rust backend              │   │
│  │ shadcn/ui             │◀───▶│ commands / notifications        │   │
│  └──────────────────────┘     └───────────────┬────────────────┘   │
│                                                │                    │
│                                                │ JSON-RPC / UDS     │
│                                                ▼                    │
│                                  ┌──────────────────────────────┐   │
│                                  │ codex-schedulerd             │   │
│                                  │ scheduler / queue / runner   │   │
│                                  └───────┬──────────────┬───────┘   │
│                                          │              │           │
│                                          │ SQLite       │ spawn     │
│                                          ▼              ▼           │
│                                  ┌────────────┐  ┌──────────────┐   │
│                                  │ local DB    │  │ codex exec    │   │
│                                  │ logs/files  │  │ Codex CLI     │   │
│                                  └────────────┘  └──────────────┘   │
└────────────────────────────────────────────────────────────────────┘

External CLI:

┌──────────────────┐         UDS / SQLite fallback        ┌────────────────┐
│ codex-schedule   │──────────────────────────────────────▶│ schedulerd / DB │
└──────────────────┘                                       └────────────────┘
```

## 2. 採用技術

### 2.1 Desktop shell

- Tauri v2。
- Rust backend。
- sidecar binary として `codex-schedulerd` と `codex-schedule` を bundle する。
- macOS first。Windows/Linux は将来拡張。

### 2.2 Frontend

- Next.js App Router。
- Tauri bundle 用に static export を前提にする。
- shadcn/ui をコンポーネント基盤にする。
- Tailwind CSS。
- UI state は TanStack Query または SWR で Tauri commands を query 化する。

### 2.3 Storage

- SQLite。
- Rust では `sqlx` または `rusqlite`。
- migration は `src-tauri/migrations/*.sql`。
- run log 本文はファイル保存し、DB は metadata と preview のみ。

### 2.4 Scheduling

- Rust daemon 内の scheduler loop。
- 5-field cron parser。
- timezone 計算は IANA timezone 対応の crate を使う。
- tick は 60 秒。起動直後と設定変更直後は即再計算。

### 2.5 Process execution

- Rust `tokio::process::Command` で `codex` を argv 配列起動。
- stdin に合成 prompt を渡す。
- stdout/stderr を async に stream してログファイルへ書き込む。
- kill/retry/timeout を daemon が管理する。

## 3. プロセス境界

### 3.1 Tauri app process

責務:

- UI window と menu bar。
- user command を backend 経由で daemon へ転送。
- macOS notification。
- folder picker / open in Finder / open terminal。
- 起動時に daemon を開始し、health check する。

非責務:

- 長時間 run の直接監視。
- cron 計算。
- Codex process の直接管理。

### 3.2 `codex-schedulerd`

責務:

- active task の next run 計算。
- due run の enqueue。
- concurrency control。
- Codex CLI process supervisor。
- run status 更新。
- missed run 処理。
- SQLite migration と lock。
- Unix domain socket API。

### 3.3 `codex-schedule`

責務:

- user または Codex セッションから task を作成・更新・照会する。
- machine-readable JSON を返す。
- scheduled session の capability token を検証する。
- daemon が不在でも必要最小限の create/update を DB に保存する。

## 4. IPC

### 4.1 UI → Tauri backend

Tauri command 例:

```ts
invoke('task_list', { filter })
invoke('task_create', { input })
invoke('task_update', { id, patch })
invoke('task_run_now', { id })
invoke('run_tail_log', { runId, stream: 'stdout', cursor })
invoke('project_trust', { path })
```

### 4.2 Tauri backend → daemon

Unix domain socket:

```text
~/Library/Application Support/Codex Scheduler/scheduler.sock
```

Protocol:

- JSON-RPC 2.0 over newline-delimited JSON。
- request/response は 1 行 1 JSON。
- streaming logs は cursor-based polling で MVP 実装。

例:

```json
{"jsonrpc":"2.0","id":"1","method":"task.list","params":{"status":"active"}}
```

### 4.3 CLI → daemon

CLI は次の順で接続する。

1. `CODEX_SCHEDULER_SOCKET` があればその socket。
2. default socket path。
3. socket 接続失敗時は SQLite direct-write fallback。

Fallback は create/update/list の一部に限定し、run now や log tail は daemon が必要。

## 5. ディレクトリ構成

```text
codex-scheduler/
  apps/
    desktop/                    # Next.js + Tauri app
      app/                       # Next.js App Router
      components/                # shadcn/ui components
      lib/
      src-tauri/
        src/
        tauri.conf.json
  crates/
    scheduler-core/              # domain model, scheduling, DB repository
    schedulerd/                  # daemon binary
    schedule-cli/                # codex-schedule binary
    codex-runner/                # Codex process supervisor
  spec/
    *.md
```

## 6. macOS データ配置

```text
~/Library/Application Support/Codex Scheduler/
  scheduler.sqlite3
  scheduler.sock
  logs/
    <run-id>/stdout.log
    <run-id>/stderr.log
    <run-id>/events.jsonl
    <run-id>/last-message.md
  worktrees/
    <task-slug>/<run-id>/
  chat-workspaces/
    <run-id>/
  tokens/
  tmp/
```

## 7. 起動シーケンス

```text
1. User launches Codex Scheduler.app
2. Tauri setup hook runs
3. Tauri checks whether schedulerd is already healthy
4. If not running, Tauri starts bundled codex-schedulerd sidecar
5. schedulerd obtains single-instance lock
6. schedulerd runs DB migration
7. schedulerd marks stale running runs as interrupted
8. schedulerd recomputes next_run_at for active tasks
9. schedulerd checks missed runs according to policy
10. UI renders dashboard
```

## 8. 終了シーケンス

MVP では、アプリ終了時に daemon も停止する。ただし menu bar 常駐を有効にした場合、window close では daemon を止めない。

```text
1. User quits app
2. Tauri sends daemon.shutdown
3. daemon stops accepting new runs
4. running Codex process receives SIGTERM
5. grace period 30 sec
6. still-running process receives SIGKILL
7. daemon closes SQLite and lock
```

将来の LaunchAgent モードでは、GUI 終了後も daemon を維持できる。

## 9. エラー境界

| 境界 | エラー | 処理 |
| --- | --- | --- |
| UI → Tauri | invoke failure | toast + retry |
| Tauri → daemon | socket unavailable | daemon restart attempt |
| daemon → SQLite | migration/lock failure | fatal notification |
| daemon → Codex CLI | binary not found | task run failed + onboarding CTA |
| Codex CLI | non-zero exit | run failed + stderr preview |
| Git worktree | add failed | run failed before Codex start |

## 10. 拡張ポイント

- MCP server として schedule tool を提供。
- Webhook trigger。
- GitHub issue/PR trigger。
- Cloud worker 実行。
- Anthropic Claude Code や他 CLI への runner plugin。
