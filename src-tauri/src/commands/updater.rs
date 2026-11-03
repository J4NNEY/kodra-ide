use std::path::PathBuf;

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
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
    pub sha256: Option<String>,
    pub feed: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub path: String,
    pub bytes: usize,
    pub file_name: String,
    pub verified: bool,
}

fn parse_version(raw: &str) -> Vec<u64> {
    let core = raw.trim().trim_start_matches('v');
    // A prerelease suffix ("1.0.0-rc.1") does not make a build newer than the
    // final release, so compare only the numeric core.
    let core = core.split(['-', '+']).next().unwrap_or(core);
    core.split('.')
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

const UPDATE_DIR: &str = "kodra-updates";
const MAX_DOWNLOAD_BYTES: usize = 300 * 1024 * 1024;

fn is_local_host(host: &str) -> bool {
    // `Url::host_str` keeps the brackets around IPv6 addresses.
    let host = host
        .strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host);
    host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1"
}

/// Update traffic must be encrypted; plain HTTP is only tolerated for a local
/// test feed.
fn secure_url(raw: &str, what: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|e| format!("invalid {what} URL: {e}"))?;
    let secure =
        url.scheme() == "https" || (url.scheme() == "http" && url.host_str().is_some_and(is_local_host));
    if !secure {
        return Err(format!(
            "{what} must use https (plain http is only allowed for localhost)"
        ));
    }
    Ok(url)
}

fn update_dir() -> PathBuf {
    std::env::temp_dir().join(UPDATE_DIR)
}

/// Keep only the final path component so a manifest cannot write outside the
/// update folder.
fn safe_file_name(raw: &str) -> Option<String> {
    let name = raw.rsplit(['/', '\\']).next()?.trim();
    if name.is_empty() || name == "." || name == ".." {
        return None;
    }
    Some(name.to_string())
}

fn normalise_sha256(raw: &str) -> Option<String> {
    let value = raw.trim().trim_start_matches("sha256:").trim();
    if value.len() == 64 && value.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(value.to_ascii_lowercase())
    } else {
        None
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Fetch a Tauri-style update manifest and compare it with this build.
#[tauri::command]
pub async fn update_check(feed_url: String, current: Option<String>) -> Result<UpdateCheck, String> {
    let feed = feed_url.trim().to_string();
    if feed.is_empty() {
        return Err("Set an update feed URL in Settings → About first".into());
    }
    let feed_url = secure_url(&feed, "update feed")?;
    let current = current.unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());

    let response = reqwest::Client::builder()
        .user_agent(format!("Kodra/{} updater", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?
        .get(feed_url)
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

    let sha256 = manifest
        .get("platforms")
        .and_then(|p| p.get(platform_key()))
        .and_then(|p| p.get("sha256"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            manifest
                .get("sha256")
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
        sha256,
        feed,
    })
}

#[tauri::command]
pub async fn update_download(
    url: String,
    file_name: Option<String>,
    sha256: Option<String>,
    state: State<'_, AppState>,
) -> Result<DownloadResult, String> {
    let expected = sha256
        .as_deref()
        .and_then(normalise_sha256)
        .ok_or("update feed is missing a valid sha256 checksum for this platform")?;
    let parsed = secure_url(&url, "update download")?;
    let started = std::time::Instant::now();
    let response = reqwest::Client::builder()
        .user_agent(format!("Kodra/{} updater", env!("CARGO_PKG_VERSION")))
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
    if let Some(length) = response.content_length() {
        if length > MAX_DOWNLOAD_BYTES as u64 {
            return Err("update download is larger than 300 MB".into());
        }
    }

    let name = file_name
        .as_deref()
        .and_then(safe_file_name)
        .or_else(|| {
            parsed
                .path_segments()
                .and_then(|mut segments| segments.next_back())
                .and_then(safe_file_name)
        })
        .unwrap_or_else(|| "kodra-update.bin".to_string());

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_DOWNLOAD_BYTES {
        return Err("update download is larger than 300 MB".into());
    }
    let actual = sha256_hex(&bytes);
    if actual != expected {
        return Err(format!(
            "update checksum mismatch (expected {expected}, got {actual}); the download was discarded"
        ));
    }

    let dir = update_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(&name);
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
        verified: true,
    })
}

