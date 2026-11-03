use std::path::{Path, PathBuf};

use regex::{NoExpand, Regex};
use serde::Serialize;
use tauri::State;
use walkdir::WalkDir;

use crate::state::{AppState, RecentWorkspace};
use crate::util::{display_path, human_size, is_probably_binary, now_unix, resolve_in_workspace};

const SKIP_DIRS: [&str; 12] = [
    ".git",
    "node_modules",
    "target",
    "dist",
    ".nuxt",
    ".output",
    ".venv",
    "__pycache__",
    ".next",
    "vendor",
    ".cache",
    "build",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub human_size: String,
    pub modified: u64,
    pub ext: String,
    pub hidden: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub name: String,
    pub path: String,
    pub is_git: bool,
    pub branch: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePayload {
    pub path: String,
    pub text: String,
    pub binary: bool,
    pub size: u64,
    pub human_size: String,
}

fn entry_for(path: &Path) -> Entry {
    let meta = std::fs::symlink_metadata(path).ok();
    let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let modified = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Entry {
        hidden: name.starts_with('.'),
        ext: path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default(),
        name,
        path: path.to_string_lossy().to_string(),
        is_dir,
        size,
        human_size: human_size(size),
        modified,
    }
}

#[tauri::command]
pub fn open_workspace(path: String, state: State<'_, AppState>) -> Result<WorkspaceInfo, String> {
    let root = crate::util::display_path(
        &PathBuf::from(&path)
            .canonicalize()
            .map_err(|e| format!("cannot open folder: {e}"))?,
    );
    if !root.is_dir() {
        return Err("the selected path is not a folder".into());
    }
    *state.workspace.write() = Some(root.clone());

    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| root.to_string_lossy().to_string());

    let is_git = root.join(".git").exists();
    let branch = if is_git {
        crate::util::git(&root, &["rev-parse", "--abbrev-ref", "HEAD"])
            .ok()
            .map(|s| s.trim().to_string())
    } else {
        None
    };

    {
        let mut settings = state.settings.write();
        settings.recent_workspaces.retain(|r| r.path != path);
        settings.recent_workspaces.insert(
            0,
            RecentWorkspace {
                name: name.clone(),
                path: root.to_string_lossy().to_string(),
                last_opened: now_unix(),
            },
        );
        settings.recent_workspaces.truncate(12);
    }
    let _ = state.persist_settings();

    Ok(WorkspaceInfo {
        name,
        path: root.to_string_lossy().to_string(),
        is_git,
        branch,
    })
}

#[tauri::command]
pub fn current_workspace(state: State<'_, AppState>) -> Option<WorkspaceInfo> {
    let root = state.workspace.read().clone()?;
    let is_git = root.join(".git").exists();
    let branch = if is_git {
        crate::util::git(&root, &["rev-parse", "--abbrev-ref", "HEAD"])
            .ok()
            .map(|s| s.trim().to_string())
    } else {
        None
    };
    Some(WorkspaceInfo {
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        path: root.to_string_lossy().to_string(),
        is_git,
        branch,
    })
}

#[tauri::command]
pub fn close_workspace(state: State<'_, AppState>) {
    *state.workspace.write() = None;
}

#[tauri::command]
pub fn list_dir(path: String, state: State<'_, AppState>) -> Result<Vec<Entry>, String> {
    let root = state.workspace_root()?;
    let dir = resolve_in_workspace(&root, &path)?;
    let mut out: Vec<Entry> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| entry_for(&e.path()))
        .collect();
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

#[tauri::command]
pub fn read_file(
    path: String,
    allow_outside: Option<bool>,
    state: State<'_, AppState>,
) -> Result<FilePayload, String> {
    // Language-server navigation (go to definition/reference) may point at SDK
    // or standard-library files outside the workspace, so those jumps opt in to
    // read-only access. Every other caller stays inside the workspace.
    let target = if allow_outside.unwrap_or(false) {
        display_path(
            &std::path::PathBuf::from(&path)
                .canonicalize()
                .map_err(|e| format!("cannot open file: {e}"))?,
        )
    } else {
        let root = state.workspace_root()?;
        resolve_in_workspace(&root, &path)?
    };
    let bytes = std::fs::read(&target).map_err(|e| e.to_string())?;
    let binary = is_probably_binary(&bytes);
    let text = String::from_utf8_lossy(&bytes).to_string();
    Ok(FilePayload {
        path: target.to_string_lossy().to_string(),
        text,
        binary,
        size: bytes.len() as u64,
        human_size: human_size(bytes.len() as u64),
    })
}

#[tauri::command]
pub fn write_file(path: String, text: String, state: State<'_, AppState>) -> Result<(), String> {
    let root = state.workspace_root()?;
    let target = resolve_in_workspace(&root, &path)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&target, text).map_err(|e| e.to_string())
}

