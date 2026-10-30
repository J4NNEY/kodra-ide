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
use tokio::io::{
    AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader,
};
use tokio::net::TcpStream;
use tokio::process::{Child, ChildStdin, ChildStdout};

use crate::state::{AppState, DapSession};
use crate::util::which;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DapStartRequest {
    /// Label shown in the debug view, e.g. "Go: main".
    pub name: String,
    /// Adapter id used in the `initialize` handshake (dlv, codelldb, ...).
    pub adapter: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default = "default_request")]
    pub request: String,
    /// Adapter specific `launch` / `attach` arguments.
    #[serde(default)]
    pub launch: Value,
    /// `stdio` for adapters that speak DAP on stdin/stdout, `tcp` for adapters
    /// such as Delve that print a listening address and serve DAP on a socket.
    #[serde(default = "default_transport")]
    pub transport: String,
}

fn default_request() -> String {
    "launch".into()
}

fn default_transport() -> String {
    "stdio".into()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DapStartResult {
    pub id: String,
    pub adapter: String,
    pub capabilities: Value,
}

impl DapSession {
    async fn send(&self, mut payload: Value) -> Result<(), String> {
        payload["seq"] = json!(self.seq.fetch_add(1, Ordering::SeqCst) + 1);
        let body = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
        let framed = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
        let mut writer = self.writer.lock().await;
        writer
            .write_all(framed.as_bytes())
            .await
            .map_err(|e| format!("debug adapter write: {e}"))?;
        writer.flush().await.map_err(|e| e.to_string())
    }

    async fn request(&self, command: &str, arguments: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.pending.lock().insert(id, tx);

        if let Err(err) = self
            .send(json!({
                "type": "request",
                "id": id,
                "command": command,
                "arguments": arguments
            }))
            .await
        {
            self.pending.lock().remove(&id);
            return Err(err);
        }

        match tokio::time::timeout(Duration::from_secs(self.timeout_secs), rx).await {
            Ok(Ok(Ok(value))) => Ok(value),
            Ok(Ok(Err(error))) => Err(error),
            Ok(Err(_)) => Err("debug adapter closed the connection".into()),
            Err(_) => {
                self.pending.lock().remove(&id);
                Err(format!("debug adapter timed out on {command}"))
            }
        }
    }

    /// Fire-and-forget request used while tearing a session down.
    async fn notify(&self, command: &str, arguments: Value) {
        let _ = self
            .send(json!({ "type": "request", "command": command, "arguments": arguments }))
            .await;
    }

    async fn respond(&self, request_seq: i64, command: &str, success: bool, message: &str) {
        let _ = self
            .send(json!({
                "type": "response",
                "request_seq": request_seq,
                "success": success,
                "command": command,
                "message": message
            }))
            .await;
    }
}

async fn read_message<R: AsyncBufRead + Unpin>(reader: &mut R) -> Result<Value, String> {
    let mut length: Option<usize> = None;
    loop {
        let mut header = String::new();
        let read = reader
            .read_line(&mut header)
            .await
            .map_err(|e| format!("debug adapter read: {e}"))?;
        if read == 0 {
            return Err("debug adapter closed the connection".into());
        }
        let line = header.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            break;
        }
        if let Some(rest) = line.strip_prefix("Content-Length:") {
            length = rest.trim().parse::<usize>().ok();
        }
    }
    let length = length.ok_or("debug adapter sent no Content-Length")?;
    let mut body = vec![0u8; length];
    reader
        .read_exact(&mut body)
        .await
        .map_err(|e| format!("debug adapter read body: {e}"))?;
    serde_json::from_slice(&body).map_err(|e| format!("debug adapter json: {e}"))
}

/// Forward adapter events to the webview and answer reverse requests so the
/// adapter never blocks waiting for the client.
fn spawn_reader<R>(app: AppHandle, id: String, session: Arc<DapSession>, input: R)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(input);
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
                    let _ = app.emit("dap:exit", json!({ "sessionId": id, "error": error }));
                    break;
                }
            };

            match message.get("type").and_then(|t| t.as_str()) {
                Some("response") => {
                    let request_seq = message.get("request_seq").and_then(|v| v.as_i64());
                    if let Some(request_seq) = request_seq {
                        if let Some(tx) = session.pending.lock().remove(&request_seq) {
                            let success = message
                                .get("success")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            if success {
                                let body = message.get("body").cloned().unwrap_or_else(|| json!({}));
                                let _ = tx.send(Ok(body));
                            } else {
                                let text = message
                                    .get("message")
                                    .and_then(|m| m.as_str())
                                    .or_else(|| {
                                        message.pointer("/body/error/format").and_then(|m| m.as_str())
                                    })
                                    .unwrap_or("debug adapter error")
                                    .to_string();
                                let _ = tx.send(Err(text));
                            }
                        }
                    }
                }
                Some("event") => {
                    let event = message
                        .get("event")
                        .and_then(|e| e.as_str())
                        .unwrap_or("")
                        .to_string();
                    let body = message.get("body").cloned().unwrap_or(Value::Null);
                    let _ = app.emit(
                        "dap:event",
                        json!({ "sessionId": id, "event": event, "body": body }),
                    );
                }
                Some("request") => {
                    let request_seq = message.get("seq").and_then(|v| v.as_i64()).unwrap_or(0);
                    let command = message
                        .get("command")
                        .and_then(|c| c.as_str())
                        .unwrap_or("")
                        .to_string();
                    // Kudo runs the debuggee itself; adapters that ask the client
                    // for a terminal are told we cannot, so they fall back.
                    session
                        .respond(
                            request_seq,
                            &command,
                            false,
                            "Kudo cannot run the program in a terminal",
                        )
                        .await;
                }
                _ => {}
            }
        }
    });
}

