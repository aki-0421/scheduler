pub type Result<T> = std::result::Result<T, SchedulerError>;

#[derive(Debug, thiserror::Error)]
pub enum SchedulerError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("migration error: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("time parse error: {0}")]
    TimeParse(#[from] chrono::ParseError),

    #[error("validation error: {0}")]
    Validation(#[from] ValidationError),
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ValidationError {
    #[error("invalid {enum_name} value: {value}")]
    InvalidEnumValue {
        enum_name: &'static str,
        value: String,
    },

    #[error("kind='once' requires run_at")]
    MissingRunAt,

    #[error("kind='cron' requires cron_expr")]
    MissingCronExpr,

    #[error("project target requires project_id")]
    MissingTarget,

    #[error("target_mode='repo-worktree' requires a git project")]
    RepoWorktreeRequiresGitProject,

    #[error("project targets must use target_mode='repo-worktree'")]
    ProjectTargetRequiresWorktree,

    #[error("project target repo_path must match the registered git root")]
    ProjectTargetPathMismatch,

    #[error("idempotent run creation requires scheduled_for")]
    IdempotentRunRequiresScheduledFor,

    #[error("idempotent run creation is only for schedule or catchup triggers")]
    IdempotentRunRequiresScheduledTrigger,

    #[error("invalid timezone: {0}")]
    InvalidTimezone(String),

    #[error("invalid slug: {0}")]
    InvalidSlug(String),
}
