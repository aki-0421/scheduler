pub const SETTING_SCHEDULER_ENABLED: &str = "scheduler.enabled";
pub const SETTING_RUNNER_CODEX_PATH: &str = "runner.codex_path";

pub const SETTING_RETENTION_RUN_HISTORY_DAYS: &str = "retention.run_history_days";
pub const SETTING_RETENTION_SUCCEEDED_RUN_LOGS_DAYS: &str = "retention.succeeded_run_logs_days";
pub const SETTING_RETENTION_FAILED_RUN_LOGS_DAYS: &str = "retention.failed_run_logs_days";
pub const SETTING_RETENTION_CAPABILITY_TOKEN_DELETE_AFTER_HOURS: &str =
    "retention.capability_token_delete_after_hours";

pub const DEFAULT_RETENTION_RUN_HISTORY_DAYS: i64 = 90;
pub const DEFAULT_RETENTION_SUCCEEDED_RUN_LOGS_DAYS: i64 = 30;
pub const DEFAULT_RETENTION_FAILED_RUN_LOGS_DAYS: i64 = 180;
pub const DEFAULT_RETENTION_CAPABILITY_TOKEN_DELETE_AFTER_HOURS: i64 = 24;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetentionSettings {
    pub run_history_days: i64,
    pub succeeded_run_logs_days: i64,
    pub failed_run_logs_days: i64,
    pub capability_token_delete_after_hours: i64,
}

impl Default for RetentionSettings {
    fn default() -> Self {
        Self {
            run_history_days: DEFAULT_RETENTION_RUN_HISTORY_DAYS,
            succeeded_run_logs_days: DEFAULT_RETENTION_SUCCEEDED_RUN_LOGS_DAYS,
            failed_run_logs_days: DEFAULT_RETENTION_FAILED_RUN_LOGS_DAYS,
            capability_token_delete_after_hours:
                DEFAULT_RETENTION_CAPABILITY_TOKEN_DELETE_AFTER_HOURS,
        }
    }
}
