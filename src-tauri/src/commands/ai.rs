use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::State;

use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    #[serde(default)]
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub system: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub tools: Vec<ToolDef>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiEvent {
    Delta { text: String },
    Error { message: String },
    Done { content: String, tool_calls: Vec<ToolCall> },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiResult {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
    pub finish_reason: String,
}

fn normalise_base(base: &str) -> String {
    base.trim().trim_end_matches('/').to_string()
}

fn build_messages(req: &ChatRequest) -> Vec<Value> {
    let mut out = Vec::new();
    if !req.system.trim().is_empty() {
        out.push(json!({"role": "system", "content": req.system}));
    }
    for m in &req.messages {
        match m.role.as_str() {
            "assistant" => {
                let mut v = json!({"role": "assistant", "content": m.content});
                if let Some(calls) = &m.tool_calls {
                    if !calls.is_empty() {
                        let arr: Vec<Value> = calls
                            .iter()
                            .map(|c| {
                                json!({
                                    "id": c.id,
                                    "type": "function",
                                    "function": {"name": c.name, "arguments": c.arguments}
                                })
                            })
                            .collect();
                        v["tool_calls"] = Value::Array(arr);
                    }
                }
                out.push(v);
            }
            "tool" => out.push(json!({
                "role": "tool",
                "tool_call_id": m.tool_call_id.clone().unwrap_or_default(),
                "content": m.content
            })),
            _ => out.push(json!({"role": m.role, "content": m.content})),
        }
    }
    out
}

#[tauri::command]
pub async fn ai_chat(
    state: State<'_, AppState>,
    channel: Channel<AiEvent>,
    req: ChatRequest,
) -> Result<AiResult, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    let request_id = if req.request_id.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        req.request_id.clone()
    };
    state
        .cancels
        .lock()
        .insert(request_id.clone(), cancel.clone());

    let started = std::time::Instant::now();
    let result = match req.provider.as_str() {
        "demo" => run_demo(&channel, &req, &cancel).await,
        "anthropic" | "claude" => run_anthropic(&channel, &req, &cancel).await,
        _ => run_openai(&channel, &req, &cancel).await,
    };

    let endpoint = if req.provider == "anthropic" {
        format!("{}/messages", normalise_base(&req.base_url))
    } else if req.provider == "demo" {
        "demo://local".to_string()
    } else {
        format!("{}/chat/completions", normalise_base(&req.base_url))
    };
    state.log_net(
        "ai",
        "POST",
        &endpoint,
        result.as_ref().ok().map(|_| 200),
        started.elapsed().as_millis() as u64,
        result.as_ref().map(|r| r.content.len()).unwrap_or(0),
        result.as_ref().err().map(|e| e.as_str()),
    );

    state.cancels.lock().remove(&request_id);

    match result {
        Ok(res) => {
            let _ = channel.send(AiEvent::Done {
                content: res.content.clone(),
                tool_calls: res.tool_calls.clone(),
            });
            Ok(res)
        }
        Err(err) => {
            let _ = channel.send(AiEvent::Error {
                message: err.clone(),
            });
            Err(err)
        }
    }
}

#[tauri::command]
pub fn ai_cancel(request_id: String, state: State<'_, AppState>) -> bool {
    if let Some(flag) = state.cancels.lock().get(&request_id) {
        flag.store(true, Ordering::SeqCst);
        true
    } else {
        false
    }
}

#[tauri::command]
pub async fn ai_probe(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    let url = format!("{}/models", normalise_base(&base_url));
    let client = reqwest::Client::new();
    let mut rb = client.get(url);
    if !api_key.is_empty() {
        rb = rb.bearer_auth(api_key);
    }
    let resp = rb.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(body
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("request failed")
            .to_string());
    }
    let mut models: Vec<String> = body
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    models.sort();
    Ok(models)
}

