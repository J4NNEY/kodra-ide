use serde::Serialize;
use tauri::State;

use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetEntry {
    pub id: u64,
    pub kind: String,
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub duration_ms: u64,
    pub bytes: usize,
    pub error: Option<String>,
    pub at: u64,
}

/// Newest-first network activity captured by the AI client, the browser proxy
/// and the updater. The renderer polls this from the Output panel.
#[tauri::command]
pub async fn netlog_list(limit: Option<usize>, state: State<'_, AppState>) -> Result<Vec<NetEntry>, String> {
    let log = state.netlog.lock();
    let limit = limit.unwrap_or(300).min(2_000);
    Ok(log.iter().rev().take(limit).cloned().collect())
}

#[tauri::command]
pub async fn netlog_clear(state: State<'_, AppState>) -> Result<(), String> {
    state.netlog.lock().clear();
    Ok(())
}

/// Lightweight timing probe used by the browser preview status bar.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResult {
    pub ok: bool,
    pub status: Option<u16>,
    pub latency_ms: u64,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn browser_ping(url: String) -> Result<PingResult, String> {
    let started = std::time::Instant::now();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    match client.head(&url).send().await {
        Ok(response) => Ok(PingResult {
            ok: response.status().is_success() || response.status().is_redirection(),
            status: Some(response.status().as_u16()),
            latency_ms: started.elapsed().as_millis() as u64,
            error: None,
        }),
        Err(err) => Ok(PingResult {
            ok: false,
            status: None,
            latency_ms: started.elapsed().as_millis() as u64,
            error: Some(err.to_string()),
        }),
    }
}
