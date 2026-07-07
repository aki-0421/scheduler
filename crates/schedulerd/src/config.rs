use std::env;
use std::path::{Path, PathBuf};
use std::time::Duration;

use clap::Parser;
use tracing::level_filters::LevelFilter;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::fmt::writer::MakeWriterExt;

#[derive(Debug, Clone, Parser)]
#[command(name = "codex-schedulerd")]
#[command(about = "Codex Scheduler daemon")]
pub struct CliArgs {
    #[arg(long, env = "CODEX_SCHEDULER_DATA_DIR")]
    pub data_dir: Option<PathBuf>,

    #[arg(long, env = "CODEX_SCHEDULER_DB")]
    pub db_path: Option<PathBuf>,

    #[arg(long, env = "CODEX_SCHEDULER_SOCKET")]
    pub socket_path: Option<PathBuf>,

    #[arg(long, env = "CODEX_SCHEDULER_LOCK")]
    pub lock_path: Option<PathBuf>,

    #[arg(long, env = "CODEX_SCHEDULER_LOGS_DIR")]
    pub logs_dir: Option<PathBuf>,

    #[arg(long, env = "CODEX_SCHEDULER_LOG", default_value = "info")]
    pub log_level: String,

    #[arg(long, default_value_t = 60)]
    pub tick_interval_sec: u64,

    #[arg(long, default_value_t = 5)]
    pub due_grace_sec: u64,

    #[arg(long, default_value_t = 30)]
    pub shutdown_grace_sec: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    pub socket_path: PathBuf,
    pub lock_path: PathBuf,
    pub logs_dir: PathBuf,
    pub daemon_log_path: PathBuf,
}

impl AppPaths {
    pub fn default_data_dir() -> PathBuf {
        if let Some(home) = env::var_os("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("Codex Scheduler");
        }
        PathBuf::from(".").join("Codex Scheduler")
    }

    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        let data_dir = data_dir.into();
        Self {
            db_path: data_dir.join("scheduler.sqlite3"),
            socket_path: data_dir.join("scheduler.sock"),
            lock_path: data_dir.join("scheduler.lock"),
            logs_dir: data_dir.join("logs"),
            daemon_log_path: data_dir.join("logs").join("daemon.log"),
            data_dir,
        }
    }

    pub fn from_args(args: &CliArgs) -> Self {
        let data_dir = args.data_dir.clone().unwrap_or_else(Self::default_data_dir);
        let mut paths = Self::new(data_dir);
        if let Some(path) = &args.db_path {
            paths.db_path = path.clone();
        }
        if let Some(path) = &args.socket_path {
            paths.socket_path = path.clone();
        }
        if let Some(path) = &args.lock_path {
            paths.lock_path = path.clone();
        }
        if let Some(path) = &args.logs_dir {
            paths.logs_dir = path.clone();
            paths.daemon_log_path = path.join("daemon.log");
        }
        paths
    }

    pub fn ensure_dirs(&self) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.data_dir)?;
        set_private_dir_permissions(&self.data_dir)?;
        std::fs::create_dir_all(&self.logs_dir)?;
        set_private_dir_permissions(&self.logs_dir)?;
        if let Some(parent) = self.db_path.parent() {
            std::fs::create_dir_all(parent)?;
            set_private_dir_permissions(parent)?;
        }
        if let Some(parent) = self.socket_path.parent() {
            std::fs::create_dir_all(parent)?;
            set_private_dir_permissions(parent)?;
        }
        if let Some(parent) = self.lock_path.parent() {
            std::fs::create_dir_all(parent)?;
            set_private_dir_permissions(parent)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct DaemonConfig {
    pub paths: AppPaths,
    pub tick_interval: Duration,
    pub due_grace: Duration,
    pub shutdown_grace: Duration,
    pub max_catchup_runs: usize,
    pub version: String,
}

impl DaemonConfig {
    pub fn from_args(args: &CliArgs) -> Self {
        Self {
            paths: AppPaths::from_args(args),
            tick_interval: Duration::from_secs(args.tick_interval_sec),
            due_grace: Duration::from_secs(args.due_grace_sec),
            shutdown_grace: Duration::from_secs(args.shutdown_grace_sec),
            max_catchup_runs: scheduler_core::schedule::DEFAULT_MAX_CATCHUP_RUNS,
            version: env!("CARGO_PKG_VERSION").to_owned(),
        }
    }

    pub fn for_data_dir(data_dir: impl Into<PathBuf>) -> Self {
        Self {
            paths: AppPaths::new(data_dir),
            tick_interval: Duration::from_secs(60),
            due_grace: Duration::from_secs(5),
            shutdown_grace: Duration::from_secs(30),
            max_catchup_runs: scheduler_core::schedule::DEFAULT_MAX_CATCHUP_RUNS,
            version: env!("CARGO_PKG_VERSION").to_owned(),
        }
    }

    pub fn with_tick_interval(mut self, interval: Duration) -> Self {
        self.tick_interval = interval;
        self
    }

    pub fn with_due_grace(mut self, due_grace: Duration) -> Self {
        self.due_grace = due_grace;
        self
    }

    pub fn with_shutdown_grace(mut self, shutdown_grace: Duration) -> Self {
        self.shutdown_grace = shutdown_grace;
        self
    }
}

pub fn init_tracing(log_level: &str, paths: &AppPaths) -> anyhow::Result<WorkerGuard> {
    paths.ensure_dirs()?;
    let level = parse_level(log_level);
    let file_appender =
        tracing_appender::rolling::never(log_parent(&paths.daemon_log_path), "daemon.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    let writer = std::io::stderr.and(non_blocking);

    tracing_subscriber::fmt()
        .with_max_level(level)
        .with_writer(writer)
        .with_ansi(true)
        .try_init()
        .map_err(|err| anyhow::anyhow!(err.to_string()))?;

    Ok(guard)
}

fn parse_level(value: &str) -> LevelFilter {
    match value.to_ascii_lowercase().as_str() {
        "trace" => LevelFilter::TRACE,
        "debug" => LevelFilter::DEBUG,
        "warn" => LevelFilter::WARN,
        "error" => LevelFilter::ERROR,
        "off" => LevelFilter::OFF,
        _ => LevelFilter::INFO,
    }
}

fn log_parent(path: &Path) -> PathBuf {
    path.parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(unix)]
fn set_private_dir_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn set_private_dir_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}