/// Write a user-chosen file outside the workspace (CSV export, downloaded
/// update, notes). The path always comes from a native save dialog.
#[tauri::command]
pub fn export_text(path: String, text: String) -> Result<String, String> {
    let target = std::path::PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&target, text).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_path(path: String, is_dir: bool, state: State<'_, AppState>) -> Result<String, String> {
    let root = state.workspace_root()?;
    let target = resolve_in_workspace(&root, &path)?;
    if target.exists() {
        return Err("a file or folder with that name already exists".into());
    }
    if is_dir {
        std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    } else {
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&target, "").map_err(|e| e.to_string())?;
    }
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn rename_path(from: String, to: String, state: State<'_, AppState>) -> Result<String, String> {
    let root = state.workspace_root()?;
    let src = resolve_in_workspace(&root, &from)?;
    let dst = resolve_in_workspace(&root, &to)?;
    if dst.exists() {
        return Err("destination already exists".into());
    }
    std::fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    Ok(dst.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_path(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let root = state.workspace_root()?;
    let target = resolve_in_workspace(&root, &path)?;
    if target == root {
        return Err("refusing to delete the workspace root".into());
    }
    if target.is_dir() {
        std::fs::remove_dir_all(&target).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&target).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn reveal_in_file_manager(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let root = state.workspace_root()?;
    let target = resolve_in_workspace(&root, &path)?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", target.to_string_lossy()))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg("-R").arg(&target).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = target.parent().unwrap_or(&target);
        std::process::Command::new("xdg-open").arg(parent).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn fuzzy_score(haystack: &str, needle: &str) -> Option<i32> {
    if needle.is_empty() {
        return Some(0);
    }
    let h: Vec<char> = haystack.to_lowercase().chars().collect();
    let n: Vec<char> = needle.to_lowercase().chars().collect();
    let mut hi = 0;
    let mut score = 0i32;
    let mut streak = 0i32;
    for &c in &n {
        let mut found = false;
        while hi < h.len() {
            if h[hi] == c {
                streak += 1;
                score += 10 + streak * 6;
                if hi == 0 || h[hi - 1] == '/' || h[hi - 1] == '_' || h[hi - 1] == '-' || h[hi - 1] == '.' {
                    score += 12;
                }
                hi += 1;
                found = true;
                break;
            }
            streak = 0;
            hi += 1;
            score -= 1;
        }
        if !found {
            return None;
        }
    }
    score -= (h.len() as i32) / 8;
    Some(score)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickFile {
    pub name: String,
    pub path: String,
    pub rel: String,
}

#[tauri::command]
pub fn search_files(query: String, limit: Option<usize>, state: State<'_, AppState>) -> Result<Vec<QuickFile>, String> {
    let root = state.workspace_root()?;
    let limit = limit.unwrap_or(60);
    let mut scored: Vec<(i32, QuickFile)> = Vec::new();
    for entry in WalkDir::new(&root)
        .max_depth(14)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            e.depth() == 0 || !SKIP_DIRS.contains(&name.as_str())
        })
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = entry
            .path()
            .strip_prefix(&root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        if let Some(score) = fuzzy_score(&rel, &query) {
            scored.push((
                score,
                QuickFile {
                    name: entry.file_name().to_string_lossy().to_string(),
                    path: entry.path().to_string_lossy().to_string(),
                    rel,
                },
            ));
        }
        if scored.len() > 4000 {
            break;
        }
    }
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.truncate(limit);
    Ok(scored.into_iter().map(|(_, f)| f).collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub rel: String,
    pub line: u32,
    pub column: u32,
    pub text: String,
    pub is_dir: bool,
}

/// Build the matcher shared by search and replace. Literal queries are escaped,
/// so a plain search for `a.b` does not behave like a regex.
fn build_matcher(
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
    is_regex: bool,
) -> Result<Regex, String> {
    if query.trim().is_empty() {
        return Err("search query is empty".into());
    }
    let base = if is_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let wrapped = if whole_word {
        format!(r"\b(?:{base})\b")
    } else {
        base
    };
    let pattern = if case_sensitive {
        wrapped
    } else {
        format!("(?i){wrapped}")
    };
    Regex::new(&pattern).map_err(|err| {
        // The regex crate prints a multi-line diagnostic; the last line is the
        // human-readable reason ("error: unclosed character class").
        let raw = err.to_string();
        let reason = raw
            .lines()
            .rev()
            .map(str::trim)
            .find(|line| !line.is_empty() && !line.starts_with('^'))
            .unwrap_or("invalid pattern")
            .trim_start_matches("error:")
            .trim()
            .to_string();
        format!("invalid regular expression: {reason}")
    })
}

fn line_of(text: &str, offset: usize) -> u32 {
    text.as_bytes()[..offset.min(text.len())]
        .iter()
        .filter(|byte| **byte == b'\n')
        .count() as u32
        + 1
}

/// Replace a file atomically so a crash cannot leave it half written.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut name = path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".kodra-tmp");
    let tmp = path.with_file_name(name);
    let permissions = std::fs::metadata(path).ok().map(|m| m.permissions());
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    if let Some(permissions) = permissions {
        // Keep the original file mode when the platform uses one.
        let _ = std::fs::set_permissions(&tmp, permissions);
    }
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(_) => {
            let _ = std::fs::remove_file(&tmp);
            std::fs::write(path, bytes).map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
pub fn search_in_files(
    query: String,
    case_sensitive: Option<bool>,
    whole_word: Option<bool>,
    is_regex: Option<bool>,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<SearchHit>, String> {
    let root = state.workspace_root()?;
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.unwrap_or(400);
    let matcher = build_matcher(
        &query,
        case_sensitive.unwrap_or(false),
        whole_word.unwrap_or(false),
        is_regex.unwrap_or(false),
    )?;
    let mut hits = Vec::new();

    'outer: for entry in WalkDir::new(&root)
        .max_depth(16)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            e.depth() == 0 || !SKIP_DIRS.contains(&name.as_str())
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let meta = entry.metadata().ok();
        if meta.map(|m| m.len() > 2_000_000).unwrap_or(false) {
            continue;
        }
        let bytes = match std::fs::read(entry.path()) {
            Ok(b) => b,
            Err(_) => continue,
        };
        if is_probably_binary(&bytes) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        for (idx, line) in text.lines().enumerate() {
            let Some(found) = matcher.find(line) else { continue };
            hits.push(SearchHit {
                path: entry.path().to_string_lossy().to_string(),
                rel: entry
                    .path()
                    .strip_prefix(&root)
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default(),
                line: idx as u32 + 1,
                column: line[..found.start()].chars().count() as u32 + 1,
                text: line.trim_end().chars().take(240).collect(),
                is_dir: false,
            });
            if hits.len() >= limit {
                break 'outer;
            }
        }
    }
    Ok(hits)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceChange {
    pub path: String,
    pub rel: String,
    pub matches: usize,
    /// First line numbers with a match (capped to keep the preview compact).
    pub lines: Vec<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceOutcome {
    pub matches: usize,
    pub files: usize,
    pub changes: Vec<ReplaceChange>,
}

/// Replacing more than this in one action is almost always a mistake.
const MAX_REPLACE_MATCHES: usize = 20_000;
const MAX_PREVIEW_LINES: usize = 40;

/// Preview (`dry_run: true`) or apply a workspace-wide replacement.
#[tauri::command]
pub fn replace_in_files(
    query: String,
    replacement: String,
    case_sensitive: Option<bool>,
    whole_word: Option<bool>,
    is_regex: Option<bool>,
    dry_run: Option<bool>,
    state: State<'_, AppState>,
) -> Result<ReplaceOutcome, String> {
    let root = state.workspace_root()?;
    let is_regex = is_regex.unwrap_or(false);
    let matcher = build_matcher(
        &query,
        case_sensitive.unwrap_or(false),
        whole_word.unwrap_or(false),
        is_regex,
    )?;
    let dry_run = dry_run.unwrap_or(true);
    let mut total = 0usize;
    let mut changes = Vec::new();

    for entry in WalkDir::new(&root)
        .max_depth(16)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            e.depth() == 0 || !SKIP_DIRS.contains(&name.as_str())
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let meta = entry.metadata().ok();
        if meta.map(|m| m.len() > 2_000_000).unwrap_or(false) {
            continue;
        }
        let Ok(bytes) = std::fs::read(entry.path()) else {
            continue;
        };
        if is_probably_binary(&bytes) {
            continue;
        }
        // Only rewrite valid UTF-8; lossy conversion would corrupt the file.
        let Ok(text) = String::from_utf8(bytes) else {
            continue;
        };
        let matches = matcher.find_iter(&text).count();
        if matches == 0 {
            continue;
        }
        total += matches;
        if total > MAX_REPLACE_MATCHES {
            return Err(format!(
                "too many matches (over {MAX_REPLACE_MATCHES}); narrow the search first"
            ));
        }
        let lines = matcher
            .find_iter(&text)
            .take(MAX_PREVIEW_LINES)
            .map(|found| line_of(&text, found.start()))
            .collect();
        if !dry_run {
            let next = if is_regex {
                matcher.replace_all(&text, replacement.as_str()).into_owned()
            } else {
                matcher
                    .replace_all(&text, NoExpand(replacement.as_str()))
                    .into_owned()
            };
            write_atomic(entry.path(), next.as_bytes())?;
        }
        changes.push(ReplaceChange {
            path: entry.path().to_string_lossy().to_string(),
            rel: entry
                .path()
                .strip_prefix(&root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default(),
            matches,
            lines,
        });
    }

    Ok(ReplaceOutcome {
        matches: total,
        files: changes.len(),
        changes,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirStat {
    pub files: usize,
    pub dirs: usize,
    pub bytes: u64,
}

#[tauri::command]
pub fn workspace_stats(state: State<'_, AppState>) -> Result<DirStat, String> {
    let root = state.workspace_root()?;
    let mut files = 0;
    let mut dirs = 0;
    let mut bytes = 0u64;
    for entry in WalkDir::new(&root)
        .max_depth(12)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            e.depth() == 0 || !SKIP_DIRS.contains(&name.as_str())
        })
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_dir() {
            dirs += 1;
        } else if entry.file_type().is_file() {
            files += 1;
            bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    Ok(DirStat { files, dirs, bytes })
}
