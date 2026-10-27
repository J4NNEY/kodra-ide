//! File checkpoints for agent edits.
//!
//! Before the agent writes a file we copy its previous contents into a
//! checkpoint directory under the app config dir. A checkpoint can then be
//! restored from the chat transcript, which puts every touched file back and
//! removes files the agent created.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::AppState;
use crate::util::{now_unix, resolve_in_workspace};

/// How many checkpoints to keep per workspace before pruning the oldest.
const KEEP: usize = 40;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Absolute path of the file when the checkpoint was taken.
    pub path: String,
    /// Workspace-relative path with forward slashes (for display).
    pub rel: String,
    /// False when the file did not exist yet (restore deletes it).
    pub existed: bool,
    pub size: u64,
    /// Blob file name inside the checkpoint directory.
    pub blob: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub id: String,
    pub label: String,
    pub created_at: i64,
    /// Workspace root the checkpoint belongs to.
    pub root: String,
    pub snapshots: Vec<Snapshot>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointFile {
    pub path: String,
    pub rel: String,
    pub existed: bool,
    pub changed: bool,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointSummary {
    pub id: String,
    pub label: String,
    pub created_at: i64,
    pub files: Vec<CheckpointFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotResult {
    pub checkpoint_id: String,
    pub created: bool,
    pub files: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub restored: usize,
    pub deleted: usize,
    pub skipped: usize,
}

fn timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_else(|_| now_unix() as i64)
}

fn workspace_key(root: &Path) -> String {
    // Stable FNV-1a hash so the folder name survives restarts.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in root.to_string_lossy().to_lowercase().bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "workspace".into());
    let safe: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(40)
        .collect();
    format!("{safe}-{hash:016x}")
}

fn checkpoints_root(state: &AppState, root: &Path) -> PathBuf {
    state
        .config_dir
        .read()
        .join("checkpoints")
        .join(workspace_key(root))
}

fn checkpoint_dir(state: &AppState, root: &Path, id: &str) -> PathBuf {
    checkpoints_root(state, root).join(id)
}

fn write_manifest(dir: &Path, checkpoint: &Checkpoint) -> Result<(), String> {
    let body = serde_json::to_string_pretty(checkpoint).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("manifest.json"), body).map_err(|e| e.to_string())
}

fn read_manifest(dir: &Path) -> Result<Checkpoint, String> {
    let body = std::fs::read_to_string(dir.join("manifest.json")).map_err(|e| e.to_string())?;
    serde_json::from_str(&body).map_err(|e| e.to_string())
}

fn load(state: &AppState, root: &Path, id: &str) -> Result<Checkpoint, String> {
    let dir = checkpoint_dir(state, root, id);
    if !dir.is_dir() {
        return Err("that checkpoint no longer exists".into());
    }
    let checkpoint = read_manifest(&dir)?;
    if checkpoint.root != root.to_string_lossy() {
        return Err("that checkpoint belongs to another workspace".into());
    }
    Ok(checkpoint)
}

fn rel_path(root: &Path, target: &Path) -> String {
    target
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| target.to_string_lossy().to_string())
}

fn file_changed(dir: &Path, snapshot: &Snapshot) -> bool {
    let current = Path::new(&snapshot.path);
    if !snapshot.existed {
        return current.exists();
    }
    match std::fs::read(current) {
        Ok(bytes) => match std::fs::read(dir.join(&snapshot.blob)) {
            Ok(original) => bytes != original,
            Err(_) => true,
        },
        Err(_) => true,
    }
}

fn summarise(dir: &Path, checkpoint: &Checkpoint) -> CheckpointSummary {
    CheckpointSummary {
        id: checkpoint.id.clone(),
        label: checkpoint.label.clone(),
        created_at: checkpoint.created_at,
        files: checkpoint
            .snapshots
            .iter()
            .map(|s| CheckpointFile {
                path: s.path.clone(),
                rel: s.rel.clone(),
                existed: s.existed,
                changed: file_changed(dir, s),
                size: s.size,
            })
            .collect(),
    }
}

/// Drop the oldest checkpoints once a workspace accumulates too many.
fn prune(state: &AppState, root: &Path) {
    let base = checkpoints_root(state, root);
    let Ok(entries) = std::fs::read_dir(&base) else {
        return;
    };
    let mut found: Vec<(i64, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let dir = entry.path();
            if !dir.is_dir() {
                return None;
            }
            let created = read_manifest(&dir).map(|c| c.created_at).unwrap_or(0);
            Some((created, dir))
        })
        .collect();
    if found.len() <= KEEP {
        return;
    }
    found.sort_by_key(|(created, _)| *created);
    let excess = found.len().saturating_sub(KEEP);
    for (_, dir) in found.into_iter().take(excess) {
        let _ = std::fs::remove_dir_all(dir);
    }
}

