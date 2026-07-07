use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

use fs2::FileExt;

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
    path: std::path::PathBuf,
}

impl SingleInstanceLock {
    pub async fn acquire(paths: &AppPaths) -> anyhow::Result<LockAcquire> {
        paths.ensure_dirs()?;
        match Self::try_lock_file(&paths.lock_path) {
            Ok(lock) => Ok(LockAcquire::Acquired(lock)),
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                if rpc::health_check(&paths.socket_path).await.is_ok() {
                    return Ok(LockAcquire::AlreadyRunning);
                }

                let pid = read_pid(&paths.lock_path).ok().flatten();
                if pid.map(pid_exists).unwrap_or(false) {
                    anyhow::bail!(
                        "another codex-schedulerd process holds lock at {}",
                        paths.lock_path.display()
                    );
                }

                let _ = std::fs::remove_file(&paths.lock_path);
                Ok(LockAcquire::Acquired(Self::try_lock_file(
                    &paths.lock_path,
                )?))
            }
            Err(err) => Err(err.into()),
        }
    }

    fn try_lock_file(path: &Path) -> std::io::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(path)?;
        file.try_lock_exclusive()?;
        file.set_len(0)?;
        file.seek(SeekFrom::Start(0))?;
        writeln!(file, "{}", std::process::id())?;
        file.sync_all()?;

        Ok(Self {
            file,
            path: path.to_path_buf(),
        })
    }

    pub fn cleanup(self) -> std::io::Result<()> {
        self.file.unlock()?;
        std::fs::remove_file(&self.path).or_else(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                Ok(())
            } else {
                Err(err)
            }
        })
    }
}

fn read_pid(path: &Path) -> std::io::Result<Option<i32>> {
    let mut file = File::open(path)?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)?;
    Ok(contents.trim().parse::<i32>().ok())
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
