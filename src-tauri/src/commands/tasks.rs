use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::state::AppState;
use crate::util::{resolve_in_workspace, which};

/// Folders that never hold task definitions (dependencies, build output).
const SKIP_DIRS: &[&str] = &[
    ".git", ".hg", ".svn", "node_modules", "target", "dist", ".output", ".nuxt", ".next", "vendor",
    "venv", ".venv", "__pycache__", "build", "bin", "obj", ".idea",
];
/// How deep to look for nested `package.json` files.
const MAX_PACKAGE_DEPTH: usize = 4;
const MAX_TASKS: usize = 200;
const MAX_MANIFEST_BYTES: u64 = 512 * 1024;
/// Keep at most this many finished runs around for cancellation bookkeeping.
const MAX_RUNS: usize = 24;

/// A runnable task detected in the workspace, or declared in `.kodra/tasks.json`.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskDef {
    /// Stable key inside one detection snapshot (`kodra:0`, `package:scripts:build`).
    pub id: String,
    pub label: String,
    /// `kodra`, `package` or `make`.
    pub source: String,
    /// Command line preview shown next to the label.
    pub detail: String,
    /// Full command line handed to the shell when the task runs.
    pub command: String,
    /// Workspace relative folder the task runs in (empty means the root).
    #[serde(default)]
    pub cwd: String,
    /// `build`, `test` or `none`.
    #[serde(default = "none_group")]
    pub group: String,
    /// The task run by "Run Build Task".
    #[serde(default)]
    pub is_default: bool,
}

fn none_group() -> String {
    "none".into()
}