/// Read the adapter's stdout until it announces the DAP socket address.
///
/// Delve's `dlv dap` starts a TCP server instead of speaking DAP on stdio:
/// it prints `DAP server listening at: 127.0.0.1:<port>` and then waits.
async fn read_listen_address<R: AsyncBufRead + Unpin>(reader: &mut R) -> Result<String, String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    let mut line = String::new();
    loop {
        line.clear();
        let read = tokio::time::timeout_at(deadline, reader.read_line(&mut line))
            .await
            .map_err(|_| "debug adapter never announced a listening address".to_string())?
            .map_err(|e| format!("debug adapter read: {e}"))?;
        if read == 0 {
            return Err("debug adapter exited before listening".into());
        }
        if let Some(rest) = line.split("listening at:").nth(1) {
            let address = rest.split_whitespace().next().unwrap_or("").trim();
            if !address.is_empty() {
                return Ok(address.to_string());
            }
        }
    }
}

/// Delve builds the debuggee next to its package (`__debug_bin<rand>.exe`) and
/// removes it on a clean exit. Kudo tears sessions down by killing the adapter,
/// so drop those leftovers when a Delve session starts or stops.
fn cleanup_delve_artifacts(dir: &str) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("__debug_bin") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// The adapter has usually bound the socket by the time it prints the address,
/// but retry briefly in case the listen backlog is not ready yet.
async fn connect_with_retry(address: &str) -> Result<TcpStream, String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        match TcpStream::connect(address).await {
            Ok(stream) => {
                let _ = stream.set_nodelay(true);
                return Ok(stream);
            }
            Err(err) => {
                if tokio::time::Instant::now() >= deadline {
                    return Err(format!("could not connect to debug adapter at {address}: {err}"));
                }
                tokio::time::sleep(Duration::from_millis(150)).await;
            }
        }
    }
}

