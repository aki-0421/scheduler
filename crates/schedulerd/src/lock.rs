use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use fs2::FileExt;
use scheduler_core::time::now_rfc3339;
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::config::AppPaths;
use crate::rpc;

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
                if rpc::health_check(&paths.socket_path).await.is_ok() {
                    return Ok(LockAcquire::AlreadyRunning);
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

fn pid_exists(pid: i32) -> bool {
    if pid <= 0 {
        return false;
    }
    unsafe {
        libc::kill(pid, 0) == 0
            || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
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
