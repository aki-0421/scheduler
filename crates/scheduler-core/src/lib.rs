pub const APP_NAME: &str = "Codex Scheduler";

pub mod db;
pub mod error;
pub mod ipc;
pub mod model;
pub mod schedule;
pub mod settings;
pub mod time;
pub mod util;

pub use error::{Result, SchedulerError, ValidationError};
pub use model::enums::RunTargetMode as SchedulerMode;

pub fn crate_ready() -> bool {
    true
}
