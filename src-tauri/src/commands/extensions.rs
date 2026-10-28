use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::state::AppState;

/// An extension is a folder with an `extension.json` manifest. Manifests are
/// declarative: they can contribute colour themes and snippets, never code.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInfo {
    /// Folder name inside `<config>/extensions` (the stable handle).
    pub folder: String,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub path: String,
    pub enabled: bool,
    pub themes: Vec<Value>,
    pub snippets: Vec<Value>,
    /// Set when the manifest could not be read or parsed.
    pub error: Option<String>,
}

fn extensions_dir(state: &AppState) -> PathBuf {
    state.config_dir.read().join("extensions")
}

fn text(manifest: &Value, key: &str) -> String {
    manifest
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

fn contributions(manifest: &Value, key: &str) -> Vec<Value> {
    manifest
        .get(key)
        .and_then(Value::as_array)
        .map(|items| items.iter().filter(|item| item.is_object()).cloned().collect())
        .unwrap_or_default()
}

fn read_manifest(path: &Path) -> Result<Value, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    if raw.len() > 512 * 1024 {
        return Err("extension.json is too large".into());
    }
    let parsed: Value = serde_json::from_str(&raw).map_err(|e| format!("invalid JSON: {e}"))?;
    if !parsed.is_object() {
        return Err("extension.json must contain an object".into());
    }
    Ok(parsed)
}

fn info_from(folder: &str, dir: &Path, manifest: &Value, error: Option<String>) -> ExtensionInfo {
    let id = {
        let raw = text(manifest, "id");
        if raw.is_empty() {
            folder.to_string()
        } else {
            raw
        }
    };
    let name = {
        let raw = text(manifest, "name");
        if raw.is_empty() {
            id.clone()
        } else {
            raw
        }
    };
    let enabled = manifest
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    ExtensionInfo {
        folder: folder.to_string(),
        id,
        name,
        version: text(manifest, "version"),
        description: text(manifest, "description"),
        author: text(manifest, "author"),
        path: dir.to_string_lossy().to_string(),
        enabled,
        themes: contributions(manifest, "themes"),
        snippets: contributions(manifest, "snippets"),
        error,
    }
}

/// List every installed extension, including ones with a broken manifest.
#[tauri::command]
pub async fn extensions_list(state: State<'_, AppState>) -> Result<Vec<ExtensionInfo>, String> {
    let dir = extensions_dir(&state);
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(out);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let folder = entry.file_name().to_string_lossy().to_string();
        let manifest_path = path.join("extension.json");
        if !manifest_path.exists() {
            continue;
        }
        match read_manifest(&manifest_path) {
            Ok(manifest) => out.push(info_from(&folder, &path, &manifest, None)),
            Err(err) => {
                let empty = Value::Object(Default::default());
                out.push(info_from(&folder, &path, &empty, Some(err)));
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Absolute path of the extensions folder (shown in the UI).
#[tauri::command]
pub fn extensions_dir_path(state: State<'_, AppState>) -> Result<String, String> {
    let dir = extensions_dir(&state);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    let entries = std::fs::read_dir(from).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let source = entry.path();
        let target = to.join(entry.file_name());
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            copy_dir(&source, &target)?;
        } else if kind.is_file() {
            std::fs::copy(&source, &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn slug(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

/// Copy an unpacked extension folder into the user extensions directory.
#[tauri::command]
pub async fn extension_install(source: String, state: State<'_, AppState>) -> Result<String, String> {
    let from = PathBuf::from(source.trim());
    if !from.is_dir() {
        return Err("pick a folder that contains an extension.json".into());
    }
    let manifest_path = from.join("extension.json");
    if !manifest_path.exists() {
        return Err("that folder has no extension.json".into());
    }
    let manifest = read_manifest(&manifest_path)?;
    if text(&manifest, "name").is_empty() {
        return Err("extension.json needs a name".into());
    }
    let folder = {
        let id = slug(&text(&manifest, "id"));
        if id.is_empty() {
            slug(from.file_name().and_then(|s| s.to_str()).unwrap_or("extension"))
        } else {
            id
        }
    };
    if folder.is_empty() {
        return Err("could not derive a folder name for this extension".into());
    }
    let dir = extensions_dir(&state);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(&folder);
    if target.exists() {
        return Err(format!("{folder} is already installed"));
    }
    copy_dir(&from, &target)?;
    Ok(target.to_string_lossy().to_string())
}

fn checked_dir(state: &AppState, folder: &str) -> Result<PathBuf, String> {
    if folder.is_empty()
        || folder.contains('/')
        || folder.contains('\\')
        || folder == "."
        || folder == ".."
    {
        return Err("invalid extension folder".into());
    }
    let dir = extensions_dir(state).join(folder);
    if !dir.is_dir() {
        return Err(format!("{folder} is not installed"));
    }
    Ok(dir)
}

/// Toggle an extension. The flag lives in the manifest so it survives restarts
/// and stays visible to anyone reading the folder.
#[tauri::command]
pub async fn extension_set_enabled(
    folder: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let dir = checked_dir(&state, &folder)?;
    let manifest_path = dir.join("extension.json");
    let mut manifest = read_manifest(&manifest_path)?;
    let Some(object) = manifest.as_object_mut() else {
        return Err("extension.json must contain an object".into());
    };
    object.insert("enabled".into(), Value::Bool(enabled));
    let raw = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    std::fs::write(manifest_path, format!("{raw}\n")).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn extension_remove(folder: String, state: State<'_, AppState>) -> Result<(), String> {
    let dir = checked_dir(&state, &folder)?;
    std::fs::remove_dir_all(dir).map_err(|e| e.to_string())
}
