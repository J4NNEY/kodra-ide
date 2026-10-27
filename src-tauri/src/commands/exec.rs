use serde::Serialize;
use tauri::State;

use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
    pub duration_ms: u64,
}

/// Run a one-shot shell command inside the workspace. Used by the agent tools and
/// the "Run task" palette action. Output is truncated to keep IPC payloads sane.
#[tauri::command]
pub async fn run_command(
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    let root = state.workspace_root()?;
    let dir = match cwd {
        Some(c) if !c.is_empty() => crate::util::resolve_in_workspace(&root, &c)?,
        _ => root.clone(),
    };

    let started = std::time::Instant::now();
    let shell = if cfg!(windows) { "powershell.exe" } else { "/bin/sh" };
    let args: Vec<&str> = if cfg!(windows) {
        vec!["-NoLogo", "-NoProfile", "-Command", &command]
    } else {
        vec!["-c", &command]
    };

    let child = tokio::process::Command::new(shell)
        .args(&args)
        .current_dir(&dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;

    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(120_000));
    let output = match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(res) => res.map_err(|e| e.to_string())?,
        Err(_) => {
            return Err(format!(
                "command timed out after {}s and was killed",
                timeout.as_secs()
            ));
        }
    };

    let mut stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let mut stderr = String::from_utf8_lossy(&output.stderr).to_string();
    const LIMIT: usize = 60_000;
    if stdout.len() > LIMIT {
        stdout.truncate(LIMIT);
        stdout.push_str("\n… output truncated …");
    }
    if stderr.len() > LIMIT {
        stderr.truncate(LIMIT);
        stderr.push_str("\n… output truncated …");
    }

    Ok(CommandOutput {
        stdout,
        stderr,
        code: output.status.code().unwrap_or(-1),
        duration_ms: started.elapsed().as_millis() as u64,
    })
}
