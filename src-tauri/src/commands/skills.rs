use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub path: String,
    pub source: String,
}

fn parse_front_matter(raw: &str) -> (String, String) {
    let mut name = String::new();
    let mut description = String::new();
    if let Some(rest) = raw.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let block = &rest[..end];
            for line in block.lines() {
                let Some((key, value)) = line.split_once(':') else {
                    continue;
                };
                let key = key.trim().to_ascii_lowercase();
                let value = value.trim().trim_matches('"').trim_matches('\'').to_string();
                match key.as_str() {
                    "name" => name = value,
                    "description" => description = value,
                    _ => {}
                }
            }
        }
    }
    (name, description)
}

fn scan_root(root: &Path, source: &str, out: &mut Vec<Skill>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            // Flat `name.md` skills are accepted too.
            if dir.extension().and_then(|e| e.to_str()) == Some("md") {
                if let Ok(raw) = std::fs::read_to_string(&dir) {
                    let (name, description) = parse_front_matter(&raw);
                    out.push(Skill {
                        name: if name.is_empty() {
                            dir.file_stem().and_then(|s| s.to_str()).unwrap_or("skill").into()
                        } else {
                            name
                        },
                        description,
                        path: dir.to_string_lossy().to_string(),
                        source: source.into(),
                    });
                }
            }
            continue;
        }
        let manifest = dir.join("SKILL.md");
        if !manifest.exists() {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&manifest) else {
            continue;
        };
        let (name, description) = parse_front_matter(&raw);
        out.push(Skill {
            name: if name.is_empty() {
                dir.file_name().and_then(|s| s.to_str()).unwrap_or("skill").into()
            } else {
                name
            },
            description,
            path: manifest.to_string_lossy().to_string(),
            source: source.into(),
        });
    }
}

fn roots(state: &AppState) -> Vec<(PathBuf, String)> {
    let mut out = Vec::new();
    if let Ok(root) = state.workspace_root() {
        // Projects that predate the rename keep their `.kudo` folder working.
        let skills = root.join(".kodra").join("skills");
        let legacy = root.join(".kudo").join("skills");
        let workspace_skills = if skills.exists() || !legacy.exists() {
            skills
        } else {
            legacy
        };
        out.push((workspace_skills, "workspace".into()));
        out.push((root.join(".claude").join("skills"), "workspace".into()));
    }
    let config = state.config_dir.read().clone();
    out.push((config.join("skills"), "user".into()));
    out
}

/// List skills discovered in `<workspace>/.kodra/skills`,
/// `<workspace>/.claude/skills` and the user config directory.
#[tauri::command]
pub async fn skills_list(state: State<'_, AppState>) -> Result<Vec<Skill>, String> {
    let mut out = Vec::new();
    for (root, source) in roots(&state) {
        scan_root(&root, &source, &mut out);
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out.dedup_by(|a, b| a.name == b.name && a.path == b.path);
    Ok(out)
}

#[tauri::command]
pub async fn skill_read(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("skill not found: {path}"));
    }
    let raw = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    if raw.len() > 200_000 {
        return Err("skill file is too large to display".into());
    }
    Ok(raw)
}

#[tauri::command]
pub async fn skill_save(path: String, text: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, text).map_err(|e| e.to_string())
}

/// Create the workspace skills directory and a starter skill so the feature can
/// be discovered without reading docs.
#[tauri::command]
pub async fn skill_scaffold(name: String, state: State<'_, AppState>) -> Result<String, String> {
    let root = state.workspace_root()?;
    let slug: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        return Err("skill name is required".into());
    }
    let dir = root.join(".kodra").join("skills").join(&slug);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let manifest = dir.join("SKILL.md");
    if !manifest.exists() {
        let body = format!(
            "---\nname: {slug}\ndescription: Describe what this skill does and when to use it.\n---\n\n# {name}\n\n## When to use\n\n- ...\n\n## Steps\n\n1. ...\n"
        );
        std::fs::write(&manifest, body).map_err(|e| e.to_string())?;
    }
    Ok(manifest.to_string_lossy().to_string())
}
