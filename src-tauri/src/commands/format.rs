use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::AppState;
use crate::util::{resolve_in_workspace, which};

/// Largest buffer Kodra will hand to a formatter (and read back).
const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
/// How long one formatter/linter invocation may take before it is killed.
const TOOL_TIMEOUT: Duration = Duration::from_secs(20);
/// Keep the raw lint output small when it cannot be parsed.
const MAX_RAW_OUTPUT: usize = 6000;

/// One formatter or linter Kodra knows how to run.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub id: String,
    pub label: String,
    /// `formatter` or `linter`.
    pub kind: String,
    pub languages: Vec<String>,
    /// Executable (or wrapper script) that will be spawned; empty when missing.
    pub path: String,
    /// How the tool was found: `workspace`, `path` or empty when missing.
    pub scope: String,
    pub install: String,
}

/// Formatted text, or the input text when nothing changed.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatResult {
    /// Empty when no formatter covers this file.
    pub tool: String,
    pub changed: bool,
    pub text: String,
}

/// One diagnostic reported by a command line linter.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LintIssue {
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub message: String,
    /// `error`, `warning` or `info`.
    pub severity: String,
    /// Tool id plus rule id (`eslint (no-unused-vars)`).
    pub source: String,
    pub code: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LintResult {
    /// Empty when no linter covers this file.
    pub tool: String,
    pub issues: Vec<LintIssue>,
    /// Raw output when the linter could not be parsed.
    pub raw: String,
    /// Non-empty when the linter itself failed (missing config, crash).
    pub error: String,
}

/// A resolved command line: program plus the fixed arguments that run the tool.
struct Plan {
    program: PathBuf,
    args: Vec<String>,
    /// How the tool was found (`workspace` / `path`).
    scope: String,
    /// What the UI should show: the workspace script when the real executable
    /// is just Node, otherwise the tool itself.
    display: String,
}

struct Spec {
    id: &'static str,
    label: &'static str,
    kind: &'static str,
    languages: &'static [&'static str],
    install: &'static str,
}

const SPECS: &[Spec] = &[
    Spec {
        id: "prettier",
        label: "Prettier",
        kind: "formatter",
        languages: &["javascript", "typescript", "json", "css", "html", "markdown", "yaml", "vue"],
        install: "npm install -D prettier",
    },
    Spec {
        id: "gofmt",
        label: "gofmt",
        kind: "formatter",
        languages: &["go"],
        install: "ships with the Go toolchain",
    },
    Spec {
        id: "rustfmt",
        label: "rustfmt",
        kind: "formatter",
        languages: &["rust"],
        install: "rustup component add rustfmt",
    },
    Spec {
        id: "black",
        label: "Black",
        kind: "formatter",
        languages: &["python"],
        install: "pip install black",
    },
    Spec {
        id: "eslint",
        label: "ESLint",
        kind: "linter",
        languages: &["javascript", "typescript", "vue"],
        install: "npm install -D eslint",
    },
    Spec {
        id: "ruff",
        label: "Ruff",
        kind: "linter",
        languages: &["python"],
        install: "pip install ruff",
    },
];

fn language_for_path(path: &Path) -> String {
    let ext = path
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let language = match ext.as_str() {
        "ts" | "tsx" | "mts" | "cts" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "vue" => "vue",
        "json" | "jsonc" => "json",
        "css" | "scss" | "less" => "css",
        "html" | "htm" => "html",
        "md" | "mdx" => "markdown",
        "yml" | "yaml" => "yaml",
        "go" => "go",
        "rs" => "rust",
        "py" | "pyi" => "python",
        _ => "",
    };
    language.to_string()
}

/// Look for a workspace-local wrapper script so the project's own pinned
/// version wins over a global install.
fn workspace_script(root: &Path, candidates: &[&str]) -> Option<PathBuf> {
    candidates
        .iter()
        .map(|candidate| root.join(candidate))
        .find(|path| path.is_file())
}

fn node_plan(root: &Path, scripts: &[&str]) -> Option<Plan> {
    let script = workspace_script(root, scripts)?;
    let node = which("node")?;
    Some(Plan {
        program: node,
        args: vec![script.to_string_lossy().to_string()],
        scope: "workspace".into(),
        display: script.to_string_lossy().to_string(),
    })
}

fn path_plan(program: &str, args: &[&str]) -> Option<Plan> {
    let path = which(program)?;
    Some(Plan {
        display: path.to_string_lossy().to_string(),
        program: path,
        args: args.iter().map(|arg| arg.to_string()).collect(),
        scope: "path".into(),
    })
}

