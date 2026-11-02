use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicI64, Ordering},
    Arc,
};
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};

use crate::state::{AppState, LspSession};
use crate::util::which;

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspServerInfo {
    pub id: String,
    pub name: String,
    pub root_uri: Option<String>,
}

impl LspSession {
    async fn send(&self, payload: &Value) -> Result<(), String> {
        let body = serde_json::to_string(payload).map_err(|e| e.to_string())?;
        let framed = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(framed.as_bytes())
            .await
            .map_err(|e| format!("lsp write: {e}"))?;
        stdin.flush().await.map_err(|e| e.to_string())
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.pending.lock().insert(id, tx);

        if let Err(err) = self
            .send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await
        {
            self.pending.lock().remove(&id);
            return Err(err);
        }

        match tokio::time::timeout(Duration::from_secs(self.timeout_secs), rx).await {
            Ok(Ok(Ok(value))) => Ok(value),
            Ok(Ok(Err(error))) => Err(error),
            Ok(Err(_)) => Err("language server closed the connection".into()),
            Err(_) => {
                self.pending.lock().remove(&id);
                Err(format!("language server timed out on {method}"))
            }
        }
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.send(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
            .await
    }
}

async fn read_message(reader: &mut BufReader<ChildStdout>) -> Result<Value, String> {
    let mut length: Option<usize> = None;
    loop {
        let mut header = String::new();
        let read = reader
            .read_line(&mut header)
            .await
            .map_err(|e| format!("lsp read: {e}"))?;
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
    reader
        .read_exact(&mut body)
        .await
        .map_err(|e| format!("lsp read body: {e}"))?;
    serde_json::from_slice(&body).map_err(|e| format!("lsp json: {e}"))
}

/// Reads everything the server sends: responses go to the waiting caller,
/// notifications (diagnostics, logs, ...) are forwarded to the webview, and
/// server-initiated requests are acknowledged so the server never blocks.
fn spawn_reader(app: AppHandle, id: String, session: Arc<LspSession>, stdout: ChildStdout) {
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stdout);
        loop {
            let message = match read_message(&mut reader).await {
                Ok(message) => message,
                Err(error) => {
                    let waiters: Vec<_> = session
                        .pending
                        .lock()
                        .drain()
                        .map(|(_, tx)| tx)
                        .collect();
                    for tx in waiters {
                        let _ = tx.send(Err(error.clone()));
                    }
                    let _ = app.emit("lsp:exit", json!({ "sessionId": id, "error": error }));
                    break;
                }
            };

            let method = message.get("method").and_then(|m| m.as_str()).map(str::to_string);
            let response_id = message.get("id").and_then(|v| v.as_i64());

            match (method, response_id) {
                (Some(method), Some(reply_id)) => {
                    let result = match method.as_str() {
                        "workspace/configuration" => {
                            let count = message
                                .pointer("/params/items")
                                .and_then(|v| v.as_array())
                                .map(|items| items.len())
                                .unwrap_or(0);
                            Value::Array(vec![Value::Null; count])
                        }
                        "workspace/applyEdit" => {
                            // The edit must touch real buffers, which only the
                            // frontend can do. It answers through `lsp_respond`.
                            let params = message.get("params").cloned().unwrap_or(Value::Null);
                            let _ = app.emit(
                                "lsp:apply-edit",
                                json!({
                                    "sessionId": id,
                                    "requestId": reply_id,
                                    "params": params
                                }),
                            );
                            continue;
                        }
                        _ => Value::Null,
                    };
                    let reply = json!({ "jsonrpc": "2.0", "id": reply_id, "result": result });
                    let _ = session.send(&reply).await;
                }
                (Some(method), None) => {
                    let params = message.get("params").cloned().unwrap_or(Value::Null);
                    let _ = app.emit(
                        "lsp:notification",
                        json!({ "sessionId": id, "method": method, "params": params }),
                    );
                }
                (None, Some(response_id)) => {
                    if let Some(tx) = session.pending.lock().remove(&response_id) {
                        if let Some(error) = message.get("error") {
                            let text = error
                                .get("message")
                                .and_then(|m| m.as_str())
                                .unwrap_or("language server error")
                                .to_string();
                            let _ = tx.send(Err(text));
                        } else {
                            let result = message.get("result").cloned().unwrap_or(Value::Null);
                            let _ = tx.send(Ok(result));
                        }
                    }
                }
                (None, None) => { /* nothing to do */ }
            }
        }
    });
}

