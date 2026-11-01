use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::AtomicBool,
        Arc,
    },
};

use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub system_prompt: String,
    pub agent_mode: bool,
    pub auto_approve: bool,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            provider: "demo".into(),
            base_url: "https://api.openai.com/v1".into(),
            model: "gpt-4o-mini".into(),
            api_key: String::new(),
            temperature: 0.3,
            max_tokens: 4096,
            system_prompt: "You are Kudo's coding agent. You can inspect and edit files in the open workspace using the provided tools. Prefer small, verifiable changes and explain what you did.".into(),
            agent_mode: true,
            auto_approve: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentWorkspace {
    pub name: String,
    pub path: String,
    pub last_opened: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub accent: String,
    pub font_family: String,
    pub font_size: u32,
    pub tab_size: u32,
    pub word_wrap: bool,
    pub minimap: bool,
    pub terminal_shell: String,
    pub terminal_font_size: u32,
    pub restore_session: bool,
    #[serde(default)]
    pub format_on_save: bool,
    #[serde(default)]
    pub lint_on_save: bool,
    pub ai: AiSettings,
    pub recent_workspaces: Vec<RecentWorkspace>,
    #[serde(default)]
    pub mcp_servers: Vec<McpServerConfig>,
    #[serde(default)]
    pub update_feed: String,
    #[serde(default = "default_browser_home")]
    pub browser_home: String,
}

fn default_browser_home() -> String {
    "http://localhost:3000".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            accent: "#d4a73c".into(),
            font_family: "JetBrains Mono, Cascadia Code, Consolas, monospace".into(),
            font_size: 13,
            tab_size: 2,
            word_wrap: false,
            minimap: true,
            terminal_shell: default_shell(),
            terminal_font_size: 12,
            restore_session: true,
            format_on_save: false,
            lint_on_save: false,
            ai: AiSettings::default(),
            recent_workspaces: Vec::new(),
            mcp_servers: Vec::new(),
            update_feed: String::new(),
            browser_home: default_browser_home(),
        }
    }
}

pub fn default_shell() -> String {
    if cfg!(windows) {
        // Prefer PowerShell: cmd.exe has no history editing and rejects common
        // IDE flags. Fall back to COMSPEC when PowerShell is unavailable.
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        let ps = std::path::Path::new(&root)
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe");
        if ps.exists() {
            return ps.to_string_lossy().to_string();
        }
        return std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
    }
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
}

pub struct PtySession {
    pub writer: Box<dyn std::io::Write + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
}

