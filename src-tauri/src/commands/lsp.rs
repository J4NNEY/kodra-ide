use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};

use crate::state::{AppState, LspSession};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspStartResult {
    pub id: String,
    pub name: String,
    pub server_info: Value,
    pub capabilities: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspStartRequest {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub root_uri: Option<String>,
}

impl LspSession {
    async fn send(&mut self, payload: &Value) -> Result<(), String> {
        let body = serde_json::to_string(payload).map_err(|e| e.to_string())?;
        let framed = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
        self.stdin
            .write_all(framed.as_bytes())
            .await
            .map_err(|e| format!("lsp write: {e}"))?;
        self.stdin.flush().await.map_err(|e| e.to_string())
    }

    async fn read_message(&mut self, deadline: tokio::time::Instant) -> Result<Value, String> {
        let mut length: Option<usize> = None;
        loop {
            let mut header = String::new();
            let read = tokio::time::timeout_at(deadline, self.reader.read_line(&mut header)).await;
            let read = match read {
                Ok(res) => res.map_err(|e| format!("lsp read: {e}"))?,
                Err(_) => return Err("language server timed out".into()),
            };
            if read == 0 {
                return Err("language server closed the connection".into());
            }
            let line = header.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                break;
            }
            if let Some(rest) = line.strip_prefix("Content-Length:") {
                length = rest.trim().parse::<usize>().ok();
            }
        }
        let length = length.ok_or("language server sent no Content-Length")?;
        let mut body = vec![0u8; length];
        tokio::time::timeout_at(deadline, self.reader.read_exact(&mut body))
            .await
            .map_err(|_| "language server timed out".to_string())?
            .map_err(|e| format!("lsp read body: {e}"))?;
        serde_json::from_slice(&body).map_err(|e| format!("lsp json: {e}"))
    }

    pub async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(self.timeout_secs);
        loop {
            let message = self.read_message(deadline).await?;
            if message.get("id").and_then(|v| v.as_i64()) == Some(id) {
                if let Some(error) = message.get("error") {
                    let text = error
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("language server error");
                    return Err(text.to_string());
                }
                return Ok(message.get("result").cloned().unwrap_or(Value::Null));
            }
            if message.get("method").is_some() {
                if message.get("id").is_some() {
                    // Server-initiated request: acknowledge so it does not block.
                    let reply_id = message.get("id").cloned().unwrap_or(Value::Null);
                    self.send(&json!({ "jsonrpc": "2.0", "id": reply_id, "result": null }))
                        .await?;
                }
                continue;
            }
        }
    }

    pub async fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.send(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
            .await
    }
}

#[tauri::command]
pub async fn lsp_start(
    req: LspStartRequest,
    state: State<'_, AppState>,
) -> Result<LspStartResult, String> {
    let mut cmd = tokio::process::Command::new(&req.command);
    cmd.args(&req.args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);

    let mut child: Child = cmd
        .spawn()
        .map_err(|e| format!("could not start `{}`: {e}", req.command))?;
    let stdin: ChildStdin = child.stdin.take().ok_or("language server has no stdin")?;
    let stdout: ChildStdout = child.stdout.take().ok_or("language server has no stdout")?;

    let id = uuid::Uuid::new_v4().to_string();
    let mut session = LspSession {
        child,
        stdin,
        reader: BufReader::new(stdout),
        next_id: 0,
        timeout_secs: 20,
        name: req.name.clone(),
        root_uri: req.root_uri.clone(),
        opened: HashMap::new(),
    };

    let root_uri = req.root_uri.clone().unwrap_or_else(|| "file:///".into());
    let initialized = session
        .request(
            "initialize",
            json!({
                "processId": std::process::id(),
                "rootUri": root_uri,
                "capabilities": {
                    "textDocument": {
                        "synchronization": { "didSave": true, "dynamicRegistration": false },
                        "completion": { "completionItem": { "snippetSupport": true } },
                        "hover": { "contentFormat": ["markdown", "plaintext"] },
                        "publishDiagnostics": { "relatedInformation": true }
                    }
                },
                "clientInfo": { "name": "kudo", "version": "0.1.0" }
            }),
        )
        .await
        .map_err(|e| format!("initialize failed: {e}"))?;

    session
        .notify("initialized", json!({}))
        .await
        .map_err(|e| e.to_string())?;

    let server_info = initialized.get("serverInfo").cloned().unwrap_or(Value::Null);
    let capabilities = initialized.get("capabilities").cloned().unwrap_or(Value::Null);
    state.lsp.lock().await.insert(id.clone(), session);

    Ok(LspStartResult {
        id,
        name: req.name,
        server_info,
        capabilities,
    })
}

#[tauri::command]
pub async fn lsp_stop(id: String, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(mut session) = state.lsp.lock().await.remove(&id) {
        let _ = session.child.kill().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn lsp_request(
    id: String,
    method: String,
    params: Option<Value>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let mut servers = state.lsp.lock().await;
    let session = servers.get_mut(&id).ok_or("language server is not connected")?;
    session
        .request(&method, params.unwrap_or_else(|| json!({})))
        .await
}

#[tauri::command]
pub async fn lsp_notify(
    id: String,
    method: String,
    params: Option<Value>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut servers = state.lsp.lock().await;
    let session = servers.get_mut(&id).ok_or("language server is not connected")?;
    session
        .notify(&method, params.unwrap_or_else(|| json!({})))
        .await
}

fn path_to_uri(path: &str) -> String {
    let normalised = path.replace('\\', "/");
    let encoded = normalised
        .chars()
        .map(|c| match c {
            ' ' => "%20".to_string(),
            '#' => "%23".to_string(),
            '?' => "%3F".to_string(),
            other => other.to_string(),
        })
        .collect::<String>();
    if encoded.starts_with('/') {
        format!("file://{encoded}")
    } else {
        format!("file:///{encoded}")
    }
}

/// Synchronise one document with the server and ask for completions at a
/// 1-based line/column (converted to the LSP 0-based protocol here).
#[tauri::command]
pub async fn lsp_complete(
    id: String,
    path: String,
    text: String,
    line: u32,
    column: u32,
    language_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let uri = path_to_uri(&path);
    let mut servers = state.lsp.lock().await;
    let session = servers.get_mut(&id).ok_or("language server is not connected")?;

    let version = session.opened.get(&uri).copied().unwrap_or(0) + 1;
    let opened = session.opened.contains_key(&uri);
    session.opened.insert(uri.clone(), version);

    if opened {
        session
            .notify(
                "textDocument/didChange",
                json!({
                    "textDocument": { "uri": uri, "version": version },
                    "contentChanges": [{ "text": text }]
                }),
            )
            .await?;
    } else {
        session
            .notify(
                "textDocument/didOpen",
                json!({
                    "textDocument": {
                        "uri": uri,
                        "languageId": language_id,
                        "version": version,
                        "text": text
                    }
                }),
            )
            .await?;
    }

    session
        .request(
            "textDocument/completion",
            json!({
                "textDocument": { "uri": uri },
                "position": { "line": line.saturating_sub(1), "character": column.saturating_sub(1) }
            }),
        )
        .await
}
