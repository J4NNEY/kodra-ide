use std::path::PathBuf;

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current_version: String,
    pub latest_version: String,
    pub available: bool,
    pub notes: String,
    pub published_at: String,
    pub url: Option<String>,
    pub feed: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub path: String,
    pub bytes: usize,
    pub file_name: String,
}

fn parse_version(raw: &str) -> Vec<u64> {
    raw.trim()
        .trim_start_matches('v')
        .split(['.', '-', '+'])
        .map(|part| part.parse::<u64>().unwrap_or(0))
        .collect()
}

fn is_newer(latest: &str, current: &str) -> bool {
    let a = parse_version(latest);
    let b = parse_version(current);
    for idx in 0..a.len().max(b.len()) {
        let left = *a.get(idx).unwrap_or(&0);
        let right = *b.get(idx).unwrap_or(&0);
        if left != right {
            return left > right;
        }
    }
    false
}

fn platform_key() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "windows-x86_64"
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        "windows-aarch64"
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "darwin-aarch64"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "darwin-x86_64"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "linux-x86_64"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "linux-aarch64"
    }
}

/// Fetch a Tauri-style update manifest and compare it with this build.
#[tauri::command]
pub async fn update_check(feed_url: String, current: Option<String>) -> Result<UpdateCheck, String> {
    let feed = feed_url.trim().to_string();
    if feed.is_empty() {
        return Err("Set an update feed URL in Settings → About first".into());
    }
    let current = current.unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());

    let response = reqwest::Client::builder()
        .user_agent("Kudo/0.1 updater")
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?
        .get(&feed)
        .send()
        .await
        .map_err(|e| format!("update feed unreachable: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("update feed returned HTTP {}", response.status()));
    }

    let manifest: Value = response
        .json()
        .await
        .map_err(|e| format!("update feed is not valid JSON: {e}"))?;

    let latest = manifest
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if latest.is_empty() {
        return Err("update feed has no `version` field".into());
    }

    let notes = manifest
        .get("notes")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let published_at = manifest
        .get("pub_date")
        .or_else(|| manifest.get("publishedAt"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let url = manifest
        .get("platforms")
        .and_then(|p| p.get(platform_key()))
        .and_then(|p| p.get("url"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            manifest
                .get("url")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        });

    Ok(UpdateCheck {
        available: is_newer(&latest, &current),
        current_version: current,
        latest_version: latest,
        notes,
        published_at,
        url,
        feed,
    })
}

#[tauri::command]
pub async fn update_download(
    url: String,
    file_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<DownloadResult, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("only http(s) downloads are supported".into());
    }
    let started = std::time::Instant::now();
    let response = reqwest::Client::builder()
        .user_agent("Kudo/0.1 updater")
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?
        .get(parsed.clone())
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("download failed with HTTP {}", response.status()));
    }

    let name = file_name
        .filter(|n| !n.trim().is_empty())
        .or_else(|| {
            parsed
                .path_segments()
                .and_then(|mut segments| segments.next_back())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "kudo-update.bin".to_string());

    let dir: PathBuf = std::env::temp_dir().join("kudo-updates");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(&name);
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&target, &bytes).map_err(|e| e.to_string())?;

    state.log_net(
        "update",
        "GET",
        &url,
        Some(200),
        started.elapsed().as_millis() as u64,
        bytes.len(),
        None,
    );

    Ok(DownloadResult {
        path: target.to_string_lossy().to_string(),
        bytes: bytes.len(),
        file_name: name,
    })
}

/// Launch the downloaded installer. The app keeps running; on Windows the
/// installer takes over and the user closes Kudo when prompted.
#[tauri::command]
pub async fn update_install(path: String) -> Result<(), String> {
    let file = PathBuf::from(&path);
    if !file.exists() {
        return Err(format!("installer not found: {path}"));
    }
    let lower = path.to_ascii_lowercase();

    #[cfg(target_os = "windows")]
    {
        if lower.ends_with(".msi") {
            std::process::Command::new("msiexec")
                .args(["/i", &path])
                .spawn()
                .map_err(|e| e.to_string())?;
        } else if lower.ends_with(".exe") {
            std::process::Command::new(&path)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("rundll32")
                .args(["shell32.dll,ShellExec_RunDLL", &path])
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn update_reveal(path: String) -> Result<(), String> {
    let file = PathBuf::from(&path);
    if !file.exists() {
        return Err("file no longer exists".into());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(parent) = file.parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