/// Check that `python -m <module>` really exists before offering it: on Windows
/// `python` is on PATH long before the module is installed.
fn python_module(python: &Path, module: &str) -> bool {
    let mut command = Command::new(python);
    command
        .args(["-m", module, "--version"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    matches!(command.status(), Ok(status) if status.success())
}

fn python_plan(module: &str, args: &[&str]) -> Option<Plan> {
    let python = which("python").or_else(|| which("python3"))?;
    if !python_module(&python, module) {
        return None;
    }
    let mut full = vec!["-m".to_string(), module.to_string()];
    full.extend(args.iter().map(|arg| arg.to_string()));
    Some(Plan {
        display: python.to_string_lossy().to_string(),
        program: python,
        args: full,
        scope: "path".into(),
    })
}

/// Resolve the command line for a tool inside `root`.
fn plan_for(tool: &str, root: Option<&Path>) -> Option<Plan> {
    let root = root?;
    match tool {
        "prettier" => node_plan(
            root,
            &[
                "node_modules/prettier/bin/prettier.cjs",
                "node_modules/prettier/bin-prettier.js",
                "node_modules/prettier/bin/prettier.js",
            ],
        )
        .or_else(|| path_plan("prettier", &[])),
        "eslint" => node_plan(root, &["node_modules/eslint/bin/eslint.js"])
            .or_else(|| path_plan("eslint", &[])),
        "gofmt" => path_plan("gofmt", &[]).or_else(|| {
            let goroot = std::env::var_os("GOROOT")?;
            let candidate = PathBuf::from(goroot).join("bin").join("gofmt.exe");
            candidate.is_file().then(|| Plan {
                display: candidate.to_string_lossy().to_string(),
                program: candidate,
                args: Vec::new(),
                scope: "path".into(),
            })
        }),
        "rustfmt" => path_plan("rustfmt", &[]),
        "black" => path_plan("black", &[]).or_else(|| python_plan("black", &[])),
        "ruff" => path_plan("ruff", &[]).or_else(|| python_plan("ruff", &[])),
        _ => None,
    }
}

/// Prefer a workspace-local install, otherwise the first tool on `PATH`.
fn pick_plan(kind: &str, language: &str, root: Option<&Path>) -> Option<(String, Plan)> {
    for spec in SPECS.iter().filter(|spec| spec.kind == kind) {
        if !spec.languages.contains(&language) {
            continue;
        }
        if let Some(plan) = plan_for(spec.id, root) {
            return Some((spec.id.to_string(), plan));
        }
    }
    None
}

struct RunOutput {
    code: i32,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Spawn a plan, optionally feeding stdin, with a watchdog around `wait`.
fn run(plan: &Plan, extra: &[String], stdin_text: Option<&str>, cwd: &Path) -> Result<RunOutput, String> {
    let mut command = {
        #[cfg(windows)]
        {
            let extension = plan
                .program
                .extension()
                .map(|value| value.to_string_lossy().to_ascii_lowercase());
            if matches!(extension.as_deref(), Some("cmd") | Some("bat")) {
                // `.cmd` shims (npm global installs) can only run inside cmd.exe.
                let mut cmd = Command::new("cmd");
                cmd.arg("/D").arg("/C").arg(&plan.program).args(&plan.args);
                cmd
            } else {
                let mut cmd = Command::new(&plan.program);
                cmd.args(&plan.args);
                cmd
            }
        }
        #[cfg(not(windows))]
        {
            let mut cmd = Command::new(&plan.program);
            cmd.args(&plan.args);
            cmd
        }
    };
    command
        .args(extra)
        .current_dir(cwd)
        .stdin(if stdin_text.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0")
        .env("CLICOLOR", "0");
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", plan.program.display()))?;
    let pid = child.id();

    if let Some(text) = stdin_text {
        if let Some(mut stdin) = child.stdin.take() {
            let payload = text.as_bytes().to_vec();
            // The formatter may write before it has read every byte, so the
            // write must not happen on the thread that drains stdout.
            std::thread::spawn(move || {
                let _ = stdin.write_all(&payload);
            });
        }
    }

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = child.wait_with_output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(TOOL_TIMEOUT) {
        Ok(Ok(output)) => Ok(RunOutput {
            code: output.status.code().unwrap_or(-1),
            stdout: output.stdout,
            stderr: output.stderr,
        }),
        Ok(Err(err)) => Err(format!("tool failed: {err}")),
        Err(_) => {
            if pid > 0 {
                kill_tree(pid);
            }
            let _ = rx.recv_timeout(Duration::from_secs(2));
            Err("the formatter timed out".into())
        }
    }
}

fn tail(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes).to_string();
    if text.chars().count() <= MAX_RAW_OUTPUT {
        return text.trim().to_string();
    }
    let skip = text.chars().count() - MAX_RAW_OUTPUT;
    text.chars().skip(skip).collect::<String>().trim().to_string()
}

/// Format `text` as if it lived at `path` (which must be inside the workspace).
pub fn format_text(
    root: &Path,
    path: &Path,
    text: &str,
    tool: Option<&str>,
) -> Result<FormatResult, String> {
    if text.len() > MAX_TEXT_BYTES {
        return Err("this file is too large to format".into());
    }
    let language = language_for_path(path);
    let chosen = match tool.filter(|value| !value.trim().is_empty()) {
        Some(id) => plan_for(id, Some(root)).map(|plan| (id.to_string(), plan)),
        None => pick_plan("formatter", &language, Some(root)),
    };
    let Some((id, plan)) = chosen else {
        return Ok(FormatResult {
            tool: String::new(),
            changed: false,
            text: text.to_string(),
        });
    };

    let file = path.to_string_lossy().to_string();
    let mut extra: Vec<String> = Vec::new();
    match id.as_str() {
        "prettier" => {
            extra.push("--stdin-filepath".into());
            extra.push(file);
        }
        "black" => {
            extra.push("--stdin-filename".into());
            extra.push(file);
            extra.push("-q".into());
            extra.push("-".into());
        }
        "rustfmt" => {
            extra.push("--edition".into());
            extra.push("2021".into());
        }
        _ => {}
    }

    let output = run(&plan, &extra, Some(text), root)?;
    if output.code != 0 {
        let message = tail(&output.stderr);
        return Err(if message.is_empty() {
            format!("{id} exited with code {}", output.code)
        } else {
            format!("{id}: {message}")
        });
    }
    let formatted = String::from_utf8_lossy(&output.stdout).to_string();
    if formatted.trim().is_empty() && !text.trim().is_empty() {
        return Err(format!("{id} returned no output"));
    }
    Ok(FormatResult {
        tool: id,
        changed: formatted != text,
        text: formatted,
    })
}

#[derive(Deserialize)]
struct EslintMessage {
    #[serde(default)]
    line: u32,
    #[serde(default)]
    column: u32,
    #[serde(default, rename = "endLine")]
    end_line: u32,
    #[serde(default, rename = "endColumn")]
    end_column: u32,
    #[serde(default)]
    message: String,
    #[serde(default)]
    severity: u32,
    #[serde(default, rename = "ruleId")]
    rule_id: Option<String>,
}

#[derive(Deserialize)]
struct EslintFile {
    #[serde(default)]
    messages: Vec<EslintMessage>,
}

#[derive(Deserialize)]
struct RuffPoint {
    #[serde(default)]
    row: u32,
    #[serde(default)]
    column: u32,
}

#[derive(Deserialize)]
struct RuffIssueRaw {
    #[serde(default)]
    code: String,
    #[serde(default)]
    message: String,
    /// Newer Ruff releases report their own severity; older ones omit it.
    #[serde(default)]
    severity: Option<String>,
    location: Option<RuffPoint>,
    end_location: Option<RuffPoint>,
}

fn parse_eslint(raw: &str) -> Option<Vec<LintIssue>> {
    let files: Vec<EslintFile> = serde_json::from_str(raw).ok()?;
    let mut issues = Vec::new();
    for file in files {
        for message in file.messages {
            let severity = if message.severity >= 2 { "error" } else { "warning" };
            let code = message.rule_id.unwrap_or_default();
            issues.push(LintIssue {
                line: message.line.max(1),
                column: message.column.max(1),
                end_line: message.end_line.max(message.line).max(1),
                end_column: message.end_column.max(message.column).max(1),
                message: message.message,
                severity: severity.into(),
                source: if code.is_empty() {
                    "eslint".into()
                } else {
                    format!("eslint ({code})")
                },
                code,
            });
        }
    }
    Some(issues)
}

fn parse_ruff(raw: &str) -> Option<Vec<LintIssue>> {
    let items: Vec<RuffIssueRaw> = serde_json::from_str(raw).ok()?;
    let mut issues = Vec::new();
    for item in items {
        let line = item.location.as_ref().map(|p| p.row).unwrap_or(1);
        let column = item.location.as_ref().map(|p| p.column).unwrap_or(1);
        let end_line = item.end_location.as_ref().map(|p| p.row).unwrap_or(line);
        let end_column = item.end_location.as_ref().map(|p| p.column).unwrap_or(column);
        // Newer Ruff builds carry a severity; otherwise fall back to the rule
        // code convention (W* are warnings, everything else an error).
        let severity = match item.severity.as_deref() {
            Some("warning") => "warning",
            Some("info") => "info",
            Some("error") => "error",
            _ => {
                if item.code.starts_with('W') {
                    "warning"
                } else {
                    "error"
                }
            }
        };
        issues.push(LintIssue {
            line: line.max(1),
            column: column.max(1),
            end_line: end_line.max(line).max(1),
            end_column: end_column.max(column).max(1),
            message: item.message,
            severity: severity.into(),
            source: if item.code.is_empty() {
                "ruff".into()
            } else {
                format!("ruff ({})", item.code)
            },
            code: item.code,
        });
    }
    Some(issues)
}

/// Run the linter for `path` and normalise its JSON output.
pub fn lint_text(root: &Path, path: &Path, text: &str) -> Result<LintResult, String> {
    if text.len() > MAX_TEXT_BYTES {
        return Err("this file is too large to lint".into());
    }
    let language = language_for_path(path);
    let Some((id, plan)) = pick_plan("linter", &language, Some(root)) else {
        return Ok(LintResult {
            tool: String::new(),
            issues: Vec::new(),
            raw: String::new(),
            error: String::new(),
        });
    };

    let file = path.to_string_lossy().to_string();
    let extra: Vec<String> = match id.as_str() {
        "eslint" => vec![
            "--format".into(),
            "json".into(),
            "--stdin".into(),
            "--stdin-filename".into(),
            file,
        ],
        "ruff" => vec![
            "check".into(),
            "--output-format".into(),
            "json".into(),
            "--stdin-filename".into(),
            file,
            "-".into(),
        ],
        _ => vec![
            "--output-format".into(),
            "json".into(),
            "--stdin-filename".into(),
            file,
            "-".into(),
        ],
    };

    let output = run(&plan, &extra, Some(text), root)?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = tail(&output.stderr);
    let parsed = match id.as_str() {
        "eslint" => parse_eslint(&stdout),
        _ => parse_ruff(&stdout),
    };
    match parsed {
        Some(issues) => Ok(LintResult {
            tool: id,
            issues,
            raw: String::new(),
            error: if output.code > 1 { stderr } else { String::new() },
        }),
        None => Ok(LintResult {
            tool: id,
            issues: Vec::new(),
            raw: tail(&output.stdout),
            error: if stderr.is_empty() {
                format!("could not read the linter output (exit code {})", output.code)
            } else {
                stderr
            },
        }),
    }
}

fn workspace_root(state: &State<'_, AppState>) -> Option<PathBuf> {
    state.workspace_root().ok()
}

/// Detect the formatters and linters available for this workspace.
#[tauri::command]
pub async fn format_toolchain(state: State<'_, AppState>) -> Result<Vec<ToolInfo>, String> {
    let root = workspace_root(&state);
    tauri::async_runtime::spawn_blocking(move || {
        SPECS
            .iter()
            .map(|spec| {
                let plan = plan_for(spec.id, root.as_deref());
                // Tools that only exist on PATH are still useful without a
                // workspace, so the list keeps a stable shape when nothing is
                // open (paths simply come back empty).
                ToolInfo {
                    id: spec.id.into(),
                    label: spec.label.into(),
                    kind: spec.kind.into(),
                    languages: spec.languages.iter().map(|l| l.to_string()).collect(),
                    path: plan
                        .as_ref()
                        .map(|plan| plan.display.clone())
                        .unwrap_or_default(),
                    scope: plan.map(|plan| plan.scope).unwrap_or_default(),
                    install: spec.install.into(),
                }
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Format one buffer. The frontend sends the editor text so unsaved edits are
/// formatted without touching the file first.
#[tauri::command]
pub async fn format_document(
    path: String,
    text: String,
    tool: Option<String>,
    state: State<'_, AppState>,
) -> Result<FormatResult, String> {
    let root = state.workspace_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let resolved = resolve_in_workspace(&root, &path)?;
        format_text(&root, &resolved, &text, tool.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Lint one buffer and return normalised diagnostics.
#[tauri::command]
pub async fn lint_document(
    path: String,
    text: String,
    state: State<'_, AppState>,
) -> Result<LintResult, String> {
    let root = state.workspace_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let resolved = resolve_in_workspace(&root, &path)?;
        lint_text(&root, &resolved, &text)
    })
    .await
    .map_err(|e| e.to_string())?
}
