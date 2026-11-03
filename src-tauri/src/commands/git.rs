use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

use crate::state::AppState;
use crate::util::{display_path, git, resolve_in_workspace};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    pub path: String,
    pub rel: String,
    pub index: String,
    pub worktree: String,
    pub staged: bool,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitFile>,
    pub clean: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub current: bool,
    pub remote: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub short: String,
    pub author: String,
    pub date: String,
    pub subject: String,
}

fn status_label(index: &str, worktree: &str) -> String {
    let code = if index != " " && index != "?" { index } else { worktree };
    match code {
        "M" => "modified",
        "A" => "added",
        "D" => "deleted",
        "R" => "renamed",
        "C" => "copied",
        "U" => "conflict",
        "?" => "untracked",
        "!" => "ignored",
        _ => "changed",
    }
    .to_string()
}

#[tauri::command]
pub fn git_status(state: State<'_, AppState>) -> Result<GitStatus, String> {
    let root = state.workspace_root()?;
    let raw = git(&root, &["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"])?;
    let mut branch = String::from("HEAD");
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut files = Vec::new();

    let mut parts = raw.split('\0').filter(|s| !s.is_empty());
    while let Some(part) = parts.next() {
        if let Some(rest) = part.strip_prefix("## ") {
            let mut it = rest.split("...");
            branch = it.next().unwrap_or("HEAD").trim().to_string();
            if let Some(up) = it.next() {
                let up = up.trim();
                upstream = Some(up.split(' ').next().unwrap_or(up).to_string());
            }
            if let Some(idx) = rest.find('[') {
                let meta = &rest[idx + 1..rest.len().saturating_sub(1)];
                for chunk in meta.split(',') {
                    let chunk = chunk.trim();
                    if let Some(v) = chunk.strip_prefix("ahead ") {
                        ahead = v.parse().unwrap_or(0);
                    } else if let Some(v) = chunk.strip_prefix("behind ") {
                        behind = v.parse().unwrap_or(0);
                    }
                }
            }
            continue;
        }
        if part.len() < 3 {
            continue;
        }
        let index = &part[0..1];
        let worktree = &part[1..2];
        let mut rel = part[3..].to_string();
        // Renames/copies encode "old\0new"; the next chunk is the new path.
        if index == "R" || index == "C" {
            if let Some(next) = parts.next() {
                rel = next.to_string();
            }
        }
        let abs = root.join(&rel);
        files.push(GitFile {
            path: abs.to_string_lossy().to_string(),
            rel,
            index: index.to_string(),
            worktree: worktree.to_string(),
            staged: index != " " && index != "?",
            status: status_label(index, worktree),
        });
    }

    Ok(GitStatus {
        clean: files.is_empty(),
        branch,
        upstream,
        ahead,
        behind,
        files,
    })
}

#[tauri::command]
pub fn git_branches(state: State<'_, AppState>) -> Result<Vec<Branch>, String> {
    let root = state.workspace_root()?;
    let raw = git(&root, &["branch", "--all", "--no-color", "--format=%(refname:short)|%(HEAD)"])?;
    let mut out = Vec::new();
    for line in raw.lines() {
        let mut it = line.split('|');
        let name = it.next().unwrap_or("").trim().to_string();
        if name.is_empty() || name.contains("HEAD") {
            continue;
        }
        let current = it.next().unwrap_or("").trim() == "*";
        let remote = name.starts_with("origin/") || name.starts_with("upstream/");
        out.push(Branch { name, current, remote });
    }
    Ok(out)
}

#[tauri::command]
pub fn git_stage(paths: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    let root = state.workspace_root()?;
    for p in paths {
        let abs = resolve_in_workspace(&root, &p)?;
        git(&root, &["add", "--", &abs.to_string_lossy()])?;
    }
    Ok(())
}

#[tauri::command]
pub fn git_unstage(paths: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    let root = state.workspace_root()?;
    for p in paths {
        let abs = resolve_in_workspace(&root, &p)?;
        git(&root, &["reset", "HEAD", "--", &abs.to_string_lossy()])?;
    }
    Ok(())
}

#[tauri::command]
pub fn git_stage_all(state: State<'_, AppState>) -> Result<(), String> {
    let root = state.workspace_root()?;
    git(&root, &["add", "-A"])?;
    Ok(())
}