async fn run_demo(
    channel: &Channel<AiEvent>,
    req: &ChatRequest,
    cancel: &Arc<AtomicBool>,
) -> Result<AiResult, String> {
    let last_user = req
        .messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.clone())
        .unwrap_or_default();

    let text = format!(
        "**Demo mode** — no API key is configured yet, so this reply is generated locally.\n\n\
         You said:\n\n> {}\n\n\
         Open **Settings → AI** to connect OpenAI, Anthropic, Ollama or any OpenAI-compatible endpoint. \
         Once connected I can read and edit files in your workspace, run commands, and search the codebase.",
        if last_user.trim().is_empty() { "(empty message)" } else { last_user.trim() }
    );

    let mut content = String::new();
    for chunk in text.split_inclusive(' ') {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        content.push_str(chunk);
        channel
            .send(AiEvent::Delta { text: chunk.to_string() })
            .map_err(|e| e.to_string())?;
        tokio::time::sleep(std::time::Duration::from_millis(18)).await;
    }

    Ok(AiResult {
        content,
        tool_calls: Vec::new(),
        finish_reason: "stop".into(),
    })
}

async fn run_openai(
    channel: &Channel<AiEvent>,
    req: &ChatRequest,
    cancel: &Arc<AtomicBool>,
) -> Result<AiResult, String> {
    let url = format!("{}/chat/completions", normalise_base(&req.base_url));
    let mut body = json!({
        "model": req.model,
        "messages": build_messages(req),
        "stream": true,
        "temperature": req.temperature.unwrap_or(0.3),
        "max_tokens": req.max_tokens.unwrap_or(4096),
    });
    if !req.tools.is_empty() {
        body["tools"] = Value::Array(
            req.tools
                .iter()
                .map(|t| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.parameters
                        }
                    })
                })
                .collect(),
        );
        body["tool_choice"] = json!("auto");
    }

    let client = reqwest::Client::new();
    let mut rb = client.post(&url).json(&body);
    if !req.api_key.is_empty() {
        rb = rb.bearer_auth(&req.api_key);
    }
    let resp = rb.send().await.map_err(|e| format!("request failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or(text.chars().take(400).collect());
        return Err(format!("provider returned {status}: {msg}"));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut content = String::new();
    let mut calls: Vec<(String, String, String)> = Vec::new();
    let mut finish = String::from("stop");

    'stream: while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            finish = "cancelled".into();
            break;
        }
        let bytes = chunk.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim_end_matches('\r').to_string();
            buf.drain(..=pos);
            let Some(data) = line.strip_prefix("data:") else { continue };
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
                if data == "[DONE]" {
                    break 'stream;
                }
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(data) else { continue };
            if let Some(err) = v.get("error") {
                let msg = err
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("provider error");
                return Err(msg.to_string());
            }
            let Some(choice) = v.get("choices").and_then(|c| c.get(0)) else { continue };
            if let Some(reason) = choice.get("finish_reason").and_then(|r| r.as_str()) {
                if !reason.is_empty() {
                    finish = reason.to_string();
                }
            }
            let Some(delta) = choice.get("delta") else { continue };
            if let Some(text) = delta.get("content").and_then(|c| c.as_str()) {
                if !text.is_empty() {
                    content.push_str(text);
                    channel
                        .send(AiEvent::Delta { text: text.to_string() })
                        .map_err(|e| e.to_string())?;
                }
            }
            if let Some(tc) = delta.get("tool_calls").and_then(|t| t.as_array()) {
                for call in tc {
                    let idx = call.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;
                    while calls.len() <= idx {
                        calls.push((String::new(), String::new(), String::new()));
                    }
                    if let Some(id) = call.get("id").and_then(|i| i.as_str()) {
                        if !id.is_empty() {
                            calls[idx].0 = id.to_string();
                        }
                    }
                    if let Some(func) = call.get("function") {
                        if let Some(name) = func.get("name").and_then(|n| n.as_str()) {
                            if !name.is_empty() {
                                calls[idx].1.push_str(name);
                            }
                        }
                        if let Some(args) = func.get("arguments").and_then(|a| a.as_str()) {
                            calls[idx].2.push_str(args);
                        }
                    }
                }
            }
        }
    }

    let tool_calls: Vec<ToolCall> = calls
        .into_iter()
        .filter(|(_, name, _)| !name.is_empty())
        .map(|(id, name, arguments)| ToolCall {
            id: if id.is_empty() {
                format!("call_{}", uuid::Uuid::new_v4())
            } else {
                id
            },
            name,
            arguments: if arguments.is_empty() {
                "{}".into()
            } else {
                arguments
            },
        })
        .collect();

    Ok(AiResult {
        content,
        tool_calls,
        finish_reason: finish,
    })
}