/// Snapshot one file before the agent overwrites it. Passing no checkpoint id
/// starts a new checkpoint and returns its id.
#[tauri::command]
pub fn checkpoint_snapshot(
    id: Option<String>,
    path: String,
    label: Option<String>,
    state: State<'_, AppState>,
) -> Result<SnapshotResult, String> {
    let root = state.workspace_root()?;
    let target = resolve_in_workspace(&root, &path)?;
    if target.is_dir() {
        return Err("folders cannot be checkpointed".into());
    }

    let existing = match id.as_deref() {
        Some(id) if !id.is_empty() => load(&state, &root, id).ok(),
        _ => None,
    };
    let mut checkpoint = existing.unwrap_or_else(|| Checkpoint {
        id: uuid::Uuid::new_v4().to_string(),
        label: label.clone().unwrap_or_default(),
        created_at: timestamp(),
        root: root.to_string_lossy().to_string(),
        snapshots: Vec::new(),
    });

    let absolute = target.to_string_lossy().to_string();
    let files = checkpoint.snapshots.len();
    if checkpoint.snapshots.iter().any(|s| s.path == absolute) {
        return Ok(SnapshotResult {
            checkpoint_id: checkpoint.id,
            created: false,
            files,
        });
    }

    let dir = checkpoint_dir(&state, &root, &checkpoint.id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let existed = target.is_file();
    let bytes = if existed {
        std::fs::read(&target).map_err(|e| e.to_string())?
    } else {
        Vec::new()
    };
    let blob = if existed {
        let name = format!("{}.blob", checkpoint.snapshots.len());
        std::fs::write(dir.join(&name), &bytes).map_err(|e| e.to_string())?;
        name
    } else {
        String::new()
    };

    checkpoint.snapshots.push(Snapshot {
        path: absolute,
        rel: rel_path(&root, &target),
        existed,
        size: bytes.len() as u64,
        blob,
    });
    write_manifest(&dir, &checkpoint)?;
    if checkpoint.snapshots.len() == 1 {
        prune(&state, &root);
    }

    Ok(SnapshotResult {
        checkpoint_id: checkpoint.id,
        created: true,
        files: checkpoint.snapshots.len(),
    })
}

#[tauri::command]
pub fn checkpoint_get(id: String, state: State<'_, AppState>) -> Result<CheckpointSummary, String> {
    let root = state.workspace_root()?;
    let checkpoint = load(&state, &root, &id)?;
    Ok(summarise(&checkpoint_dir(&state, &root, &id), &checkpoint))
}

/// Recent checkpoints for the open workspace, newest first.
#[tauri::command]
pub fn checkpoint_list(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<CheckpointSummary>, String> {
    let root = state.workspace_root()?;
    let base = checkpoints_root(&state, &root);
    let Ok(entries) = std::fs::read_dir(&base) else {
        return Ok(Vec::new());
    };
    let mut found: Vec<Checkpoint> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| read_manifest(&e.path()).ok())
        .filter(|c| c.root == root.to_string_lossy())
        .collect();
    found.sort_by_key(|c| -c.created_at);
    Ok(found
        .into_iter()
        .take(limit.unwrap_or(20))
        .map(|checkpoint| {
            let dir = checkpoint_dir(&state, &root, &checkpoint.id);
            summarise(&dir, &checkpoint)
        })
        .collect())
}

/// Put every snapshotted file back the way it was before the agent ran.
#[tauri::command]
pub fn checkpoint_restore(id: String, state: State<'_, AppState>) -> Result<RestoreResult, String> {
    let root = state.workspace_root()?;
    let checkpoint = load(&state, &root, &id)?;
    let dir = checkpoint_dir(&state, &root, &id);

    let mut restored = 0usize;
    let mut deleted = 0usize;
    let mut skipped = 0usize;

    // Reverse order so a file touched twice returns to its first state.
    for snapshot in checkpoint.snapshots.iter().rev() {
        let Ok(target) = resolve_in_workspace(&root, &snapshot.path) else {
            skipped += 1;
            continue;
        };
        if snapshot.existed {
            let bytes = std::fs::read(dir.join(&snapshot.blob)).map_err(|e| e.to_string())?;
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
            restored += 1;
        } else if target.exists() {
            if target.is_dir() {
                skipped += 1;
            } else {
                std::fs::remove_file(&target).map_err(|e| e.to_string())?;
                deleted += 1;
            }
        }
    }

    Ok(RestoreResult {
        restored,
        deleted,
        skipped,
    })
}

/// Delete every checkpoint of the open workspace.
#[tauri::command]
pub fn checkpoint_clear(state: State<'_, AppState>) -> Result<(), String> {
    let root = state.workspace_root()?;
    let base = checkpoints_root(&state, &root);
    if base.is_dir() {
        std::fs::remove_dir_all(&base).map_err(|e| e.to_string())?;
    }
    Ok(())
}