#[tauri::command]
pub fn git_discard(paths: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    let root = state.workspace_root()?;
    for p in paths {
        let abs = resolve_in_workspace(&root, &p)?;
        let s = abs.to_string_lossy().to_string();
        let _ = git(&root, &["checkout", "--", &s]);
        let _ = git(&root, &["clean", "-fd", "--", &s]);
    }
    Ok(())
}

#[tauri::command]
pub fn git_commit(message: String, state: State<'_, AppState>) -> Result<String, String> {
    let root = state.workspace_root()?;
    git(&root, &["commit", "-m", &message])
}

#[tauri::command]
pub fn git_diff(path: String, staged: Option<bool>, state: State<'_, AppState>) -> Result<String, String> {
    let root = state.workspace_root()?;
    let abs = resolve_in_workspace(&root, &path)?;
    let mut args: Vec<String> = vec!["diff".into(), "--no-color".into()];
    if staged.unwrap_or(false) {
        args.push("--cached".into());
    }
    args.push("--".into());
    args.push(abs.to_string_lossy().to_string());
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    git(&root, &refs)
}

#[tauri::command]
pub fn git_log(limit: Option<usize>, state: State<'_, AppState>) -> Result<Vec<Commit>, String> {
    let root = state.workspace_root()?;
    let n = format!("-{}", limit.unwrap_or(50));
    let raw = git(
        &root,
        &["log", &n, "--date=short", "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s"],
    )?;
    Ok(raw
        .lines()
        .filter_map(|line| {
            let mut it = line.split('\u{1f}');
            Some(Commit {
                hash: it.next()?.to_string(),
                short: it.next()?.to_string(),
                author: it.next()?.to_string(),
                date: it.next()?.to_string(),
                subject: it.next().unwrap_or("").to_string(),
            })
        })
        .collect())
}

#[tauri::command]
pub fn git_checkout_branch(name: String, state: State<'_, AppState>) -> Result<String, String> {
    let root = state.workspace_root()?;
    git(&root, &["checkout", &name])
}

#[tauri::command]
pub fn git_create_branch(name: String, state: State<'_, AppState>) -> Result<String, String> {
    let root = state.workspace_root()?;
    git(&root, &["checkout", "-b", &name])
}