#[tauri::command]
pub async fn lsp_start(
    app: AppHandle,
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
    let session = Arc::new(LspSession {
        child: tokio::sync::Mutex::new(child),
        stdin: tokio::sync::Mutex::new(stdin),
        pending: Mutex::new(HashMap::new()),
        next_id: AtomicI64::new(0),
        timeout_secs: 120,
        opened: Mutex::new(HashMap::new()),
        name: req.name.clone(),
        root_uri: req.root_uri.clone(),
    });

    // Start the reader before `initialize` so its response is dispatched.
    spawn_reader(app, id.clone(), session.clone(), stdout);

    let root_uri = req.root_uri.clone().unwrap_or_else(|| "file:///".into());
    let initialized = session
        .request(
            "initialize",
            json!({
                "processId": std::process::id(),
                "rootUri": root_uri,
                "workspaceFolders": [{ "uri": root_uri, "name": req.name }],
                "capabilities": {
                    "workspace": {
                        "workspaceFolders": true,
                        "configuration": true,
                        "applyEdit": true
                    },
                    "textDocument": {
                        "synchronization": { "didSave": true, "dynamicRegistration": false },
                        "completion": {
                            "completionItem": {
                                "snippetSupport": true,
                                "documentationFormat": ["markdown", "plaintext"]
                            },
                            "contextSupport": true
                        },
                        "hover": { "contentFormat": ["markdown", "plaintext"] },
                        "definition": { "linkSupport": true },
                        "references": { "dynamicRegistration": false },
                        "documentSymbol": { "hierarchicalDocumentSymbolSupport": true },
                        "semanticTokens": {
                            "requests": {
                                "range": true,
                                "full": { "delta": false }
                            },
                            "tokenTypes": [
                                "namespace",
                                "type",
                                "class",
                                "enum",
                                "interface",
                                "struct",
                                "typeParameter",
                                "parameter",
                                "variable",
                                "property",
                                "enumMember",
                                "event",
                                "function",
                                "method",
                                "macro",
                                "keyword",
                                "modifier",
                                "comment",
                                "string",
                                "number",
                                "regexp",
                                "operator",
                                "decorator"
                            ],
                            "tokenModifiers": [
                                "declaration",
                                "definition",
                                "readonly",
                                "static",
                                "deprecated",
                                "abstract",
                                "async",
                                "modification",
                                "documentation",
                                "defaultLibrary"
                            ],
                            "formats": ["relative"],
                            "overlappingTokenSupport": false,
                            "multilineTokenSupport": true
                        },
                        "inlayHint": { "dynamicRegistration": false },
                        "callHierarchy": { "dynamicRegistration": false },
                        "typeHierarchy": { "dynamicRegistration": false },
                        "rename": { "prepareSupport": true },
                        "codeAction": {
                            "codeActionLiteralSupport": {
                                "codeActionKind": {
                                    "valueSet": [
                                        "",
                                        "quickfix",
                                        "refactor",
                                        "refactor.extract",
                                        "refactor.inline",
                                        "refactor.rewrite",
                                        "source",
                                        "source.organizeImports",
                                        "source.fixAll"
                                    ]
                                }
                            },
                            "isPreferredSupport": true,
                            "resolveSupport": { "properties": ["edit"] }
                        },
                        "publishDiagnostics": { "relatedInformation": true }
                    }
                },
                "clientInfo": { "name": "kudo", "version": env!("CARGO_PKG_VERSION") }
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
    if let Some(session) = state.lsp.lock().await.remove(&id) {
        let _ = session.child.lock().await.kill().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn lsp_sessions(state: State<'_, AppState>) -> Result<Vec<LspServerInfo>, String> {
    Ok(state
        .lsp
        .lock()
        .await
        .iter()
        .map(|(id, session)| LspServerInfo {
            id: id.clone(),
            name: session.name.clone(),
            root_uri: session.root_uri.clone(),
        })
        .collect::<Vec<_>>())
}

#[tauri::command]
pub async fn lsp_request(
    id: String,
    method: String,
    params: Option<Value>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let session = {
        let servers = state.lsp.lock().await;
        servers
            .get(&id)
            .cloned()
            .ok_or("language server is not connected")?
    };
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
    let session = {
        let servers = state.lsp.lock().await;
        servers
            .get(&id)
            .cloned()
            .ok_or("language server is not connected")?
    };
    session
        .notify(&method, params.unwrap_or_else(|| json!({})))
        .await
}

/// Answer a server-initiated request (currently `workspace/applyEdit`).
#[tauri::command]
pub async fn lsp_respond(
    id: String,
    request_id: i64,
    result: Option<Value>,
    error: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let servers = state.lsp.lock().await;
        servers
            .get(&id)
            .cloned()
            .ok_or("language server is not connected")?
    };
    let reply = match error {
        Some(message) => json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "error": { "code": -32603, "message": message }
        }),
        None => json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": result.unwrap_or(Value::Null)
        }),
    };
    session.send(&reply).await
}

/// Report which well-known language servers exist on this machine.
#[tauri::command]
pub async fn lsp_detect() -> Result<HashMap<String, String>, String> {
    const CANDIDATES: [&str; 10] = [
        "rust-analyzer",
        "gopls",
        "typescript-language-server",
        "pyright-langserver",
        "clangd",
        "lua-language-server",
        "svelte-language-server",
        "vscode-json-language-server",
        "bash-language-server",
        "dart",
    ];
    let mut found: HashMap<String, String> = CANDIDATES
        .iter()
        .filter_map(|name| {
            which(name).map(|path| (name.to_string(), path.to_string_lossy().to_string()))
        })
        .collect();
    // Flutter ships its own Dart SDK and projects are written against that
    // version, so prefer it over a standalone `dart` that may be older.
    if let Some(dart) = dart_command() {
        found.insert("dart".into(), dart.to_string_lossy().to_string());
    }
    Ok(found)
}

/// Resolve the Dart SDK that should run the analysis server: Flutter's
/// bundled copy when available, any `dart` on PATH otherwise.
fn dart_command() -> Option<std::path::PathBuf> {
    if let Some(flutter) = which("flutter") {
        if let Some(bin) = flutter.parent() {
            let exe = if cfg!(windows) { "dart.exe" } else { "dart" };
            let bundled = bin.join("cache").join("dart-sdk").join("bin").join(exe);
            if bundled.is_file() {
                return Some(bundled);
            }
        }
    }
    which("dart").filter(|path| {
        // Spawning a `.bat` shim directly does not work on Windows.
        let ext = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase());
        !matches!(ext.as_deref(), Some("bat") | Some("cmd"))
    })
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
    let session = {
        let servers = state.lsp.lock().await;
        servers
            .get(&id)
            .cloned()
            .ok_or("language server is not connected")?
    };

    let (version, opened) = {
        let mut opened_map = session.opened.lock();
        let next = opened_map.get(&uri).copied().unwrap_or(0) + 1;
        let was_open = opened_map.contains_key(&uri);
        opened_map.insert(uri.clone(), next);
        (next, was_open)
    };

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
