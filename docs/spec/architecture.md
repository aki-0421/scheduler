---
title: Architecture
description: Describes the implemented Codex Scheduler process layout, crates, app shell, sidecars, storage, and runtime paths.
updated: 2026-07-08
read_when:
  - Changing the desktop shell, daemon process, sidecar packaging, Rust workspace, IPC, or persistent runtime paths.
  - Debugging how the UI, daemon, CLI, runner, and SQLite database connect.
---

# Architecture

Codex Scheduler is a Tauri v2 desktop app with a Next.js static frontend and Rust sidecars. The app process owns the window and proxies user actions. The daemon owns scheduling, persistence, and run execution. The session CLI is a separate binary that talks to the daemon and can be placed on `PATH` for scheduled Codex runs.

## Workspace Layout

The repository is a pnpm and Cargo workspace:

- `apps/desktop`: Tauri v2 app, Next.js App Router frontend, shadcn-style UI primitives, Tailwind CSS, TypeScript IPC schemas, and Vitest tests.
- `crates/scheduler-core`: shared Rust data model, SQLite repository layer, migrations, JSON-RPC contracts, settings, IDs, time utilities, and schedule engine.
- `crates/schedulerd`: scheduler daemon, Unix-domain-socket JSON-RPC server, run queue, retention cleanup, task audit handling, and Codex executor bridge.
- `crates/codex-runner`: Codex CLI detection and invocation, prompt composition, workspace preparation, worktree handling, log capture, JSONL event extraction, environment redaction, timeout/cancel behavior, and result normalization.
- `crates/schedule-cli`: `codex-schedule` command line interface for humans and scheduled Codex sessions.

## Desktop App

The desktop frontend is a static Next.js app served inside Tauri. During development it runs on `127.0.0.1:4317`, avoiding accidental attachment to unrelated default-port Next servers. The frontend calls Tauri commands through `@tauri-apps/api/core`; when not running inside Tauri during development and tests, it falls back to mock IPC.

The Tauri backend manages the daemon sidecar:

- It locates `codex-schedulerd` from an override env var, bundled sidecar paths, development build paths, or `PATH`.
- It starts the daemon with `--data-dir` and `--socket-path`.
- It treats transport failures as a signal to respawn the daemon and retry the command once.
- It terminates the daemon process group on app shutdown.
- It exposes Tauri commands that mostly proxy to daemon JSON-RPC methods.

## Daemon

`codex-schedulerd` is a same-user local service. It binds a Unix domain socket under the app data directory, runs migrations, recovers interrupted runs, starts the scheduler loop, starts a retention cleanup loop, and accepts newline-delimited JSON-RPC requests.

The daemon's socket is a local control surface. Same-UID callers are treated as local users unless they present scheduled-run metadata and a run-scoped token. Restrictions for scheduled Codex sessions are enforced by capability checks, task configuration, and the runner sandbox.

## Runtime Paths

The default app data directory is:

```text
~/Library/Application Support/Codex Scheduler
```

Important files and directories under that root:

- `scheduler.sqlite3`: SQLite database.
- `scheduler.sock`: daemon Unix socket.
- `logs/`: per-run log directories.
- `worktrees/`: isolated Git worktrees.
- `chat-workspaces/`: temporary chat-only workspaces.

The desktop backend only opens paths that are under logs, worktrees, chat workspaces, or trusted project roots.

## Sidecar Packaging

The Tauri config bundles two Rust sidecars:

- `codex-schedulerd`
- `codex-schedule`

`pnpm sidecars:prepare` builds these binaries and copies target-triple-suffixed executables into the Tauri `binaries/` directory. Tauri dev and build flows run this preparation step before launching or packaging.

## Persistence

SQLite is the source of truth for tasks, runs, projects, audit records, capability tokens, settings, and run metadata. The repository layer uses `sqlx`, WAL mode for file-backed databases, foreign keys, and a 5-second busy timeout. Before applying pending migrations to an existing file, the repository creates a database backup.

Run body data is split between database metadata and files:

- DB rows store statuses, timestamps, command metadata, tails, summaries, artifact references, and counters.
- Files store full stdout, stderr, Codex JSONL events, last message, command JSON, and redacted environment JSON.

