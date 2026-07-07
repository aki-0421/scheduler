# Database migrations

Canonical SQLite migrations live in `crates/scheduler-core/migrations` and are
embedded by `scheduler-core` with `sqlx::migrate!`.

The desktop Tauri backend, daemon, and CLI must call the scheduler-core
migration runner so all binaries apply the exact same forward-only schema.
