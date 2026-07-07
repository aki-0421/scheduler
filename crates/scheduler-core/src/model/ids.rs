use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum IdPrefix {
    Project,
    Task,
    Run,
    RunEvent,
    RunArtifact,
    TaskAuditEvent,
    ScheduleCapabilityToken,
}

impl IdPrefix {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Project => "proj",
            Self::Task => "task",
            Self::Run => "run",
            Self::RunEvent => "event",
            Self::RunArtifact => "artifact",
            Self::TaskAuditEvent => "audit",
            Self::ScheduleCapabilityToken => "token",
        }
    }
}

pub fn new_id(prefix: IdPrefix) -> String {
    format!("{}_{}", prefix.as_str(), Uuid::now_v7())
}

pub fn new_project_id() -> String {
    new_id(IdPrefix::Project)
}

pub fn new_task_id() -> String {
    new_id(IdPrefix::Task)
}

pub fn new_run_id() -> String {
    new_id(IdPrefix::Run)
}

pub fn new_run_event_id() -> String {
    new_id(IdPrefix::RunEvent)
}

pub fn new_run_artifact_id() -> String {
    new_id(IdPrefix::RunArtifact)
}

pub fn new_task_audit_event_id() -> String {
    new_id(IdPrefix::TaskAuditEvent)
}

pub fn new_schedule_capability_token_id() -> String {
    new_id(IdPrefix::ScheduleCapabilityToken)
}

pub fn has_prefix(id: &str, prefix: IdPrefix) -> bool {
    id.strip_prefix(prefix.as_str())
        .and_then(|suffix| suffix.strip_prefix('_'))
        .is_some()
}
