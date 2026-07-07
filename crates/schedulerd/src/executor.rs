use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use scheduler_core::model::{Run, Task};
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex, Notify};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone)]
pub struct ExecutionRequest {
    pub run: Run,
    pub task: Task,
    pub stdout_log_path: PathBuf,
    pub stderr_log_path: PathBuf,
    pub events_jsonl_path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutionStatus {
    Succeeded,
    Failed,
    TimedOut,
    Canceled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionResult {
    pub status: ExecutionStatus,
    pub exit_code: Option<i64>,
    pub signal: Option<String>,
    pub stdout_tail: Option<String>,
    pub stderr_tail: Option<String>,
    pub result_summary: Option<String>,
}

impl ExecutionResult {
    pub fn succeeded() -> Self {
        Self {
            status: ExecutionStatus::Succeeded,
            exit_code: Some(0),
            signal: None,
            stdout_tail: Some("mock stdout\n".to_owned()),
            stderr_tail: None,
            result_summary: Some("mock execution succeeded".to_owned()),
        }
    }

    pub fn failed() -> Self {
        Self {
            status: ExecutionStatus::Failed,
            exit_code: Some(1),
            signal: None,
            stdout_tail: None,
            stderr_tail: Some("mock stderr\n".to_owned()),
            result_summary: Some("mock execution failed".to_owned()),
        }
    }

    pub fn timed_out() -> Self {
        Self {
            status: ExecutionStatus::TimedOut,
            exit_code: None,
            signal: Some("SIGTERM".to_owned()),
            stdout_tail: None,
            stderr_tail: Some("mock execution timed out\n".to_owned()),
            result_summary: Some("mock execution timed out".to_owned()),
        }
    }

    pub fn canceled() -> Self {
        Self {
            status: ExecutionStatus::Canceled,
            exit_code: None,
            signal: Some("SIGTERM".to_owned()),
            stdout_tail: None,
            stderr_tail: Some("mock execution canceled\n".to_owned()),
            result_summary: Some("mock execution canceled".to_owned()),
        }
    }
}

#[async_trait]
pub trait RunExecutor: Send + Sync + 'static {
    async fn execute(
        &self,
        request: ExecutionRequest,
        cancel: CancellationToken,
    ) -> ExecutionResult;
}

#[derive(Debug, Clone)]
pub struct MockBehavior {
    pub delay: Duration,
    pub result: ExecutionResult,
    pub hold_until_cancel: bool,
}

impl MockBehavior {
    pub fn succeed_after(delay: Duration) -> Self {
        Self {
            delay,
            result: ExecutionResult::succeeded(),
            hold_until_cancel: false,
        }
    }

    pub fn fail_after(delay: Duration) -> Self {
        Self {
            delay,
            result: ExecutionResult::failed(),
            hold_until_cancel: false,
        }
    }

    pub fn hold_until_cancel() -> Self {
        Self {
            delay: Duration::from_secs(0),
            result: ExecutionResult::canceled(),
            hold_until_cancel: true,
        }
    }
}

impl Default for MockBehavior {
    fn default() -> Self {
        Self::succeed_after(Duration::from_millis(10))
    }
}

#[derive(Debug, Default)]
struct MockState {
    calls: Vec<ExecutionRequest>,
}

#[derive(Debug, Clone)]
pub struct MockExecutor {
    behavior: MockBehavior,
    state: Arc<Mutex<MockState>>,
    notify: Arc<Notify>,
}

impl MockExecutor {
    pub fn new(behavior: MockBehavior) -> Self {
        Self {
            behavior,
            state: Arc::new(Mutex::new(MockState::default())),
            notify: Arc::new(Notify::new()),
        }
    }

    pub fn succeeding() -> Self {
        Self::new(MockBehavior::default())
    }

    pub async fn calls(&self) -> Vec<ExecutionRequest> {
        self.state.lock().await.calls.clone()
    }

    pub async fn wait_for_calls(&self, count: usize, timeout: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if self.state.lock().await.calls.len() >= count {
                return true;
            }
            let now = tokio::time::Instant::now();
            if now >= deadline {
                return false;
            }
            let remaining = deadline - now;
            if tokio::time::timeout(remaining, self.notify.notified())
                .await
                .is_err()
            {
                return false;
            }
        }
    }
}

#[async_trait]
impl RunExecutor for MockExecutor {
    async fn execute(
        &self,
        request: ExecutionRequest,
        cancel: CancellationToken,
    ) -> ExecutionResult {
        {
            let mut state = self.state.lock().await;
            state.calls.push(request.clone());
        }
        self.notify.notify_waiters();

        let _ = write_mock_logs(&request, &self.behavior.result).await;

        if self.behavior.hold_until_cancel {
            cancel.cancelled().await;
            return ExecutionResult::canceled();
        }

        tokio::select! {
            () = cancel.cancelled() => ExecutionResult::canceled(),
            () = tokio::time::sleep(self.behavior.delay) => self.behavior.result.clone(),
        }
    }
}

async fn write_mock_logs(
    request: &ExecutionRequest,
    result: &ExecutionResult,
) -> std::io::Result<()> {
    if let Some(parent) = request.stdout_log_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    if let Some(parent) = request.stderr_log_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let mut stdout = tokio::fs::File::create(&request.stdout_log_path).await?;
    if let Some(tail) = &result.stdout_tail {
        stdout.write_all(tail.as_bytes()).await?;
    }

    let mut stderr = tokio::fs::File::create(&request.stderr_log_path).await?;
    if let Some(tail) = &result.stderr_tail {
        stderr.write_all(tail.as_bytes()).await?;
    }

    Ok(())
}
