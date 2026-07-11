use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use fs2::FileExt;
use scheduler_core::db::migrations::SCHEMA_VERSION;
use scheduler_core::ipc::{daemon_compatibility, DaemonCompatibility, DaemonHealthResult};
use scheduler_core::time::now_rfc3339;
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::config::AppPaths;
use crate::rpc;

const REPLACEMENT_GRACE_TIMEOUT: Duration = Duration::from_secs(35);
const REPLACEMENT_FORCE_TIMEOUT: Duration = Duration::from_secs(5);
const REPLACEMENT_POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug)]
pub enum LockAcquire {
    Acquired(SingleInstanceLock),
    AlreadyRunning,
}

#[derive(Debug)]
pub struct SingleInstanceLock {
    file: File,
    path: PathBuf,
}

impl SingleInstanceLock {
    pub async fn acquire(paths: &AppPaths) -> anyhow::Result<LockAcquire> {
        paths.ensure_dirs()?;
        match Self::try_lock_file(paths) {
            Ok(lock) => Ok(LockAcquire::Acquired(lock)),
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                if let Ok(health) = rpc::health_check(&paths.socket_path).await {
                    return match daemon_compatibility(
                        &health,
                        env!("CARGO_PKG_VERSION"),
                        SCHEMA_VERSION,
                    ) {
                        DaemonCompatibility::Compatible => Ok(LockAcquire::AlreadyRunning),
                        DaemonCompatibility::Older | DaemonCompatibility::Unhealthy => {
                            Self::replace_incompatible_lock_holder(paths, &health).await
                        }
                        DaemonCompatibility::Newer => anyhow::bail!(
                            "refusing to replace newer codex-schedulerd {} (schema {}) with {} (schema {})",
                            health.version,
                            health.db_schema_version,
                            env!("CARGO_PKG_VERSION"),
                            SCHEMA_VERSION
                        ),
                        DaemonCompatibility::UnknownVersion => anyhow::bail!(
                            "cannot safely compare codex-schedulerd version {} with {}",
                            health.version,
                            env!("CARGO_PKG_VERSION")
                        ),
                    };
                }

                let metadata = read_lock_metadata(&paths.lock_path).ok().flatten();
                let pid = metadata.as_ref().map(|metadata| metadata.pid);
                if pid.map(pid_exists).unwrap_or(false) {
                    warn!(
                        pid = pid,
                        socket = metadata
                            .as_ref()
                            .map(|metadata| metadata.socket_path.as_str())
                            .unwrap_or("<unknown>"),
                        started_at = metadata
                            .as_ref()
                            .map(|metadata| metadata.started_at.as_str())
                            .unwrap_or("<unknown>"),
                        "lock holder did not answer health check; refusing to steal live lock"
                    );
                    anyhow::bail!(
                        "another codex-schedulerd process holds lock at {} but health check failed",
                        paths.lock_path.display()
                    );
                }

                let _ = std::fs::remove_file(&paths.lock_path);
                Ok(LockAcquire::Acquired(Self::try_lock_file(paths)?))
            }
            Err(err) => Err(err.into()),
        }
    }

    async fn replace_incompatible_lock_holder(
        paths: &AppPaths,
        health: &DaemonHealthResult,
    ) -> anyhow::Result<LockAcquire> {
        match Self::try_lock_file(paths) {
            Ok(lock) => return Ok(LockAcquire::Acquired(lock)),
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(err) => return Err(err.into()),
        }

        let metadata = read_lock_metadata(&paths.lock_path)?.ok_or_else(|| {
            anyhow::anyhow!(
                "incompatible codex-schedulerd {} did not publish lock metadata at {}",
                health.version,
                paths.lock_path.display()
            )
        })?;
        validate_replacement_target(paths, &metadata)?;

        warn!(
            pid = metadata.pid,
            running_version = health.version,
            running_schema = health.db_schema_version,
            replacement_version = env!("CARGO_PKG_VERSION"),
            replacement_schema = SCHEMA_VERSION,
            "replacing incompatible codex-schedulerd"
        );
        request_process_shutdown(metadata.pid)?;

        let started = Instant::now();
        let mut forced = false;
        loop {
            match Self::try_lock_file(paths) {
                Ok(lock) => return Ok(LockAcquire::Acquired(lock)),
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(err) => return Err(err.into()),
            }

            if let Ok(current_health) = rpc::health_check(&paths.socket_path).await {
                match daemon_compatibility(
                    &current_health,
                    env!("CARGO_PKG_VERSION"),
                    SCHEMA_VERSION,
                ) {
                    DaemonCompatibility::Compatible => return Ok(LockAcquire::AlreadyRunning),
                    DaemonCompatibility::Newer | DaemonCompatibility::UnknownVersion => {
                        anyhow::bail!(
                            "daemon compatibility changed while replacing process {}",
                            metadata.pid
                        );
                    }
                    DaemonCompatibility::Older | DaemonCompatibility::Unhealthy => {}
                }
            }

            if !forced && started.elapsed() >= REPLACEMENT_GRACE_TIMEOUT {
                force_process_shutdown(metadata.pid)?;
                forced = true;
            }
            if forced && started.elapsed() >= REPLACEMENT_GRACE_TIMEOUT + REPLACEMENT_FORCE_TIMEOUT
            {
                anyhow::bail!(
                    "incompatible codex-schedulerd process {} did not release lock at {}",
                    metadata.pid,
                    paths.lock_path.display()
                );
            }

            tokio::time::sleep(REPLACEMENT_POLL_INTERVAL).await;
        }
    }

    fn try_lock_file(paths: &AppPaths) -> std::io::Result<Self> {
        let path = &paths.lock_path;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .mode(0o600)
            .open(path)?;
        set_private_file_permissions(path)?;
        file.try_lock_exclusive()?;
        file.set_len(0)?;
        file.seek(SeekFrom::Start(0))?;
        let metadata = LockMetadata {
            pid: std::process::id() as i32,
            started_at: now_rfc3339(),
            socket_path: paths.socket_path.to_string_lossy().into_owned(),
        };
        let metadata_json = serde_json::to_string(&metadata).map_err(std::io::Error::other)?;
        writeln!(file, "{metadata_json}")?;
        file.sync_all()?;

        Ok(Self {
            file,
            path: path.to_path_buf(),
        })
    }

    pub fn cleanup(self) -> std::io::Result<()> {
        FileExt::unlock(&self.file)?;
        std::fs::remove_file(&self.path).or_else(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                Ok(())
            } else {
                Err(err)
            }
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LockMetadata {
    pid: i32,
    started_at: String,
    socket_path: String,
}

fn validate_replacement_target(paths: &AppPaths, metadata: &LockMetadata) -> anyhow::Result<()> {
    if metadata.pid <= 0 {
        anyhow::bail!(
            "invalid codex-schedulerd pid {} in lock metadata",
            metadata.pid
        );
    }
    if metadata.socket_path != "<legacy>" && Path::new(&metadata.socket_path) != paths.socket_path {
        anyhow::bail!(
            "daemon lock socket {} does not match expected endpoint {}",
            metadata.socket_path,
            paths.socket_path.display()
        );
    }
    if metadata.pid == std::process::id() as i32 {
        anyhow::bail!("refusing to terminate the current process from daemon lock metadata");
    }
    if !pid_exists(metadata.pid) {
        anyhow::bail!(
            "codex-schedulerd lock holder process {} is not running",
            metadata.pid
        );
    }
    Ok(())
}

#[cfg(unix)]
fn request_process_shutdown(pid: i32) -> std::io::Result<()> {
    if unsafe { libc::kill(pid, libc::SIGTERM) } == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(error)
    }
}

