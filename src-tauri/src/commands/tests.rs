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

/// Folders that never hold hand-written tests (dependencies, build output).
const SKIP_DIRS: &[&str] = &[
    ".git", ".hg", ".svn", "node_modules", "target", "dist", ".output", ".nuxt", ".next",
    "vendor", "venv", ".venv", "__pycache__", "build", "bin", "obj", ".idea", ".vscode",
];
const MAX_SCAN_FILES: usize = 8000;
const MAX_TEST_FILES: usize = 400;
const MAX_SOURCE_BYTES: u64 = 512 * 1024;
/// Keep at most this many finished runs around for cancellation bookkeeping.
const MAX_RUNS: usize = 24;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TestCase {
    pub name: String,
    pub line: u32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TestFile {
    /// Absolute path of the file that declares the tests.
    pub path: String,
    /// Workspace relative path with forward slashes.
    pub rel: String,
    /// `go`, `rust`, `python` or `node`.
    pub framework: String,
    /// Folder the runner should be pointed at (package, crate or project root).
    pub package: String,
    pub tests: Vec<TestCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestRunRequest {
    pub framework: String,
    /// Workspace relative file that holds the test (optional for "run all").
    #[serde(default)]
    pub file: Option<String>,
    /// Single test name to filter on.
    #[serde(default)]
    pub test: Option<String>,
    /// Package/crate folder, relative to the workspace root.
    #[serde(default)]
    pub package: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestRunInfo {
    pub id: String,
    /// Human readable command line shown in the test output header.
    pub label: String,
    pub cwd: String,
}

fn rel_string(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn collect_files(root: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>, budget: &mut usize, depth: usize) {
        if *budget == 0 || depth > 24 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            if *budget == 0 {
                return;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                if name.starts_with('.') || SKIP_DIRS.iter().any(|skip| skip.eq_ignore_ascii_case(&name)) {
                    continue;
                }
                walk(&entry.path(), out, budget, depth + 1);
            } else if meta.is_file() {
                *budget -= 1;
                out.push(entry.path());
            }
        }
    }

    let mut out = Vec::new();
    let mut budget = MAX_SCAN_FILES;
    walk(root, &mut out, &mut budget, 0);
    out
}

fn line_of(content: &str, offset: usize) -> u32 {
    content[..offset].matches('\n').count() as u32 + 1
}

fn read_source(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.len() > MAX_SOURCE_BYTES {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

fn crate_dir(root: &Path, file: &Path) -> String {
    let mut dir = file.parent().map(|p| p.to_path_buf());
    while let Some(current) = dir {
        if current.join("Cargo.toml").is_file() {
            return rel_string(root, &current);
        }
        if current == root || !current.starts_with(root) {
            break;
        }
        dir = current.parent().map(|p| p.to_path_buf());
    }
    String::new()
}

/// Detect tests for the four frameworks Kudo can run today.
pub fn detect_tests(root: &Path) -> Vec<TestFile> {
    let go_re = Regex::new(r"(?m)^func\s+(Test\w*|Benchmark\w*|Fuzz\w*)\s*\(").unwrap();
    let rust_re = Regex::new(
        r"(?m)^\s*#\[(?:[\w:]+::)?(?:test|rstest|quickcheck)\b[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)",
    )
    .unwrap();
    let py_re = Regex::new(r"(?m)^\s*(?:async\s+)?def\s+(test\w*)\s*\(").unwrap();

    let mut files = Vec::new();
    for path in collect_files(root) {
        if files.len() >= MAX_TEST_FILES {
            break;
        }
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();

        // package.json test scripts count as a runnable node project.
        if name == "package.json" {
            if let Some(raw) = read_source(&path) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) {
                    let has_test = parsed
                        .get("scripts")
                        .and_then(|scripts| scripts.get("test"))
                        .and_then(|cmd| cmd.as_str())
                        .map(|cmd| !cmd.trim().is_empty() && !cmd.contains("no test specified"))
                        .unwrap_or(false);
                    if has_test {
                        files.push(TestFile {
                            path: path.to_string_lossy().to_string(),
                            rel: rel_string(root, &path),
                            framework: "node".into(),
                            package: rel_string(root, path.parent().unwrap_or(root)),
                            tests: Vec::new(),
                        });
                    }
                }
            }
            continue;
        }

        let (framework, pattern) = match ext.as_str() {
            "go" if name.ends_with("_test.go") => ("go", &go_re),
            "rs" => ("rust", &rust_re),
            "py" if name.starts_with("test_") || name.ends_with("_test.py") => ("python", &py_re),
            "js" | "jsx" | "ts" | "tsx" | "mjs" | "cjs"
                if name.contains(".test.") || name.contains(".spec.") =>
            {
                // Node runners print their own results; Kudo shows them in the output.
                ("node", &py_re)
            }
            _ => continue,
        };

        let Some(source) = read_source(&path) else { continue };
        let tests: Vec<TestCase> = pattern
            .captures_iter(&source)
            .filter_map(|caps| {
                let whole = caps.get(0)?;
                let name = caps.get(1)?.as_str().to_string();
                Some(TestCase {
                    name,
                    line: line_of(&source, whole.start()),
                })
            })
            .collect();
        if framework == "node" {
            files.push(TestFile {
                path: path.to_string_lossy().to_string(),
                rel: rel_string(root, &path),
                framework: framework.into(),
                package: rel_string(root, path.parent().unwrap_or(root)),
                tests: Vec::new(),
            });
            continue;
        }
        if tests.is_empty() {
            continue;
        }
        let package = if framework == "rust" {
            crate_dir(root, &path)
        } else {
            rel_string(root, path.parent().unwrap_or(root))
        };
        files.push(TestFile {
            path: path.to_string_lossy().to_string(),
            rel: rel_string(root, &path),
            framework: framework.into(),
            package,
            tests,
        });
    }

    files.sort_by(|a, b| a.rel.cmp(&b.rel));
    files
}

fn node_package_manager(root: &Path) -> &'static str {
    if root.join("pnpm-lock.yaml").is_file() {
        "pnpm"
    } else if root.join("yarn.lock").is_file() {
        "yarn"
    } else if root.join("bun.lockb").is_file() || root.join("bun.lock").is_file() {
        "bun"
    } else {
        "npm"
    }
}

struct Planned {
    program: String,
    args: Vec<String>,
    cwd: PathBuf,
    label: String,
}

fn plan(req: &TestRunRequest, root: &Path) -> Result<Planned, String> {
    let file_rel = req.file.as_deref().unwrap_or("").trim_matches('/').to_string();
    let test = req.test.as_deref().map(|name| name.trim().to_string()).filter(|n| !n.is_empty());
    let package_rel = req.package.as_deref().unwrap_or("").trim_matches('/').to_string();
    let cwd = if package_rel.is_empty() {
        root.to_path_buf()
    } else {
        let dir = resolve_in_workspace(root, &package_rel)?;
        if dir.is_dir() {
            dir
        } else {
            root.to_path_buf()
        }
    };

    let planned = match req.framework.as_str() {
        "go" => {
            let program = which("go")
                .map(|p| p.to_string_lossy().to_string())
                .ok_or("`go` was not found on PATH")?;
            let mut args = vec!["test".to_string(), "-v".to_string(), "-count=1".to_string()];
            // The working directory is already the package for filtered runs, so
            // "." is enough there; a full run walks every package from the root.
            args.push(if test.is_some() { ".".into() } else { "./...".into() });
            if let Some(name) = &test {
                args.push("-run".into());
                args.push(format!("^{}$", regex::escape(name)));
            }
            Planned { program, args, cwd, label: String::new() }
        }
        "rust" => {
            let program = which("cargo")
                .map(|p| p.to_string_lossy().to_string())
                .ok_or("`cargo` was not found on PATH")?;
            let mut args = vec!["test".to_string(), "--color".into(), "never".into()];
            if let Some(name) = &test {
                args.push(name.clone());
                args.push("--".into());
                args.push("--exact".into());
            }
            Planned { program, args, cwd, label: String::new() }
        }
        "python" => {
            let program = which("python")
                .or_else(|| which("python3"))
                .map(|p| p.to_string_lossy().to_string())
                .ok_or("`python` was not found on PATH")?;
            let mut args = vec!["-m".to_string(), "pytest".into(), "-v".into()];
            let mut target = file_rel.clone();
            if let Some(name) = &test {
                target = if target.is_empty() {
                    name.clone()
                } else {
                    format!("{target}::{name}")
                };
            }
            if !target.is_empty() {
                args.push(target);
            }
            Planned { program, args, cwd, label: String::new() }
        }
        "node" => {
            let manager = node_package_manager(root);
            let program = which(manager)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| manager.to_string());
            // Package scripts decide how they filter; pass the file only when we
            // know the runner accepts a path pattern.
            let can_filter = !file_rel.is_empty()
                && (root.join("jest.config.js").exists()
                    || root.join("jest.config.ts").exists()
                    || root.join("vitest.config.ts").exists()
                    || root.join("vitest.config.js").exists());
            let mut args = vec!["test".to_string()];
            if can_filter {
                args.push("--".into());
                args.push(file_rel.clone());
            }
            Planned { program, args, cwd, label: String::new() }
        }
        other => return Err(format!("unsupported test framework `{other}`")),
    };

    let mut label = planned.program.clone();
    for arg in &planned.args {
        label.push(' ');
        if arg.contains(' ') {
            label.push('"');
            label.push_str(arg);
            label.push('"');
        } else {
            label.push_str(arg);
        }
    }
    Ok(Planned { label, ..planned })
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
                "test:output",
                json!({ "runId": run_id, "stream": stream, "text": format!("{line}\n") }),
            );
        }
    });
}

