use std::path::PathBuf;

pub const DATA_DIR_NAME: &str = "Codex Scheduler";

pub fn default_data_dir() -> PathBuf {
    platform_data_root()
        .map(|root| root.join(DATA_DIR_NAME))
        .unwrap_or_else(|| PathBuf::from(".").join(DATA_DIR_NAME))
}

pub fn find_executable_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|directory| {
        executable_file_names(name)
            .into_iter()
            .map(|file_name| directory.join(file_name))
            .find(|candidate| candidate.is_file())
    })
}

#[cfg(windows)]
fn executable_file_names(name: &str) -> Vec<String> {
    [".exe", ".cmd", ".bat", ".com"]
        .into_iter()
        .map(|extension| format!("{name}{extension}"))
        .collect()
}

#[cfg(not(windows))]
fn executable_file_names(name: &str) -> Vec<String> {
    vec![name.to_owned()]
}

#[cfg(target_os = "macos")]
fn platform_data_root() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join("Library").join("Application Support"))
}

#[cfg(windows)]
fn platform_data_root() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("APPDATA"))
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_data_root() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|home| home.join(".local").join("share"))
        })
}

#[cfg(not(any(unix, windows)))]
fn platform_data_root() -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_directory_keeps_the_compatible_name() {
        assert_eq!(
            default_data_dir()
                .file_name()
                .and_then(|name| name.to_str()),
            Some(DATA_DIR_NAME)
        );
    }

    #[test]
    fn executable_names_include_the_platform_command_form() {
        let names = executable_file_names("codex");
        if cfg!(windows) {
            assert!(names.iter().any(|name| name == "codex.exe"));
            assert!(names.iter().any(|name| name == "codex.cmd"));
        } else {
            assert_eq!(names, vec!["codex"]);
        }
    }
}