#[derive(Debug, Deserialize)]
pub struct Manifest {
    #[serde(default)]
    pub tasks: Vec<ManifestTask>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestTask {
    pub label: String,
    pub command: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub group: String,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunInfo {
    pub id: String,
    /// Command line shown in the task output header.
    pub label: String,
    pub cwd: String,
}

fn rel_string(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn read_manifest(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.len() > MAX_MANIFEST_BYTES {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

/// Normalise a manifest `cwd` so `.` and leading slashes never escape the root.
fn clean_cwd(raw: &str) -> String {
    let value = raw.trim().replace('\\', "/");
    let value = value.trim_matches('/');
    if value.is_empty() || value == "." {
        return String::new();
    }
    if value.split('/').any(|part| part == "..") {
        return String::new();
    }
    value.to_string()
}

fn group_for(name: &str, raw: &str) -> String {
    let value = raw.trim().to_ascii_lowercase();
    if value == "build" || value == "test" || value == "none" {
        return value;
    }
    match name {
        "build" | "compile" | "bundle" | "make" => "build".into(),
        "test" | "tests" | "e2e" => "test".into(),
        _ => "none".into(),
    }
}

/// Declarative tasks from `.kodra/tasks.json` (falling back to the
/// pre-rename `.kudo/tasks.json`).
fn manifest_tasks(root: &Path, out: &mut Vec<TaskDef>) {
    let mut path = root.join(".kodra").join("tasks.json");
    if !path.exists() {
        let legacy = root.join(".kudo").join("tasks.json");
        if legacy.exists() {
            path = legacy;
        }
    }
    let Some(raw) = read_manifest(&path) else { return };
    let Ok(manifest) = serde_json::from_str::<Manifest>(&raw) else { return };
    for (index, task) in manifest.tasks.into_iter().take(MAX_TASKS).enumerate() {
        let label = task.label.trim();
        let command = task.command.trim();
        if label.is_empty() || command.is_empty() {
            continue;
        }
        let group = group_for(label, &task.group);
        let is_default = task.is_default && group == "build";
        out.push(TaskDef {
            id: format!("kodra:{index}"),
            label: label.chars().take(120).collect(),
            source: "kodra".into(),
            detail: command.to_string(),
            command: command.to_string(),
            cwd: clean_cwd(&task.cwd),
            group,
            is_default,
        });
    }
}

/// Find `package.json` files without walking into dependencies.
fn package_files(root: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        if depth > MAX_PACKAGE_DEPTH || out.len() >= MAX_TASKS {
            return;
        }
        let manifest = dir.join("package.json");
        if manifest.is_file() {
            out.push(manifest);
        }
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            if out.len() >= MAX_TASKS {
                return;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(meta) = entry.metadata() else { continue };
            if !meta.is_dir() {
                continue;
            }
            if name.starts_with('.') || SKIP_DIRS.iter().any(|skip| skip.eq_ignore_ascii_case(&name))
            {
                continue;
            }
            walk(&entry.path(), depth + 1, out);
        }
    }

    let mut out = Vec::new();
    walk(root, 0, &mut out);
    out.sort();
    out
}

/// Walk up from `dir` to the workspace root and pick the package manager that
/// owns the lockfile, so nested packages inherit the repo's choice.
fn package_manager(dir: &Path, root: &Path) -> &'static str {
    let mut current = Some(dir);
    while let Some(folder) = current {
        if folder.join("pnpm-lock.yaml").is_file() {
            return "pnpm";
        }
        if folder.join("yarn.lock").is_file() {
            return "yarn";
        }
        if folder.join("bun.lockb").is_file() || folder.join("bun.lock").is_file() {
            return "bun";
        }
        if folder.join("package-lock.json").is_file() {
            return "npm";
        }
        if folder == root {
            break;
        }
        current = folder.parent();
    }
    "npm"
}

/// `package.json` scripts as tasks, labelled with their folder when nested.
fn script_tasks(root: &Path, out: &mut Vec<TaskDef>) {
    for manifest in package_files(root) {
        let Some(raw) = read_manifest(&manifest) else { continue };
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) else { continue };
        let Some(scripts) = parsed.get("scripts").and_then(|value| value.as_object()) else {
            continue;
        };
        let Some(dir) = manifest.parent() else { continue };
        let folder = rel_string(root, dir);
        let manager = package_manager(dir, root);
        for (name, value) in scripts {
            if out.len() >= MAX_TASKS {
                return;
            }
            let Some(command) = value.as_str() else { continue };
            if name.trim().is_empty() || command.contains("no test specified") {
                continue;
            }
            let label = if folder.is_empty() {
                name.clone()
            } else {
                format!("{}: {name}", folder)
            };
            let detail = format!("{manager} run {name}");
            out.push(TaskDef {
                id: format!("package:{folder}:{name}"),
                label,
                source: "package".into(),
                detail,
                command: format!("{manager} run {name}"),
                cwd: folder.clone(),
                group: group_for(name, ""),
                is_default: false,
            });
        }
    }
}

/// Targets from a root `Makefile`.
fn make_tasks(root: &Path, out: &mut Vec<TaskDef>) {
    let path = ["Makefile", "makefile", "GNUmakefile"]
        .iter()
        .map(|name| root.join(name))
        .find(|path| path.is_file());
    let Some(path) = path else { return };
    let Some(source) = read_manifest(&path) else { return };
    // The `regex` crate has no lookahead, so variable assignments (`NAME := x`)
    // are dropped by inspecting the text after the colon instead.
    let Ok(re) = Regex::new(r"(?m)^([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*:") else { return };
    let mut seen = Vec::new();
    for caps in re.captures_iter(&source) {
        if out.len() >= MAX_TASKS {
            return;
        }
        let name = caps.get(1).map(|m| m.as_str()).unwrap_or_default().to_string();
        if name.is_empty() || name.starts_with('.') || seen.contains(&name) {
            continue;
        }
        let rest = caps.get(0).map(|m| &source[m.end()..]).unwrap_or_default();
        if rest.trim_start().starts_with('=') {
            continue;
        }
        seen.push(name.clone());
        let detail = format!("make {name}");
        out.push(TaskDef {
            id: format!("make:{name}"),
            label: name.clone(),
            source: "make".into(),
            detail: detail.clone(),
            command: detail,
            cwd: String::new(),
            group: group_for(&name, ""),
            is_default: false,
        });
    }
}

/// Pick one default build task: manifest default, then a root `build` script,
/// then a `build` make target.
fn pick_default(tasks: &mut [TaskDef]) {
    let mut claimed = false;
    for task in tasks.iter_mut() {
        if !task.is_default {
            continue;
        }
        if claimed || task.group != "build" {
            task.is_default = false;
        } else {
            claimed = true;
        }
    }
    if claimed {
        return;
    }
    if let Some(task) = tasks
        .iter_mut()
        .find(|task| task.source == "package" && task.cwd.is_empty() && task.label == "build")
    {
        task.is_default = true;
        return;
    }
    if let Some(task) = tasks
        .iter_mut()
        .find(|task| task.source == "make" && task.label == "build")
    {
        task.is_default = true;
    }
}

/// Detect every task Kodra can run in this workspace.
pub fn detect_tasks(root: &Path) -> Vec<TaskDef> {
    let mut tasks = Vec::new();
    manifest_tasks(root, &mut tasks);
    script_tasks(root, &mut tasks);
    make_tasks(root, &mut tasks);
    tasks.truncate(MAX_TASKS);
    pick_default(&mut tasks);
    tasks
}

fn spawn_stream(
    app: AppHandle,
    run_id: String,
    stream: &'static str,
    reader: impl tokio::io::AsyncRead + Unpin + Send + 'static,
) {
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app.emit(
                "task:output",
                json!({ "runId": run_id, "stream": stream, "text": format!("{line}\n") }),
            );
        }
    });
}

