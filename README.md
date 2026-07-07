# Codex Scheduler

Codex Scheduler is a macOS-first desktop scaffold for scheduling local Codex CLI runs. The project follows the MVP plan in `spec/10-implementation-plan.md` and uses a Tauri v2 shell, a Next.js static frontend, and Rust crates for the scheduler daemon, session CLI, shared core, and Codex runner.

## Specs

- `spec/00-overview.md` - product scope and MVP goals.
- `spec/02-architecture.md` - Tauri, Next.js, daemon, CLI, IPC, and storage architecture.
- `spec/10-implementation-plan.md` - milestone plan and recommended packages.

## Development

Install JavaScript dependencies:

```bash
pnpm install
```

Run the desktop app during development:

```bash
pnpm --filter desktop tauri dev
```

Run Rust tests:

```bash
cargo test --workspace
```

Run workspace lint and package tests:

```bash
pnpm lint
pnpm test
```

Build the static frontend:

```bash
pnpm --filter desktop build
```