#[tauri::command]
pub async fn git_push(state: State<'_, AppState>) -> Result<String, String> {
    let root = state.workspace_root()?;
    tokio::task::spawn_blocking(move || git(&root, &["push"]))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_pull(state: State<'_, AppState>) -> Result<String, String> {
    let root = state.workspace_root()?;
    tokio::task::spawn_blocking(move || git(&root, &["pull", "--ff-only"]))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_fetch(state: State<'_, AppState>) -> Result<String, String> {
    let root = state.workspace_root()?;
    tokio::task::spawn_blocking(move || git(&root, &["fetch", "--all", "--prune"]))
        .await
        .map_err(|e| e.to_string())?
}

/* ------------------------------------------------------------- worktrees */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    /// Absolute path of the worktree.
    pub path: String,
    pub head: String,
    pub short: String,
    /// Branch name when attached (refs/heads/ stripped).
    pub branch: Option<String>,
    pub detached: bool,
    pub bare: bool,
    /// Reason when the worktree is locked.
    pub locked: Option<String>,
    /// Reason when git considers the worktree prunable (folder gone).
    pub prunable: Option<String>,
    /// The worktree that owns the repository (first entry).
    pub main: bool,
    /// The worktree currently open as the workspace.
    pub current: bool,
}

#[derive(Default)]
struct WorktreeBuilder {
    path: String,
    head: String,
    branch: Option<String>,
    detached: bool,
    bare: bool,
    locked: Option<String>,
    prunable: Option<String>,
}

fn flush_worktree(
    builder: WorktreeBuilder,
    out: &mut Vec<Worktree>,
    current: &str,
) {
    if builder.path.is_empty() {
        return;
    }
    let mut path = display_path(Path::new(&builder.path))
        .to_string_lossy()
        .to_string();
    #[cfg(windows)]
    {
        path = path.replace('/', "\\");
    }
    let main = out.is_empty();
    let short = builder.head.chars().take(7).collect::<String>();
    let is_current = normalise_path(&path) == current;
    out.push(Worktree {
        path,
        head: builder.head,
        short,
        branch: builder.branch,
        detached: builder.detached,
        bare: builder.bare,
        locked: builder.locked,
        prunable: builder.prunable,
        main,
        current: is_current,
    });
}

fn worktree_entries(root: &Path) -> Result<Vec<Worktree>, String> {
    let raw = git(root, &["worktree", "list", "--porcelain"])?;
    let current = normalise_path(&root.to_string_lossy());
    let mut out = Vec::new();
    let mut builder = WorktreeBuilder::default();
    for line in raw.lines() {
        if line.trim().is_empty() {
            let filled = std::mem::take(&mut builder);
            flush_worktree(filled, &mut out, &current);
            continue;
        }
        if let Some(rest) = line.strip_prefix("worktree ") {
            // Defensive: start a new block even without a blank separator.
            if !builder.path.is_empty() {
                let filled = std::mem::take(&mut builder);
                flush_worktree(filled, &mut out, &current);
            }
            builder.path = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("HEAD ") {
            builder.head = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("branch ") {
            builder.branch = Some(rest.trim().trim_start_matches("refs/heads/").to_string());
        } else if line.trim() == "detached" {
            builder.detached = true;
        } else if line.trim() == "bare" {
            builder.bare = true;
        } else if let Some(rest) = line.strip_prefix("locked") {
            builder.locked = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("prunable") {
            builder.prunable = Some(rest.trim().to_string());
        }
    }
    let filled = std::mem::take(&mut builder);
    flush_worktree(filled, &mut out, &current);
    Ok(out)
}

#[tauri::command]
pub fn git_worktrees(state: State<'_, AppState>) -> Result<Vec<Worktree>, String> {
    let root = state.workspace_root()?;
    worktree_entries(&root)
}

fn normalise_path(path: &str) -> String {
    let out = display_path(Path::new(path)).to_string_lossy().to_lowercase();
    #[cfg(windows)]
    let out = out.replace('/', "\\");
    out.trim_end_matches(std::path::MAIN_SEPARATOR).to_string()
}

/// Add a worktree. `branch` is required: an existing branch is checked out,
/// otherwise it is created from `base` (default: the current HEAD).
#[tauri::command]
pub fn git_worktree_add(
    path: String,
    branch: String,
    base: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let root = state.workspace_root()?;
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("a branch name is required".into());
    }
    let target = PathBuf::from(path.trim());
    if !target.is_absolute() {
        return Err("the worktree folder must be an absolute path".into());
    }
    let target = display_path(&target);
    let target_norm = normalise_path(&target.to_string_lossy());
    let root_norm = normalise_path(&root.to_string_lossy());
    if target_norm == root_norm
        || target_norm.starts_with(&format!("{root_norm}{}", std::path::MAIN_SEPARATOR))
    {
        return Err("pick a folder outside the current workspace".into());
    }
    let target_arg = target.to_string_lossy().to_string();
    let base = base.unwrap_or_default();
    let base = base.trim();

    let branch_exists = git(&root, &["rev-parse", "--verify", &format!("refs/heads/{branch}")]).is_ok();
    if branch_exists {
        return git(&root, &["worktree", "add", &target_arg, branch]);
    }
    if base.is_empty() {
        git(&root, &["worktree", "add", "-b", branch, &target_arg])
    } else {
        git(&root, &["worktree", "add", "-b", branch, &target_arg, base])
    }
}

#[tauri::command]
pub fn git_worktree_remove(
    path: String,
    force: Option<bool>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let root = state.workspace_root()?;
    let wanted = normalise_path(&path);
    let entries = worktree_entries(&root)?;
    let found = entries
        .iter()
        .find(|w| normalise_path(&w.path) == wanted)
        .ok_or("that folder is not a worktree of this repository")?;
    if found.current {
        return Err("you cannot remove the worktree that is currently open".into());
    }
    if found.main {
        return Err("the main worktree cannot be removed".into());
    }
    let mut args = vec!["worktree".to_string(), "remove".to_string()];
    if force.unwrap_or(false) {
        args.push("--force".to_string());
    }
    args.push(found.path.clone());
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    git(&root, &refs)
}

/// Remove metadata for worktrees whose folder was deleted outside Kodra.
#[tauri::command]
pub fn git_worktree_prune(state: State<'_, AppState>) -> Result<String, String> {
    let root = state.workspace_root()?;
    let stale = worktree_entries(&root)?
        .iter()
        .filter(|w| w.prunable.is_some())
        .count();
    git(&root, &["worktree", "prune"])?;
    Ok(if stale == 0 {
        "Nothing to prune".to_string()
    } else if stale == 1 {
        "Pruned 1 stale worktree".to_string()
    } else {
        format!("Pruned {stale} stale worktrees")
    })
}
