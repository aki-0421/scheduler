use std::io;
use std::path::{Path, PathBuf};

#[cfg(unix)]
pub type LocalStream = tokio::net::UnixStream;

#[cfg(windows)]
pub type LocalStream = tokio::net::windows::named_pipe::NamedPipeClient;

#[cfg(unix)]
pub type LocalServerStream = tokio::net::UnixStream;

#[cfg(windows)]
pub type LocalServerStream = tokio::net::windows::named_pipe::NamedPipeServer;

#[cfg(unix)]
pub struct LocalListener {
    inner: tokio::net::UnixListener,
}

#[cfg(windows)]
pub struct LocalListener {
    inner: tokio::net::windows::named_pipe::NamedPipeServer,
    endpoint: PathBuf,
}

impl LocalListener {
    pub fn bind(endpoint: &Path) -> io::Result<Self> {
        #[cfg(unix)]
        {
            Ok(Self {
                inner: tokio::net::UnixListener::bind(endpoint)?,
            })
        }

        #[cfg(windows)]
        {
            Ok(Self {
                inner: create_named_pipe(endpoint, true)?,
                endpoint: endpoint.to_path_buf(),
            })
        }
    }

    pub async fn accept(&mut self) -> io::Result<LocalServerStream> {
        #[cfg(unix)]
        {
            self.inner.accept().await.map(|(stream, _address)| stream)
        }

        #[cfg(windows)]
        {
            self.inner.connect().await?;
            match create_named_pipe(&self.endpoint, false) {
                Ok(next) => Ok(std::mem::replace(&mut self.inner, next)),
                Err(error) => {
                    let _ = self.inner.disconnect();
                    self.inner = create_named_pipe(&self.endpoint, false)?;
                    Err(error)
                }
            }
        }
    }
}

pub fn default_endpoint(data_dir: &Path) -> PathBuf {
    #[cfg(unix)]
    {
        data_dir.join("scheduler.sock")
    }

    #[cfg(windows)]
    {
        let identity = endpoint_identity(data_dir);
        PathBuf::from(format!(r"\\.\pipe\clockhand-{identity:016x}"))
    }

    #[cfg(not(any(unix, windows)))]
    compile_error!("Clockhand local transport supports Unix and Windows targets only");
}

pub async fn connect(endpoint: &Path) -> io::Result<LocalStream> {
    #[cfg(unix)]
    {
        tokio::net::UnixStream::connect(endpoint).await
    }

    #[cfg(windows)]
    {
        use std::time::Duration;
        use tokio::net::windows::named_pipe::ClientOptions;

        const ERROR_PIPE_BUSY: i32 = 231;

        loop {
            match ClientOptions::new().open(endpoint) {
                Ok(client) => return Ok(client),
                Err(error) if error.raw_os_error() == Some(ERROR_PIPE_BUSY) => {
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }
                Err(error) => return Err(error),
            }
        }
    }
}

#[cfg(windows)]
fn create_named_pipe(
    endpoint: &Path,
    first: bool,
) -> io::Result<tokio::net::windows::named_pipe::NamedPipeServer> {
    use std::mem::size_of;
    use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;

    let descriptor = current_user_security_descriptor()?;
    let mut attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor.0,
        bInheritHandle: 0,
    };
    let mut options = tokio::net::windows::named_pipe::ServerOptions::new();
    options
        .first_pipe_instance(first)
        .reject_remote_clients(true);

    // CreateNamedPipeW copies the security descriptor during this call, so the
    // LocalAlloc-backed descriptor can be released immediately afterwards.
    unsafe {
        options.create_with_security_attributes_raw(
            endpoint,
            (&mut attributes as *mut SECURITY_ATTRIBUTES).cast(),
        )
    }
}

#[cfg(windows)]
struct LocalMemory(*mut core::ffi::c_void);

#[cfg(windows)]
impl Drop for LocalMemory {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                windows_sys::Win32::Foundation::LocalFree(self.0);
            }
        }
    }
}

#[cfg(windows)]
fn current_user_security_descriptor() -> io::Result<LocalMemory> {
    use std::mem::size_of;
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
        SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut token: HANDLE = null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }

    let result = (|| {
        let mut token_length = 0_u32;
        unsafe {
            GetTokenInformation(token, TokenUser, null_mut(), 0, &mut token_length);
        }
        if token_length == 0 {
            return Err(io::Error::last_os_error());
        }

        let word_count = (token_length as usize).div_ceil(size_of::<usize>());
        let mut token_buffer = vec![0_usize; word_count];
        if unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                token_buffer.as_mut_ptr().cast(),
                token_length,
                &mut token_length,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let token_user = unsafe { &*(token_buffer.as_ptr().cast::<TOKEN_USER>()) };

        let mut sid_pointer = null_mut();
        if unsafe { ConvertSidToStringSidW(token_user.User.Sid, &mut sid_pointer) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let sid_memory = LocalMemory(sid_pointer.cast());
        let mut sid_length = 0_usize;
        while unsafe { *sid_pointer.add(sid_length) } != 0 {
            sid_length += 1;
        }
        let sid =
            String::from_utf16(unsafe { std::slice::from_raw_parts(sid_pointer, sid_length) })
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        drop(sid_memory);

        let security_descriptor = format!("D:P(A;;GA;;;{sid})");
        let wide_descriptor = security_descriptor
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let mut descriptor_pointer = null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                wide_descriptor.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor_pointer,
                null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }

        Ok(LocalMemory(descriptor_pointer))
    })();

    unsafe {
        CloseHandle(token);
    }
    result
}

#[cfg(windows)]
fn endpoint_identity(data_dir: &Path) -> u64 {
    let absolute = if data_dir.is_absolute() {
        data_dir.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|current| current.join(data_dir))
            .unwrap_or_else(|_| data_dir.to_path_buf())
    };
    let normalized = absolute.to_string_lossy().replace('/', "\\").to_lowercase();

    // FNV-1a gives the pipe a stable, path-derived name without exposing the
    // user's application-data path in the global pipe namespace.
    normalized
        .encode_utf16()
        .fold(0xcbf29ce484222325_u64, |hash, unit| {
            (hash ^ u64::from(unit)).wrapping_mul(0x100000001b3)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn unix_endpoint_is_inside_the_data_directory() {
        assert_eq!(
            default_endpoint(Path::new("/tmp/clockhand")),
            PathBuf::from("/tmp/clockhand/scheduler.sock")
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_endpoint_is_a_stable_local_named_pipe() {
        let first = default_endpoint(Path::new(r"C:\Users\test\Clockhand"));
        let second = default_endpoint(Path::new(r"c:/users/test/clockhand"));
        assert_eq!(first, second);
        assert!(first.to_string_lossy().starts_with(r"\\.\pipe\clockhand-"));
    }
}