/// Launch the downloaded installer. The app keeps running; on Windows the
/// installer takes over and the user closes Kodra when prompted.
#[tauri::command]
pub async fn update_install(path: String) -> Result<(), String> {
    let file = PathBuf::from(&path);
    if !file.exists() {
        return Err(format!("installer not found: {path}"));
    }
    let dir = update_dir();
    let canon_dir = dir
        .canonicalize()
        .map_err(|_| "no update has been downloaded yet".to_string())?;
    let canon = file.canonicalize().map_err(|e| e.to_string())?;
    if canon.parent() != Some(canon_dir.as_path()) {
        return Err("installer must be inside the Kodra update folder".into());
    }
    let path = canon.to_string_lossy().to_string();
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    let ext = canon
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    #[cfg(target_os = "windows")]
    if !matches!(ext.as_str(), "exe" | "msi") {
        return Err("unsupported installer type (expected .exe or .msi)".into());
    }
    #[cfg(target_os = "macos")]
    if !matches!(ext.as_str(), "dmg" | "pkg") {
        return Err("unsupported installer type (expected .dmg or .pkg)".into());
    }

    #[cfg(target_os = "windows")]
    {
        if ext == "msi" {
            std::process::Command::new("msiexec")
                .args(["/i", &path])
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new(&path)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_plain_semver() {
        assert!(is_newer("1.0.0", "0.12.1"));
        assert!(is_newer("0.13.0", "0.12.9"));
        assert!(!is_newer("0.12.1", "0.12.1"));
        assert!(!is_newer("0.12.0", "0.12.1"));
    }

    #[test]
    fn ignores_prefix_and_prerelease_suffix() {
        assert!(is_newer("v1.1", "1.0.9"));
        assert!(is_newer("1.0.0-rc.1", "0.9.0"));
        assert!(!is_newer("1.0.0-rc.1", "1.0.0"));
    }

    #[test]
    fn pads_short_versions_with_zero() {
        assert!(is_newer("1.1", "1.0.9"));
        assert!(!is_newer("1.0", "1.0.1"));
    }

    #[test]
    fn rejects_plain_http_update_urls() {
        assert!(secure_url("https://example.com/latest.json", "feed").is_ok());
        assert!(secure_url("http://localhost:8787/latest.json", "feed").is_ok());
        assert!(secure_url("http://127.0.0.1/latest.json", "feed").is_ok());
        assert!(secure_url("http://[::1]:8787/latest.json", "feed").is_ok());
        assert!(secure_url("http://example.com/latest.json", "feed").is_err());
        assert!(secure_url("ftp://example.com/latest.json", "feed").is_err());
        assert!(secure_url("file:///C:/tmp/latest.json", "feed").is_err());
        assert!(secure_url("not a url", "feed").is_err());
    }

    #[test]
    fn strips_directories_from_download_names() {
        assert_eq!(safe_file_name("Kodra_1.0.0_x64-setup.exe").as_deref(), Some("Kodra_1.0.0_x64-setup.exe"));
        assert_eq!(safe_file_name("../../evil.exe").as_deref(), Some("evil.exe"));
        assert_eq!(safe_file_name("..\\..\\evil.msi").as_deref(), Some("evil.msi"));
        assert_eq!(safe_file_name("  spaced.exe  ").as_deref(), Some("spaced.exe"));
        assert_eq!(safe_file_name(""), None);
        assert_eq!(safe_file_name(".."), None);
        assert_eq!(safe_file_name("dir/"), None);
    }

    #[test]
    fn accepts_only_64_hex_checksums() {
        let hex = "a".repeat(64);
        assert_eq!(normalise_sha256(&hex), Some(hex.clone()));
        assert_eq!(normalise_sha256(&format!("sha256:{hex}")), Some(hex.clone()));
        assert_eq!(normalise_sha256("A".repeat(64).as_str()), Some("a".repeat(64)));
        assert_eq!(normalise_sha256("abc"), None);
        assert_eq!(normalise_sha256(&"g".repeat(64)), None);
        assert_eq!(normalise_sha256(""), None);
    }

    #[test]
    fn hashes_known_input() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
