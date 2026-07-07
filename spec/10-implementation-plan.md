# 実装計画

## 1. MVP milestone

### M0: Repository scaffold

成果物:

- Tauri v2 + Next.js static export scaffold。
- shadcn/ui setup。
- Rust workspace setup。
- CI lint/test skeleton。

Tasks:

- `apps/desktop` を作成。
- `next.config` に static export を設定。
- Tauri `frontendDist` を Next.js `out` に向ける。
- `crates/scheduler-core`、`crates/schedulerd`、`crates/schedule-cli` を作成。

### M1: Data layer

成果物:

- SQLite schema v1。
- migration runner。
- repository layer。
- task CRUD tests。

Tasks:

- `projects`, `tasks`, `runs`, `run_events`, `audit_events`, `settings`。
- UTC/timezone utility。
- slug generator。
- JSON DTO。

### M2: Scheduler daemon

成果物:

- `codex-schedulerd` 起動。
- single-instance lock。
- health API。
- manual/once/cron next run calculation。
- due run enqueue。

Tests:

- cron every minute。
- once auto-complete。
- missed latest catch-up。
- overlap skip。

### M3: Codex runner

成果物:

- Codex binary detection。
- chat target execution。
- repo-local execution。
- repo-worktree setup。
- stdout/stderr/log capture。
- timeout/cancel。

Tests:

- dummy codex binary fixture で runner test。
- worktree branch creation。
- failure status capture。

### M4: `codex-schedule` CLI

成果物:

- create/list/show/update-current。
- JSON output。
- daemon socket client。
- SQLite fallback。
- run token validation。

Tests:

- create once。
- create cron。
- invalid cron。
- token capability denied。

### M5: Tauri backend integration

成果物:

- app 起動時 daemon start。
- Tauri commands proxy。
- notifications。
- open folder / folder picker。
- settings persistence。

### M6: UI MVP

成果物:

- Dashboard。
- Task list。
- New Task wizard。
- Task detail。
- Run detail。
- Settings。

### M7: Hardening

成果物:

- audit log UI。
- diagnostics export。
- data retention cleanup。
- security warnings。
- code signing/notarization path。

## 2. 推奨 package / crate

### Frontend

```json
{
  "dependencies": {
    "@tauri-apps/api": "latest",
    "next": "latest",
    "react": "latest",
    "react-dom": "latest",
    "zod": "latest",
    "@tanstack/react-query": "latest",
    "lucide-react": "latest",
    "class-variance-authority": "latest",
    "tailwind-merge": "latest"
  }
}
```

### Rust

```toml
[workspace.dependencies]
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
thiserror = "1"
uuid = { version = "1", features = ["v7", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
chrono-tz = "0.10"
sqlx = { version = "0.8", features = ["runtime-tokio", "sqlite", "chrono", "uuid"] }
clap = { version = "4", features = ["derive", "env"] }
tracing = "0.1"
tracing-subscriber = "0.3"
```

Cron crate は 5-field minute granularity と timezone/DST の挙動を検証したうえで選定する。

## 3. 初期 folder structure

```text
codex-scheduler/
  package.json
  pnpm-workspace.yaml
  Cargo.toml
  apps/
    desktop/
      app/
        page.tsx
        tasks/
        runs/
        projects/
        settings/
      components/
      lib/
      next.config.ts
      src-tauri/
        Cargo.toml
        tauri.conf.json
        src/
          main.rs
          commands.rs
  crates/
    scheduler-core/
      src/
        lib.rs
        db/
        model/
        schedule/
        audit.rs
    schedulerd/
      src/main.rs
    schedule-cli/
      src/main.rs
    codex-runner/
      src/lib.rs
  spec/
    *.md
```

## 4. Development commands

```bash
pnpm install
pnpm --filter desktop tauri dev
cargo test --workspace
pnpm lint
pnpm test
```

## 5. Test strategy

### Unit tests

- cron parsing。
- next run computation。
- missed run selection。
- slug generation。
- capability validation。
- command argv construction。

### Integration tests

- daemon health。
- task create → due enqueue。
- CLI create → daemon detects task。
- dummy Codex execution。
- worktree setup and cleanup。

### UI tests

- New task wizard。
- invalid cron validation。
- pause/resume。
- run detail log rendering。

## 6. Dummy Codex fixture

Codex CLI を直接 test で呼ばず、fixture binary を使う。

```bash
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "--version" ]]; then
  echo "codex 999.0.0-test"
  exit 0
fi
if [[ "$1" == "exec" ]]; then
  while IFS= read -r line; do
    echo "prompt: $line" >&2
  done
  echo '{"type":"message","content":"done"}'
  exit 0
fi
```

## 7. Release checklist

- [ ] macOS app icon。
- [ ] bundle sidecars。
- [ ] app sandbox entitlement strategy。
- [ ] code signing。
- [ ] notarization。
- [ ] auto-update は MVP では optional。
- [ ] diagnostics export redaction。
- [ ] onboarding flow。

## 8. Future roadmap

### R1: MCP schedule server

Codex や他 agent から MCP tool として schedule を作成できる。

### R2: Interactive permission UI

Scheduled run が承認を必要とする場合、UI に permission prompt を表示して run を継続できる。

### R3: Cloud/remote runner

Mac が off のときも実行できる remote runner。MVP のローカル scheduler とは別製品領域。

### R4: Natural language schedule parsing

UI/CLI で「明日 9 時」「毎週月曜」などを解釈し、保存前に絶対日時または cron を確認する。

### R5: Multi-run inbox intelligence

run result を自動分類し、findings / no findings / needs review を triage する。

## 9. 開発上の注意

- Tauri + Next.js は static export 前提のため、Next.js server-only 機能や API routes に依存しない。
- UI から OS/DB 操作を直接行わず、Tauri command 経由にする。
- daemon は UI なしでも動くよう設計する。
- Codex CLI flag は将来変わる可能性があるため compatibility layer を持つ。
- prompt や task name を shell command として扱わない。
