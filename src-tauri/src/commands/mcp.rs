use std::collections::HashMap;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};

use crate::state::{AppState, McpSession};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub server: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectResult {
    pub id: String,
    pub name: String,
    pub server_info: Value,
    pub capabilities: Value,
    pub protocol_version: String,
    pub tools: Vec<McpTool>,
}

fn tools_for(server: &str, result: &Value) -> Vec<McpTool> {
    result
        .get("tools")
        .and_then(|t| t.as_array())
        .map(|tools| {
            tools
                .iter()
                .map(|tool| McpTool {
                    name: tool
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("tool")
                        .to_string(),
                    description: tool
                        .get("description")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    input_schema: tool
                        .get("inputSchema")
                        .cloned()
                        .unwrap_or_else(|| json!({ "type": "object" })),
                    server: server.to_string(),
                })
                .collect()
        })
        .unwrap_or_default()
}

impl McpSession {
    pub async fn rpc(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        let payload = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let mut line = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("mcp write: {e}"))?;
        self.stdin.flush().await.map_err(|e| e.to_string())?;

        let deadline = tokio::time::Instant::now() + Duration::from_secs(self.timeout_secs);
        loop {
            let mut buf = String::new();
            let read = tokio::time::timeout_at(deadline, self.reader.read_line(&mut buf)).await;
            let read = match read {
                Ok(res) => res.map_err(|e| format!("mcp read: {e}"))?,
                Err(_) => return Err(format!("mcp request `{method}` timed out")),
            };
            if read == 0 {
                return Err("mcp server closed the connection".into());
            }
            let trimmed = buf.trim();
            if trimmed.is_empty() {
                continue;
            }
            let value: Value = match serde_json::from_str(trimmed) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if value.get("id").and_then(|v| v.as_i64()) != Some(id) {
                // Notification or a response to an earlier cancelled request.
                continue;
            }
            if let Some(error) = value.get("error") {
                let message = error
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("mcp error");
                return Err(format!("{message}"));
            }
            return Ok(value.get("result").cloned().unwrap_or(Value::Null));
        }
    }
}

/// Spawn a stdio MCP server, run the initialize handshake and cache its tools.
#[tauri::command]
pub async fn mcp_connect(
    id: Option<String>,
    name: String,
    command: String,
    args: Option<Vec<String>>,
    env: Option<HashMap<String, String>>,
    cwd: Option<String>,
    state: State<'_, AppState>,
) -> Result<McpConnectResult, String> {
    let id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let mut cmd = tokio::process::Command::new(&command);
    cmd.args(args.unwrap_or_default())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    if let Some(dir) = cwd {
        if !dir.is_empty() {
            cmd.current_dir(dir);
        }
    }
    for (key, value) in env.unwrap_or_default() {
        cmd.env(key, value);
    }

    let mut child: Child = cmd
        .spawn()
        .map_err(|e| format!("could not start `{command}`: {e}"))?;
    let stdin: ChildStdin = child.stdin.take().ok_or("mcp server has no stdin")?;
    let stdout: ChildStdout = child.stdout.take().ok_or("mcp server has no stdout")?;

    let mut session = McpSession {
        child,
        stdin,
        reader: BufReader::new(stdout),
        next_id: 0,
        timeout_secs: 20,
        name: name.clone(),
        tools: Vec::new(),
    };

    let initialized = session
        .rpc(
            "initialize",
            json!({
                "protocolVersion": "2024-11-05",
                "capabilities": { "roots": { "listChanged": true } },
                "clientInfo": { "name": "kodra", "version": "0.1.0" }
            }),
        )
        .await
        .map_err(|e| format!("initialize failed: {e}"))?;

    let ready = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
    let mut line = ready.to_string();
    line.push('\n');
    session
        .stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    session.stdin.flush().await.map_err(|e| e.to_string())?;

    let listed = session
        .rpc("tools/list", json!({}))
        .await
        .unwrap_or_else(|_| json!({ "tools": [] }));
    let tools = tools_for(&name, &listed);
    session.tools = tools.clone();
    let server_info = initialized.get("serverInfo").cloned().unwrap_or(Value::Null);
    let capabilities = initialized.get("capabilities").cloned().unwrap_or(Value::Null);
    let protocol_version = initialized
        .get("protocolVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("2024-11-05")
        .to_string();

    state.mcp.lock().await.insert(id.clone(), session);

    Ok(McpConnectResult {
        id,
        name,
        server_info,
        capabilities,
        protocol_version,
        tools,
    })
}

#[tauri::command]
pub async fn mcp_disconnect(id: String, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(mut session) = state.mcp.lock().await.remove(&id) {
        let _ = session.child.kill().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_list_tools(
    id: String,
    state: State<'_, AppState>,
) -> Result<Vec<McpTool>, String> {
    let mut servers = state.mcp.lock().await;
    let session = servers.get_mut(&id).ok_or("mcp server is not connected")?;
    let listed = session.rpc("tools/list", json!({})).await?;
    let tools = tools_for(&session.name, &listed);
    session.tools = tools.clone();
    Ok(tools)
}

#[tauri::command]
pub async fn mcp_call_tool(
    id: String,
    tool: String,
    arguments: Option<Value>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let mut servers = state.mcp.lock().await;
    let session = servers.get_mut(&id).ok_or("mcp server is not connected")?;
    session
        .rpc(
            "tools/call",
            json!({ "name": tool, "arguments": arguments.unwrap_or_else(|| json!({})) }),
        )
        .await
}

/// Probe a command before spawning it, so the UI can show a helpful error when
/// Node/Python/uvx are not installed.
#[tauri::command]
pub async fn mcp_probe(command: String) -> Result<String, String> {
    let output = tokio::process::Command::new(if cfg!(windows) { "where" } else { "which" })
        .arg(&command)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(format!("`{command}` was not found on PATH"))
    }
}