#[tauri::command]
pub async fn dap_start(
    app: AppHandle,
    req: DapStartRequest,
    state: State<'_, AppState>,
) -> Result<DapStartResult, String> {
    let command = req.command.trim().to_string();
    if command.is_empty() {
        return Err("no debug adapter command configured".into());
    }
    let resolved = which(&command)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| command.clone());

    let mut cmd = tokio::process::Command::new(&resolved);
    cmd.args(&req.args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = req.cwd.as_deref() {
        cmd.current_dir(cwd);
    }
    for (key, value) in &req.env {
        cmd.env(key, value);
    }
    if req.adapter == "dlv" {
        if let Some(cwd) = req.cwd.as_deref() {
            cleanup_delve_artifacts(cwd);
        }
    }

    let mut child: Child = cmd
        .spawn()
        .map_err(|e| format!("could not start `{resolved}`: {e}"))?;

    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit(
                    "dap:event",
                    json!({
                        "sessionId": "",
                        "event": "output",
                        "body": { "category": "stderr", "output": format!("{line}\n") }
                    }),
                );
            }
        });
    }

    // stdio adapters (codelldb, lldb-dap, custom) speak DAP on the child's
    // stdin/stdout; TCP adapters (dlv) print an address and serve a socket.
    let id = uuid::Uuid::new_v4().to_string();
    let (writer, reader): (
        Box<dyn AsyncWrite + Send + Unpin>,
        Box<dyn AsyncRead + Send + Unpin>,
    ) = if req.transport == "tcp" {
        let stdout = child.stdout.take().ok_or("debug adapter has no stdout")?;
        let mut lines = BufReader::new(stdout);
        let address = read_listen_address(&mut lines).await?;
        let stream = connect_with_retry(&address).await?;
        // `dlv dap` runs the debuggee with its stdout wired to the adapter's
        // own stdout, so keep draining that pipe into the debug console.
        let app_stdout = app.clone();
        let id_stdout = id.clone();
        tauri::async_runtime::spawn(async move {
            let mut forward = lines.lines();
            while let Ok(Some(line)) = forward.next_line().await {
                let _ = app_stdout.emit(
                    "dap:event",
                    json!({
                        "sessionId": id_stdout,
                        "event": "output",
                        "body": { "category": "stdout", "output": format!("{line}\n") }
                    }),
                );
            }
        });
        let (read_half, write_half) = stream.into_split();
        (Box::new(write_half), Box::new(read_half))
    } else {
        let stdin: ChildStdin = child.stdin.take().ok_or("debug adapter has no stdin")?;
        let stdout: ChildStdout = child.stdout.take().ok_or("debug adapter has no stdout")?;
        (Box::new(stdin), Box::new(stdout))
    };

    let session = Arc::new(DapSession {
        child: tokio::sync::Mutex::new(child),
        writer: tokio::sync::Mutex::new(writer),
        pending: Mutex::new(HashMap::new()),
        next_id: AtomicI64::new(0),
        seq: AtomicI64::new(0),
        timeout_secs: 180,
        name: req.name.clone(),
        adapter: req.adapter.clone(),
        cwd: req.cwd.clone(),
        attach: req.request == "attach",
    });

    spawn_reader(app, id.clone(), session.clone(), reader);

    let initialized = session
        .request(
            "initialize",
            json!({
                "clientID": "kudo",
                "clientName": "Kudo",
                "adapterID": req.adapter,
                "pathFormat": "path",
                "linesStartAt1": true,
                "columnsStartAt1": true,
                "supportsVariableType": true,
                "supportsVariablePaging": false,
                "supportsRunInTerminalRequest": false,
                "locale": "en-US"
            }),
        )
        .await
        .map_err(|e| {
            let _ = session.send(json!({ "type": "request", "command": "disconnect" }));
            format!("initialize failed: {e}")
        })?;

    let capabilities = initialized
        .get("capabilities")
        .cloned()
        .unwrap_or(Value::Null);

    // Store before the launch request so events are correlated with a live session.
    state.dap.lock().await.insert(id.clone(), session.clone());

    session
        .request(
            &req.request,
            if req.launch.is_null() {
                json!({})
            } else {
                req.launch.clone()
            },
        )
        .await
        .map_err(|e| {
            let text = format!("{} failed: {e}", req.request);
            tauri::async_runtime::spawn(async move {
                let _ = session.child.lock().await.kill().await;
            });
            text
        })?;

    Ok(DapStartResult {
        id,
        adapter: req.adapter,
        capabilities,
    })
}

#[tauri::command]
pub async fn dap_request(
    id: String,
    command: String,
    arguments: Option<Value>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let session = {
        let sessions = state.dap.lock().await;
        sessions
            .get(&id)
            .cloned()
            .ok_or("debug session is not connected")?
    };
    session
        .request(&command, arguments.unwrap_or_else(|| json!({})))
        .await
}

#[tauri::command]
pub async fn dap_stop(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let session = state.dap.lock().await.remove(&id);
    if let Some(session) = session {
        session
            .notify(
                "disconnect",
                json!({ "restart": false, "terminateDebuggee": !session.attach }),
            )
            .await;
        let _ = tokio::time::timeout(Duration::from_secs(2), async {
            let mut child = session.child.lock().await;
            let _ = child.kill().await;
            let _ = child.wait().await;
        })
        .await;
        if session.adapter == "dlv" {
            if let Some(cwd) = session.cwd.as_deref() {
                cleanup_delve_artifacts(cwd);
            }
        }
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DapSessionInfo {
    pub id: String,
    pub name: String,
    pub adapter: String,
}

/// Report which well-known debug adapters exist on this machine.
#[tauri::command]
pub async fn dap_detect() -> Result<HashMap<String, String>, String> {
    const CANDIDATES: [&str; 6] = [
        "dlv",
        "codelldb",
        "lldb-dap",
        "lldb-vscode",
        "debugpy",
        "debug-adapter",
    ];
    let mut found = HashMap::new();
    for name in CANDIDATES {
        if let Some(path) = which(name) {
            found.insert(name.to_string(), path.to_string_lossy().to_string());
        }
    }
    Ok(found)
}

#[tauri::command]
pub async fn dap_sessions(state: State<'_, AppState>) -> Result<Vec<DapSessionInfo>, String> {
    Ok(state
        .dap
        .lock()
        .await
        .iter()
        .map(|(id, session)| DapSessionInfo {
            id: id.clone(),
            name: session.name.clone(),
            adapter: session.adapter.clone(),
        })
        .collect())
}