async fn run_anthropic(
    channel: &Channel<AiEvent>,
    req: &ChatRequest,
    cancel: &Arc<AtomicBool>,
) -> Result<AiResult, String> {
    let base = normalise_base(&req.base_url);
    let url = if base.ends_with("/v1") {
        format!("{base}/messages")
    } else {
        format!("{base}/v1/messages")
    };

    // Anthropic expects tool results as user turns with tool_result blocks.
    let mut messages: Vec<Value> = Vec::new();
    for m in &req.messages {
        match m.role.as_str() {
            "tool" => messages.push(json!({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": m.tool_call_id.clone().unwrap_or_default(),
                    "content": m.content
                }]
            })),
            "assistant" => {
                let mut blocks: Vec<Value> = Vec::new();
                if !m.content.is_empty() {
                    blocks.push(json!({"type": "text", "text": m.content}));
                }
                if let Some(calls) = &m.tool_calls {
                    for c in calls {
                        let input: Value = serde_json::from_str(&c.arguments).unwrap_or(json!({}));
                        blocks.push(json!({
                            "type": "tool_use",
                            "id": c.id,
                            "name": c.name,
                            "input": input
                        }));
                    }
                }
                messages.push(json!({"role": "assistant", "content": blocks}));
            }
            _ => messages.push(json!({"role": "user", "content": m.content})),
        }
    }

    let mut body = json!({
        "model": req.model,
        "messages": messages,
        "max_tokens": req.max_tokens.unwrap_or(4096),
        "temperature": req.temperature.unwrap_or(0.3),
        "stream": true,
    });
    if !req.system.trim().is_empty() {
        body["system"] = json!(req.system);
    }
    if !req.tools.is_empty() {
        body["tools"] = Value::Array(
            req.tools
                .iter()
                .map(|t| {
                    json!({
                        "name": t.name,
                        "description": t.description,
                        "input_schema": t.parameters
                    })
                })
                .collect(),
        );
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("x-api-key", &req.api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| text.chars().take(400).collect());
        return Err(format!("provider returned {status}: {msg}"));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut content = String::new();
    let mut calls: Vec<ToolCall> = Vec::new();
    let mut current_tool: Option<(usize, String)> = None;
    let mut finish = String::from("stop");

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            finish = "cancelled".into();
            break;
        }
        let bytes = chunk.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim_end_matches('\r').to_string();
            buf.drain(..=pos);
            let Some(data) = line.strip_prefix("data:") else { continue };
            let data = data.trim();
            if data.is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(data) else { continue };
            match v.get("type").and_then(|t| t.as_str()).unwrap_or("") {
                "content_block_start" => {
                    if let Some(block) = v.get("content_block") {
                        if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                            calls.push(ToolCall {
                                id: block
                                    .get("id")
                                    .and_then(|i| i.as_str())
                                    .unwrap_or_default()
                                    .to_string(),
                                name: block
                                    .get("name")
                                    .and_then(|n| n.as_str())
                                    .unwrap_or_default()
                                    .to_string(),
                                arguments: String::new(),
                            });
                            current_tool = Some((calls.len() - 1, "tool_use".into()));
                        }
                    }
                }
                "content_block_delta" => {
                    if let Some(delta) = v.get("delta") {
                        match delta.get("type").and_then(|t| t.as_str()).unwrap_or("") {
                            "text_delta" => {
                                if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                                    content.push_str(text);
                                    channel
                                        .send(AiEvent::Delta { text: text.to_string() })
                                        .map_err(|e| e.to_string())?;
                                }
                            }
                            "input_json_delta" => {
                                if let (Some((idx, _)), Some(partial)) = (
                                    current_tool.as_ref(),
                                    delta.get("partial_json").and_then(|p| p.as_str()),
                                ) {
                                    calls[*idx].arguments.push_str(partial);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                "content_block_stop" => current_tool = None,
                "message_delta" => {
                    if let Some(reason) = v
                        .get("delta")
                        .and_then(|d| d.get("stop_reason"))
                        .and_then(|r| r.as_str())
                    {
                        finish = reason.to_string();
                    }
                }
                "error" => {
                    let msg = v
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                        .unwrap_or("provider error");
                    return Err(msg.to_string());
                }
                _ => {}
            }
        }
    }

    for c in calls.iter_mut() {
        if c.arguments.trim().is_empty() {
            c.arguments = "{}".into();
        }
    }

    Ok(AiResult {
        content,
        tool_calls: calls,
        finish_reason: finish,
    })
}
