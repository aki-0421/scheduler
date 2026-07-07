pub mod config;
pub mod daemon;
pub mod executor;
pub mod lock;
pub mod rpc;

pub use config::{init_tracing, AppPaths, CliArgs, DaemonConfig};
pub use daemon::{start_daemon, DaemonEvent, DaemonHandle};
pub use executor::{
    ExecutionRequest, ExecutionResult, ExecutionStatus, MockBehavior, MockExecutor, RunExecutor,
};

pub fn service_name() -> &'static str {
    "codex-schedulerd"
}
