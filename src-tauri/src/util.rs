use std::path::{Component, Path, PathBuf};

/// Strip the Windows verbatim (`\\?\`) prefix. Verbatim paths are returned by
/// `canonicalize` and are rejected by some child processes (notably cmd.exe as a
/// working directory) and look wrong in the UI.
pub fn display_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let raw = path.to_string_lossy();
        if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = raw.strip_prefix(r"\\?\") {
            let bytes = rest.as_bytes();
            if bytes.len() >= 2 && bytes[1] == b':' {
                return PathBuf::from(rest);
            }
        }
    }
    path.to_path_buf()
}

/// Resolve a path against the active workspace root and refuse traversal outside it.
pub fn resolve_in_workspace(root: &Path, raw: &str) -> Result<PathBuf, String> {
    let candidate = {
        let p = PathBuf::from(raw);
        if p.is_absolute() {
            p
        } else {
            root.join(p)
        }
    };

    // Reject `..` components before touching the filesystem so non-existent paths
    // cannot be used to escape the workspace.
    let mut depth: i32 = 0;
    for comp in candidate.components() {
        match comp {
            Component::ParentDir => {
                depth -= 1;
                if depth < 0 {
                    return Err("path escapes the workspace".into());
                }
            }
            Component::Normal(_) | Component::RootDir | Component::Prefix(_) => {}
            Component::CurDir => {}
        }
    }

    let canon_root = root.canonicalize().map_err(|e| format!("workspace unavailable: {e}"))?;
    let normalized = if candidate.exists() {
        candidate.canonicalize().map_err(|e| e.to_string())?
    } else {
        let parent = candidate.parent().ok_or("invalid path")?;
        let canon_parent = if parent.exists() {
            parent.canonicalize().map_err(|e| e.to_string())?
        } else {
            // Walk up to the closest existing ancestor and re-append the tail.
            let mut tail: Vec<&std::ffi::OsStr> = Vec::new();
            let mut probe = parent;
            let base = loop {
                if probe.exists() {
                    break probe.canonicalize().map_err(|e| e.to_string())?;
                }
                tail.push(probe.file_name().ok_or("invalid path")?);
                probe = probe.parent().ok_or("invalid path")?;
            };
            let mut out = base;
            for name in tail.iter().rev() {
                out.push(name);
            }
            out
        };
        canon_parent.join(candidate.file_name().ok_or("invalid path")?)
    };

    if normalized.starts_with(&canon_root) {
        Ok(display_path(&normalized))
    } else {
        Err("path escapes the workspace".into())
    }
}

/// Resolve an executable the way a shell would, without spawning one. Accepts a
/// bare command (`pwsh`, `pwsh.exe`) or an explicit path.
pub fn which(command: &str) -> Option<PathBuf> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return None;
    }

    let raw = Path::new(trimmed);
    if raw.is_absolute() || raw.components().count() > 1 {
        return raw.is_file().then(|| raw.to_path_buf());
    }

    // A name that already carries an extension is looked up verbatim; otherwise
    // Windows needs the PATHEXT probes (`pwsh` -> `pwsh.EXE`).
    let extensions: Vec<String> = if raw.extension().is_some() {
        vec![String::new()]
    } else if cfg!(windows) {
        let mut list: Vec<String> = std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".into())
            .split(';')
            .filter(|ext| !ext.trim().is_empty())
            .map(|ext| ext.to_ascii_lowercase())
            .collect();
        // Extensionless executables exist too (git's `bash`).
        list.push(String::new());
        list
    } else {
        vec![String::new()]
    };

    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for ext in &extensions {
            let candidate = dir.join(format!("{trimmed}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

pub fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{} {}", bytes, UNITS[0])
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

pub fn is_probably_binary(bytes: &[u8]) -> bool {
    if bytes.iter().take(8000).any(|b| *b == 0) {
        return true;
    }
    let sample = &bytes[..bytes.len().min(8000)];
    if sample.is_empty() {
        return false;
    }
    let weird = sample
        .iter()
        .filter(|b| **b < 7 || (**b > 14 && **b < 32))
        .count();
    weird * 100 / sample.len() > 10
}

pub fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Run a git command inside `root` and return stdout (trimmed of trailing newline).
pub fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("git exited with {}", out.status)
        } else {
            err
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}
