use sqlx::migrate::Migrator;

pub const SCHEMA_VERSION: i64 = 1;
pub const CANONICAL_MIGRATIONS_DIR: &str = "crates/scheduler-core/migrations";

pub static MIGRATOR: Migrator = sqlx::migrate!("./migrations");
