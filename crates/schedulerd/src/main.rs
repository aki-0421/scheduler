use std::sync::Arc;

use clap::Parser;
use schedulerd::lock::{LockAcquire, SingleInstanceLock};
use schedulerd::{init_tracing, start_daemon, CliArgs, DaemonConfig, MockExecutor};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = CliArgs::parse();
    let config = DaemonConfig::from_args(&args);
    let _log_guard = init_tracing(&args.log_level, &config.paths)?;

    let lock = match SingleInstanceLock::acquire(&config.paths).await? {
        LockAcquire::Acquired(lock) => lock,
        LockAcquire::AlreadyRunning => {
            tracing::info!("codex-schedulerd is already running");
            return Ok(());
        }
    };

    tracing::info!(
        app = scheduler_core::APP_NAME,
        service = schedulerd::service_name(),
        data_dir = %config.paths.data_dir.display(),
        "daemon starting"
    );

    let executor = Arc::new(MockExecutor::succeeding());
    let handle = start_daemon(config, executor).await?;
    wait_for_shutdown_signal().await;
    handle.shutdown().await;
    cleanup_lock(lock)?;

    tracing::info!("daemon stopped");
    Ok(())
}

async fn wait_for_shutdown_signal() {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
        }
    }

    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

fn cleanup_lock(lock: SingleInstanceLock) -> anyhow::Result<()> {
    lock.cleanup()?;
    Ok(())
}
