pub mod config;
pub mod daemon;
pub mod executor;
pub mod lock;
pub mod rpc;

pub use config::{init_tracing, AppPaths, CliArgs, DaemonConfig};
pub use daemon::{
    run_retention_cleanup, start_daemon, DaemonEvent, DaemonHandle, RetentionCleanupResult,
};
pub use executor::{
    CodexExecutor, ExecutionRequest, ExecutionResult, ExecutionStatus, MockBehavior, MockExecutor,
    RunExecutor,
};

pub fn service_name() -> &'static str {
    "codex-schedulerd"
}