#[cfg(windows)]
fn request_process_shutdown(pid: i32) -> std::io::Result<()> {
    let status = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(std::io::Error::other(format!(
            "taskkill failed for codex-schedulerd process {pid}"
        )))
    }
}

#[cfg(unix)]
fn force_process_shutdown(pid: i32) -> std::io::Result<()> {
    if unsafe { libc::kill(pid, libc::SIGKILL) } == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(error)
    }
}

#[cfg(windows)]
fn force_process_shutdown(_pid: i32) -> std::io::Result<()> {
    Ok(())
}

fn read_lock_metadata(path: &Path) -> std::io::Result<Option<LockMetadata>> {
    let mut file = File::open(path)?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)?;
    let trimmed = contents.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if let Ok(metadata) = serde_json::from_str::<LockMetadata>(trimmed) {
        return Ok(Some(metadata));
    }
    Ok(trimmed.parse::<i32>().ok().map(|pid| LockMetadata {
        pid,
        started_at: "<legacy>".to_owned(),
        socket_path: "<legacy>".to_owned(),
    }))
}

#[cfg(unix)]
fn pid_exists(pid: i32) -> bool {
    if pid <= 0 {
        return false;
    }
    unsafe {
        libc::kill(pid, 0) == 0
            || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
}

#[cfg(not(unix))]
fn pid_exists(pid: i32) -> bool {
    // Reaching this branch means the OS-level exclusive lock is still held.
    // Treat its positive metadata PID as live instead of stealing the lock.
    pid > 0
}

#[cfg(unix)]
trait PrivateOpenOptionsExt {
    fn mode(&mut self, mode: u32) -> &mut Self;
}

#[cfg(unix)]
impl PrivateOpenOptionsExt for OpenOptions {
    fn mode(&mut self, mode: u32) -> &mut Self {
        use std::os::unix::fs::OpenOptionsExt;

        OpenOptionsExt::mode(self, mode)
    }
}

#[cfg(not(unix))]
trait PrivateOpenOptionsExt {
    fn mode(&mut self, _mode: u32) -> &mut Self;
}

#[cfg(not(unix))]
impl PrivateOpenOptionsExt for OpenOptions {
    fn mode(&mut self, _mode: u32) -> &mut Self {
        self
    }
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        read_lock_metadata, validate_replacement_target, LockAcquire, LockMetadata,
        SingleInstanceLock,
    };
    use crate::config::AppPaths;

    #[test]
    fn reads_current_and_legacy_lock_metadata() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("scheduler.lock");
        std::fs::write(
            &path,
            r#"{"pid":42,"startedAt":"2026-07-12T00:00:00Z","socketPath":"/tmp/scheduler.sock"}"#,
        )
        .expect("write metadata");

        let current = read_lock_metadata(&path)
            .expect("read metadata")
            .expect("current metadata");
        assert_eq!(current.pid, 42);
        assert_eq!(current.socket_path, "/tmp/scheduler.sock");

        std::fs::write(&path, "43\n").expect("write legacy metadata");
        let legacy = read_lock_metadata(&path)
            .expect("read legacy metadata")
            .expect("legacy metadata");
        assert_eq!(legacy.pid, 43);
        assert_eq!(legacy.socket_path, "<legacy>");
    }

    #[test]
    fn replacement_target_must_match_the_expected_endpoint() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = AppPaths::new(temp.path());
        let metadata = LockMetadata {
            pid: std::process::id() as i32,
            started_at: "2026-07-12T00:00:00Z".to_owned(),
            socket_path: temp
                .path()
                .join("different.sock")
                .to_string_lossy()
                .into_owned(),
        };

        let error = validate_replacement_target(&paths, &metadata)
            .expect_err("mismatched endpoint must be rejected");
        assert!(error
            .to_string()
            .contains("does not match expected endpoint"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn replaces_a_healthy_older_daemon_lock_holder() {
        use std::process::{Command, Stdio};
        use std::time::Duration;

        let temp = tempfile::tempdir().expect("temp dir");
        let ready_path = temp.path().join("ready");
        let mut child = Command::new(std::env::current_exe().expect("test executable"))
            .args([
                "--ignored",
                "--exact",
                "lock::tests::incompatible_lock_holder_helper",
            ])
            .env("CLOCKHAND_LOCK_TEST_DATA_DIR", temp.path())
            .env("CLOCKHAND_LOCK_TEST_READY", &ready_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn lock holder helper");

        let ready = tokio::time::timeout(Duration::from_secs(5), async {
            while !ready_path.exists() {
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await;
        if ready.is_err() {
            let _ = child.kill();
            panic!("lock holder helper did not become ready");
        }

        let acquire = tokio::time::timeout(
            Duration::from_secs(10),
            SingleInstanceLock::acquire(&AppPaths::new(temp.path())),
        )
        .await;
        if acquire.is_err() {
            let _ = child.kill();
            panic!("replacement timed out");
        }
        let lock = match acquire.expect("acquire timeout").expect("replace daemon") {
            LockAcquire::Acquired(lock) => lock,
            LockAcquire::AlreadyRunning => panic!("older daemon must be replaced"),
        };

        let status = child.wait().expect("wait for replaced lock holder");
        assert!(!status.success());
        lock.cleanup().expect("cleanup replacement lock");
        let _ = std::fs::remove_file(temp.path().join("scheduler.sock"));
    }

    #[cfg(unix)]
    #[test]
    #[ignore = "subprocess helper for replaces_a_healthy_older_daemon_lock_holder"]
    fn incompatible_lock_holder_helper() {
        use fs2::FileExt;
        use std::fs::OpenOptions;
        use std::io::{BufRead, BufReader, Seek, SeekFrom, Write};
        use std::os::unix::fs::OpenOptionsExt;
        use std::os::unix::net::UnixListener;

        let Some(data_dir) = std::env::var_os("CLOCKHAND_LOCK_TEST_DATA_DIR") else {
            return;
        };
        let ready_path = std::env::var_os("CLOCKHAND_LOCK_TEST_READY").expect("ready path");
        let paths = AppPaths::new(data_dir);
        paths.ensure_dirs().expect("data directories");

        let mut lock_file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .mode(0o600)
            .open(&paths.lock_path)
            .expect("open lock");
        lock_file.try_lock_exclusive().expect("hold lock");
        lock_file.set_len(0).expect("truncate lock");
        lock_file.seek(SeekFrom::Start(0)).expect("seek lock");
        let metadata = LockMetadata {
            pid: std::process::id() as i32,
            started_at: "2026-07-12T00:00:00Z".to_owned(),
            socket_path: paths.socket_path.to_string_lossy().into_owned(),
        };
        writeln!(
            lock_file,
            "{}",
            serde_json::to_string(&metadata).expect("serialize metadata")
        )
        .expect("write lock");
        lock_file.sync_all().expect("sync lock");

        let _ = std::fs::remove_file(&paths.socket_path);
        let listener = UnixListener::bind(&paths.socket_path).expect("bind test socket");
        std::fs::write(ready_path, "ready").expect("mark ready");

        let (mut stream, _) = listener.accept().expect("accept health request");
        let mut request = String::new();
        BufReader::new(stream.try_clone().expect("clone stream"))
            .read_line(&mut request)
            .expect("read health request");
        assert!(request.contains("daemon.health"));
        writeln!(
            stream,
            "{{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"result\":{{\"ok\":true,\"version\":\"0.1.0\",\"dbSchemaVersion\":1,\"schedulerEnabled\":true,\"runningCount\":0,\"queuedCount\":0}}}}"
        )
        .expect("write health response");
        stream.flush().expect("flush health response");

        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
    }
}
