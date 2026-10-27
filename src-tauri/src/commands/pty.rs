use std::io::{Read, Write};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::state::{AppState, PtySession};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyData {
    id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExit {
    id: String,
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    shell: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let cwd = match cwd {
        Some(c) if !c.is_empty() => Some(crate::util::display_path(std::path::Path::new(&c))),
        _ => state
            .workspace
            .read()
            .clone()
            .map(|p| crate::util::display_path(&p)),
    };

    let shell = shell.unwrap_or_else(|| state.settings.read().terminal_shell.clone());
    let shell_name = std::path::Path::new(&shell)
        .file_stem()
        .map(|s| s.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(shell);
    if cfg!(windows) {
        // `-NoLogo` is a PowerShell switch; cmd.exe needs /Q and rejects unknown
        // flags outright.
        if shell_name.starts_with("pwsh") || shell_name.starts_with("powershell") {
            cmd.args(["-NoLogo", "-NoProfile"]);
        } else if shell_name == "cmd" {
            cmd.arg("/Q");
        }
    } else {
        cmd.arg("-l");
    }
    if let Some(dir) = &cwd {
        cmd.cwd(dir);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    state.ptys.lock().insert(
        id.clone(),
        PtySession {
            writer,
            child,
            master: pair.master,
        },
    );

    let app2 = app.clone();
    let session_id = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app2.emit("pty:data", PtyData { id: session_id.clone(), data });
                }
                Err(_) => break,
            }
        }
        let _ = app2.emit("pty:exit", PtyExit { id: session_id });
    });

    Ok(())
}

#[tauri::command]
pub fn pty_write(id: String, data: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut ptys = state.ptys.lock();
    let session = ptys.get_mut(&id).ok_or("terminal session is not running")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(id: String, cols: u16, rows: u16, state: State<'_, AppState>) -> Result<(), String> {
    let mut ptys = state.ptys.lock();
    let session = ptys.get_mut(&id).ok_or("terminal session is not running")?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(id: String, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(mut session) = state.ptys.lock().remove(&id) {
        session.terminate();
    }
    Ok(())
}

#[tauri::command]
pub fn pty_is_running(id: String, state: State<'_, AppState>) -> bool {
    state.ptys.lock().contains_key(&id)
}
