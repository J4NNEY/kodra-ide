use serde::Serialize;
use tauri::State;

use crate::state::AppState;
use crate::util::{git, resolve_in_workspace};

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