impl PtySession {
    /// Kill the shell and everything it started. ConPTY children survive a bare
    /// `child.kill()`, which leaves folders locked (and breaks worktree removal).
    pub fn terminate(&mut self) {
        #[cfg(windows)]
        if let Some(pid) = self.child.process_id() {
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub struct DbSession {
    pub conn: rusqlite::Connection,
}

pub struct McpSession {
    pub child: tokio::process::Child,
    pub stdin: tokio::process::ChildStdin,
    pub reader: tokio::io::BufReader<tokio::process::ChildStdout>,
    pub next_id: i64,
    pub timeout_secs: u64,
    pub name: String,
    pub tools: Vec<crate::commands::mcp::McpTool>,
}

pub struct LspSession {
    /// Kept alive so the child is killed when the session is dropped.
    pub child: tokio::sync::Mutex<tokio::process::Child>,
    pub stdin: tokio::sync::Mutex<tokio::process::ChildStdin>,
    pub pending:
        Mutex<HashMap<i64, tokio::sync::oneshot::Sender<Result<serde_json::Value, String>>>>,
    pub next_id: std::sync::atomic::AtomicI64,
    pub timeout_secs: u64,
    pub opened: Mutex<HashMap<String, i64>>,
    pub name: String,
    pub root_uri: Option<String>,
}

pub struct DapSession {
    /// Kept alive so the adapter is killed when the session is dropped.
    pub child: tokio::sync::Mutex<tokio::process::Child>,
    /// stdio adapters write to the child's stdin; TCP adapters write to the socket.
    pub writer: tokio::sync::Mutex<Box<dyn tokio::io::AsyncWrite + Send + Unpin>>,
    pub pending:
        Mutex<HashMap<i64, tokio::sync::oneshot::Sender<Result<serde_json::Value, String>>>>,
    pub next_id: std::sync::atomic::AtomicI64,
    /// DAP numbers every message; the counter is bumped inside the write lock.
    pub seq: std::sync::atomic::AtomicI64,
    pub timeout_secs: u64,
    pub name: String,
    pub adapter: String,
    /// Launch working directory, used to clean up adapter build artifacts.
    pub cwd: Option<String>,
    /// Attach sessions detach on stop instead of terminating the target.
    pub attach: bool,
}

#[derive(Default)]
pub struct AppState {
    pub workspace: RwLock<Option<PathBuf>>,
    pub settings: RwLock<Settings>,
    pub ptys: Mutex<HashMap<String, PtySession>>,
    pub cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub config_dir: RwLock<PathBuf>,
    pub dbs: Mutex<HashMap<String, DbSession>>,
    pub mcp: tokio::sync::Mutex<HashMap<String, McpSession>>,
    pub lsp: tokio::sync::Mutex<HashMap<String, Arc<LspSession>>>,
    pub dap: tokio::sync::Mutex<HashMap<String, Arc<DapSession>>>,
    /// Running test processes keyed by run id (pid is used for `taskkill /T`).
    pub test_runs: Mutex<HashMap<String, u32>>,
    /// Running tasks keyed by run id (pid is used for `taskkill /T`).
    pub task_runs: Mutex<HashMap<String, u32>>,
    pub netlog: Mutex<Vec<crate::commands::netlog::NetEntry>>,
    pub net_seq: std::sync::atomic::AtomicU64,
}

impl AppState {
    pub fn settings_path(&self) -> PathBuf {
        self.config_dir.read().join("settings.json")
    }

    pub fn load_settings(&self) {
        if let Ok(raw) = std::fs::read_to_string(self.settings_path()) {
            if let Ok(parsed) = serde_json::from_str::<Settings>(&raw) {
                *self.settings.write() = parsed;
            }
        }
    }

    pub fn persist_settings(&self) -> Result<(), String> {
        let dir = self.config_dir.read().clone();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let raw = serde_json::to_string_pretty(&*self.settings.read()).map_err(|e| e.to_string())?;
        std::fs::write(dir.join("settings.json"), raw).map_err(|e| e.to_string())
    }

    pub fn workspace_root(&self) -> Result<PathBuf, String> {
        self.workspace
            .read()
            .clone()
            .ok_or_else(|| "No workspace is open".to_string())
    }

    /// Append a network event to the capped log shown in the Output panel.
    #[allow(clippy::too_many_arguments)]
    pub fn log_net(
        &self,
        kind: &str,
        method: &str,
        url: &str,
        status: Option<u16>,
        duration_ms: u64,
        bytes: usize,
        error: Option<&str>,
    ) {
        let id = self
            .net_seq
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            + 1;
        let entry = crate::commands::netlog::NetEntry {
            id,
            kind: kind.into(),
            method: method.into(),
            url: url.into(),
            status,
            duration_ms,
            bytes,
            error: error.map(|e| e.to_string()),
            at: crate::util::now_unix(),
        };
        let mut log = self.netlog.lock();
        log.push(entry);
        let overflow = log.len().saturating_sub(500);
        if overflow > 0 {
            log.drain(0..overflow);
        }
    }
}

impl Drop for AppState {
    fn drop(&mut self) {
        // Kill terminal shells so no process keeps a workspace folder locked
        // after Kudo exits.
        let mut sessions = self.ptys.lock();
        for (_, mut session) in sessions.drain() {
            session.terminate();
        }
    }
}
