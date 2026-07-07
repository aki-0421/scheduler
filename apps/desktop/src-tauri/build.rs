fn main() {
    ensure_sidecar_placeholders();
    tauri_build::build();
}

fn ensure_sidecar_placeholders() {
    let target = std::env::var("TARGET").unwrap_or_else(|_| "unknown-target".to_string());
    let extension = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    let binaries_dir = std::path::Path::new("binaries");

    std::fs::create_dir_all(binaries_dir)
        .expect("failed to create Tauri sidecar placeholder directory");

    for name in ["codex-schedulerd", "codex-schedule"] {
        let path = binaries_dir.join(format!("{name}-{target}{extension}"));
        if path.exists() {
            continue;
        }

        std::fs::write(
            &path,
            "#!/bin/sh\n\
             echo \"This placeholder is only for cargo check/test. Run pnpm --filter desktop sidecars:prepare before bundling.\" >&2\n\
             exit 1\n",
        )
        .expect("failed to write Tauri sidecar placeholder");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            let mut permissions = std::fs::metadata(&path)
                .expect("failed to read sidecar placeholder metadata")
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&path, permissions)
                .expect("failed to mark sidecar placeholder executable");
        }
    }
}
