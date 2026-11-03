use std::time::Instant;

use serde::Serialize;
use tauri::State;

use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub content_type: String,
    pub duration_ms: u64,
    pub truncated: bool,
}

/// HTTP proxy used by the in-app browser's "request inspector". Running the
/// request in Rust bypasses the webview's CORS rules so local APIs and
/// authenticated endpoints can be exercised from the preview panel.
#[tauri::command]
pub async fn browser_fetch(
    url: String,
    method: Option<String>,
    headers: Option<Vec<(String, String)>>,
    body: Option<String>,
    state: State<'_, AppState>,
) -> Result<FetchResponse, String> {
    let method = method.unwrap_or_else(|| "GET".into()).to_uppercase();
    let started = Instant::now();

    let client = reqwest::Client::builder()
        .user_agent("Kodra/0.1 (browser-preview)")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("only http(s) URLs can be fetched".into());
    }

    let verb = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = client.request(verb, parsed);
    for (key, value) in headers.unwrap_or_default() {
        req = req.header(key, value);
    }
    if let Some(payload) = body {
        if !payload.is_empty() {
            req = req.body(payload);
        }
    }

    let response = match req.send().await {
        Ok(response) => response,
        Err(err) => {
            state.log_net("http", &method, &url, None, started.elapsed().as_millis() as u64, 0, Some(&err.to_string()));
            return Err(format!("request failed: {err}"));
        }
    };

    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    const LIMIT: usize = 900_000;
    let truncated = bytes.len() > LIMIT;
    let slice = if truncated { &bytes[..LIMIT] } else { &bytes[..] };
    let body = String::from_utf8_lossy(slice).to_string();

    let duration_ms = started.elapsed().as_millis() as u64;
    state.log_net(
        "http",
        &method,
        &url,
        Some(status.as_u16()),
        duration_ms,
        bytes.len(),
        None,
    );

    Ok(FetchResponse {
        status: status.as_u16(),
        status_text,
        headers,
        body,
        content_type,
        duration_ms,
        truncated,
    })
}

/// Open a URL in the user's default browser instead of the embedded preview.
#[tauri::command]
pub async fn browser_open_external(url: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("only http(s) URLs are supported".into());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", parsed.as_str()])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(parsed.as_str())
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(parsed.as_str())
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