/// Scan the workspace for runnable tests.
#[tauri::command]
pub async fn tests_detect(state: State<'_, AppState>) -> Result<Vec<TestFile>, String> {
    let root = state.workspace_root()?;
    tauri::async_runtime::spawn_blocking(move || detect_tests(&root))
        .await
        .map_err(|e| e.to_string())
}

/// Start a test run and stream its output through `test:output` / `test:exit`.
#[tauri::command]
pub async fn test_run(
    app: AppHandle,
    req: TestRunRequest,
    state: State<'_, AppState>,
) -> Result<TestRunInfo, String> {
    let root = state.workspace_root()?;
    let planned = plan(&req, &root)?;

    let mut cmd = Command::new(&planned.program);
    cmd.args(&planned.args)
        .current_dir(&planned.cwd)
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
        .map_err(|e| format!("could not start `{}`: {e}", planned.program))?;
    let pid = child.id().unwrap_or(0);

    let id = uuid::Uuid::new_v4().to_string();
    if pid > 0 {
        let mut runs = state.test_runs.lock();
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
            "test:exit",
            json!({
                "runId": exit_id,
                "code": code,
                "durationMs": started.elapsed().as_millis() as u64,
            }),
        );
    });

    Ok(TestRunInfo {
        id,
        label: planned.label,
        cwd: planned.cwd.to_string_lossy().to_string(),
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

/// Stop a running test run (and everything it spawned).
#[tauri::command]
pub fn test_cancel(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let pid = state.test_runs.lock().remove(&id);
    let Some(pid) = pid else { return Ok(false) };
    kill_tree(pid);
    Ok(true)
}

/// Stop every running test run (used when the workspace changes).
#[tauri::command]
pub fn test_cancel_all(state: State<'_, AppState>) -> usize {
    let pids: Vec<u32> = state.test_runs.lock().drain().map(|(_, pid)| pid).collect();
    for pid in &pids {
        kill_tree(*pid);
    }
    pids.len()
}

/// Names of the runners found on this machine, for the pane header.
#[tauri::command]
pub fn tests_toolchain() -> HashMap<String, String> {
    let mut found = HashMap::new();
    for name in ["go", "cargo", "python", "npm", "pnpm", "yarn"] {
        if let Some(path) = which(name) {
            found.insert(name.to_string(), path.to_string_lossy().to_string());
        }
    }
    found
}