/// Scan the workspace for runnable tasks.
#[tauri::command]
pub async fn tasks_detect(state: State<'_, AppState>) -> Result<Vec<TaskDef>, String> {
    let root = state.workspace_root()?;
    tauri::async_runtime::spawn_blocking(move || detect_tasks(&root))
        .await
        .map_err(|e| e.to_string())
}

/// Start a task and stream its output through `task:output` / `task:exit`.
#[tauri::command]
pub async fn task_run(
    app: AppHandle,
    task: TaskDef,
    state: State<'_, AppState>,
) -> Result<TaskRunInfo, String> {
    let root = state.workspace_root()?;
    let command = task.command.trim().to_string();
    if command.is_empty() {
        return Err("this task has no command".into());
    }
    if command.chars().count() > 4000 {
        return Err("this task command is too long".into());
    }

    let cwd_rel = clean_cwd(&task.cwd);
    let cwd = if cwd_rel.is_empty() {
        root.clone()
    } else {
        let dir = resolve_in_workspace(&root, &cwd_rel)?;
        if !dir.is_dir() {
            return Err(format!("task folder `{cwd_rel}` does not exist"));
        }
        dir
    };

    let mut cmd = if cfg!(windows) {
        let mut cmd = Command::new("cmd");
        cmd.args(["/D", "/C", &command]);
        cmd
    } else {
        let mut cmd = Command::new("sh");
        cmd.args(["-lc", &command]);
        cmd
    };
    cmd.current_dir(&cwd)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .env("NO_COLOR", "1")
        .env("CLICOLOR", "0")
        .env("FORCE_COLOR", "0")
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start the task: {e}"))?;
    let pid = child.id().unwrap_or(0);

    let id = uuid::Uuid::new_v4().to_string();
    if pid > 0 {
        let mut runs = state.task_runs.lock();
        if runs.len() >= MAX_RUNS {
            if let Some(oldest) = runs.keys().next().cloned() {
                runs.remove(&oldest);
            }
        }
        runs.insert(id.clone(), pid);
    }

    if let Some(stdout) = child.stdout.take() {
        spawn_stream(app.clone(), id.clone(), "stdout", stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_stream(app.clone(), id.clone(), "stderr", stderr);
    }

    let started = Instant::now();
    let exit_app = app.clone();
    let exit_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let code = match child.wait().await {
            Ok(status) => status.code().unwrap_or(-1),
            Err(_) => -1,
        };
        let _ = exit_app.emit(
            "task:exit",
            json!({
                "runId": exit_id,
                "code": code,
                "durationMs": started.elapsed().as_millis() as u64,
            }),
        );
    });

    Ok(TaskRunInfo {
        id,
        label: command,
        cwd: cwd.to_string_lossy().to_string(),
    })
}

fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

/// Stop a running task (and everything it spawned).
#[tauri::command]
pub fn task_cancel(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let pid = state.task_runs.lock().remove(&id);
    let Some(pid) = pid else { return Ok(false) };
    kill_tree(pid);
    Ok(true)
}

/// Stop every running task (used when the workspace changes).
#[tauri::command]
pub fn task_cancel_all(state: State<'_, AppState>) -> usize {
    let pids: Vec<u32> = state.task_runs.lock().drain().map(|(_, pid)| pid).collect();
    for pid in &pids {
        kill_tree(*pid);
    }
    pids.len()
}

/// Names of the shells/tools tasks rely on, for the pane header.
#[tauri::command]
pub fn tasks_toolchain() -> HashMap<String, String> {
    let mut found = HashMap::new();
    for name in ["npm", "pnpm", "yarn", "bun", "node", "make"] {
        if let Some(path) = which(name) {
            found.insert(name.to_string(), path.to_string_lossy().to_string());
        }
    }
    found
}
