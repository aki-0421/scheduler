use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sqlx::error::BoxDynError;
use sqlx::{Decode, Encode, Sqlite, Type};

use crate::ValidationError;

macro_rules! scheduler_text_enum {
    (
        $(#[$meta:meta])*
        pub enum $name:ident {
            $($variant:ident => $value:literal),+ $(,)?
        }
    ) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum $name {
            $($variant),+
        }

        impl $name {
            pub const fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $value),+
                }
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl FromStr for $name {
            type Err = ValidationError;

            fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
                match value {
                    $($value => Ok(Self::$variant),)+
                    _ => Err(ValidationError::InvalidEnumValue {
                        enum_name: stringify!($name),
                        value: value.to_owned(),
                    }),
                }
            }
        }

        impl Serialize for $name {
            fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
            where
                S: Serializer,
            {
                serializer.serialize_str(self.as_str())
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                let value = String::deserialize(deserializer)?;
                Self::from_str(&value).map_err(serde::de::Error::custom)
            }
        }

        impl Type<Sqlite> for $name {
            fn type_info() -> <Sqlite as sqlx::Database>::TypeInfo {
                <String as Type<Sqlite>>::type_info()
            }

            fn compatible(ty: &<Sqlite as sqlx::Database>::TypeInfo) -> bool {
                <String as Type<Sqlite>>::compatible(ty)
            }
        }

        impl<'q> Encode<'q, Sqlite> for $name {
            fn encode_by_ref(
                &self,
                buf: &mut <Sqlite as sqlx::Database>::ArgumentBuffer<'q>,
            ) -> std::result::Result<sqlx::encode::IsNull, BoxDynError> {
                <String as Encode<Sqlite>>::encode(self.as_str().to_owned(), buf)
            }

            fn size_hint(&self) -> usize {
                self.as_str().len()
            }
        }

        impl<'r> Decode<'r, Sqlite> for $name {
            fn decode(
                value: <Sqlite as sqlx::Database>::ValueRef<'r>,
            ) -> std::result::Result<Self, BoxDynError> {
                let value = <String as Decode<Sqlite>>::decode(value)?;
                Self::from_str(&value).map_err(|err| -> BoxDynError { Box::new(err) })
            }
        }
    };
}

scheduler_text_enum! {
    pub enum TaskKind {
        Manual => "manual",
        Once => "once",
        Cron => "cron",
    }
}

scheduler_text_enum! {
    pub enum TaskStatus {
        Active => "active",
        Paused => "paused",
        Completed => "completed",
        Deleted => "deleted",
    }
}

scheduler_text_enum! {
    pub enum ScheduleStatus {
        Valid => "valid",
        Invalid => "invalid",
    }
}

scheduler_text_enum! {
    pub enum TriggerType {
        Schedule => "schedule",
        Manual => "manual",
        Cli => "cli",
        Catchup => "catchup",
        Retry => "retry",
    }
}

scheduler_text_enum! {
    pub enum RunStatus {
        Queued => "queued",
        Starting => "starting",
        Running => "running",
        Succeeded => "succeeded",
        Failed => "failed",
        Canceled => "canceled",
        Skipped => "skipped",
        Interrupted => "interrupted",
        TimedOut => "timed_out",
    }
}

scheduler_text_enum! {
    pub enum RunTargetMode {
        Chat => "chat",
        RepoLocal => "repo-local",
        RepoWorktree => "repo-worktree",
    }
}

scheduler_text_enum! {
    pub enum SandboxMode {
        ReadOnly => "read-only",
        WorkspaceWrite => "workspace-write",
        DangerFullAccess => "danger-full-access",
    }
}

scheduler_text_enum! {
    pub enum ApprovalPolicy {
        Never => "never",
        OnRequest => "on-request",
        Untrusted => "untrusted",
    }
}

scheduler_text_enum! {
    pub enum MissedPolicy {
        Skip => "skip",
        LatestWithinWindow => "latest_within_window",
        RunAllCapped => "run_all_capped",
    }
}

scheduler_text_enum! {
    pub enum OverlapPolicy {
        Skip => "skip",
        Queue => "queue",
        CancelPrevious => "cancel_previous",
    }
}

scheduler_text_enum! {
    pub enum CleanupPolicy {
        Keep => "keep",
        DeleteOnSuccess => "delete_on_success",
        DeleteAfterDays => "delete_after_days",
    }
}

scheduler_text_enum! {
    pub enum ProjectKind {
        Git => "git",
        Folder => "folder",
    }
}

scheduler_text_enum! {
    pub enum RunEventSource {
        Daemon => "daemon",
        CodexJsonl => "codex-jsonl",
        Stdout => "stdout",
        Stderr => "stderr",
    }
}

scheduler_text_enum! {
    pub enum RunArtifactKind {
        File => "file",
        Diff => "diff",
        Patch => "patch",
        Log => "log",
        LastMessage => "last-message",
        Worktree => "worktree",
    }
}

scheduler_text_enum! {
    pub enum AuditActorType {
        User => "user",
        Daemon => "daemon",
        Cli => "cli",
        ScheduledRun => "scheduled-run",
    }
}

impl Default for TaskStatus {
    fn default() -> Self {
        Self::Active
    }
}

impl Default for ScheduleStatus {
    fn default() -> Self {
        Self::Valid
    }
}

impl Default for RunStatus {
    fn default() -> Self {
        Self::Queued
    }
}

impl Default for RunTargetMode {
    fn default() -> Self {
        Self::Chat
    }
}

impl Default for SandboxMode {
    fn default() -> Self {
        Self::ReadOnly
    }
}

impl Default for ApprovalPolicy {
    fn default() -> Self {
        Self::Never
    }
}

impl Default for MissedPolicy {
    fn default() -> Self {
        Self::LatestWithinWindow
    }
}

impl Default for OverlapPolicy {
    fn default() -> Self {
        Self::Skip
    }
}

impl Default for CleanupPolicy {
    fn default() -> Self {
        Self::Keep
    }
}
