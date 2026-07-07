pub const APP_NAME: &str = "Codex Scheduler";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SchedulerMode {
    Chat,
    RepoLocal,
    RepoWorktree,
}

#[derive(Debug, thiserror::Error)]
pub enum SchedulerError {
    #[error("scheduler scaffold is not implemented yet")]
    NotImplemented,
}

pub fn crate_ready() -> bool {
    true
}
