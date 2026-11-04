# Kodra

A fast desktop IDE for code, terminals, databases and AI agents — built with **Tauri v2 + Nuxt 3 + Rust**.

Kodra runs entirely on your machine: the editor, terminal, git, debugger, database browser and
AI agent share one window. Bring your own model key; nothing is uploaded unless you ask the agent
to run a tool or send a prompt.

## Install (Windows x64)

1. Download the `Kodra_<version>_x64-setup.exe` installer from the
   [latest release](https://github.com/J4NNEY/kodra-ide/releases/latest).
2. Run it. Kodra installs for the current user (no administrator prompt), into your user profile,
   and creates Start Menu and desktop shortcuts.
3. Launch Kodra and open a folder with **File → Open Folder**.

Requirements: Windows 10 1809+ or Windows 11, x64. The installer fetches the Evergreen WebView2
runtime if it is missing.

The installer is **not code-signed yet**, so Windows SmartScreen may show *Unknown publisher*.
Verify the download with the SHA-256 published next to it before running:

```powershell
Get-FileHash .\Kodra_*_x64-setup.exe -Algorithm SHA256
```

Updates are opt-in: the built-in updater checks a feed you configure and verifies the
installer's SHA-256 before offering **Install** (see [`docs/updater.md`](docs/updater.md)). Point
**Settings → Update feed** at
`https://github.com/J4NNEY/kodra-ide/releases/latest/download/latest.json`.

Kodra keeps settings in `%APPDATA%\app.kodra.desktop`. On first launch after the rename it copies
settings, checkpoints and extensions from the old `dev.kudo.desktop` folder without deleting the old
data.

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/running.md`](docs/running.md) | Step-by-step setup, toolchains and troubleshooting (in Indonesian) |
| [`docs/releasing.md`](docs/releasing.md) | Release checklist, code-signing variables, update-feed hosting |
| [`docs/updater.md`](docs/updater.md) | Update manifest format and verification rules |
| [`CHANGELOG.md`](CHANGELOG.md) | Release notes |
| [`SECURITY.md`](SECURITY.md) | Threat model and private vulnerability reporting |
| [`PRIVACY.md`](PRIVACY.md) | What is stored locally and what leaves the machine |
| [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) | Third-party licences |

## Features

| Area | What works |
| --- | --- |
| Editor | CodeMirror 6, syntax highlighting for 20+ languages, tabs, split panes with independent tabs, dirty state, quick open (`Ctrl+P`), go to line, find/replace in file |
| Terminal | Real PTY (`portable-pty`), xterm.js, multiple tabbed sessions, shell picker with detected shells, resizable panel, PowerShell by default on Windows |
| Workspace | Native folder picker, file tree with inline create/rename/delete, fuzzy search, project-wide search with case/whole-word/regex toggles, previewed replace-all |
| Source control | Git status, stage/unstage, commit, branch switch, history, diff preview, and worktrees (list, create on a new branch, open, remove, prune stale) |
| Agent | Streaming chat with OpenAI-compatible and Anthropic providers, tool calling (`list_dir`, `read_file`, `write_file`, `search_files`, `grep`, `run_command`, `read_skill`, `read_design`, `write_design`), inline approval cards, cancellation |
| Checkpoints | Every agent file write snapshots the previous contents first; chat replies show a Restore card with the touched files and the Agent pane lists recent changes |
| Skills | Discovers `SKILL.md` bundles in `.kodra/skills`, `.claude/skills` and the user config dir; catalog injected into the agent prompt |
| Database | SQLite browser (tables, schema, paging), SQL console with history, CSV export via native save dialog |
| Browser | In-app preview overlay with address bar, remembered last URL, self-origin guard, request inspector run in Rust (no CORS), open in system browser |
| Design | Full-screen design canvas (`Ctrl+Shift+M`): one board per screen at desktop/tablet/mobile sizes, a 19-component palette (frames, stacks, rows, cards, navbars, lists, headings, text, buttons, inputs and more), auto-layout, layer tree, inspector, drag reorder, resize handles, pan/zoom, light/dark boards, undo/redo and per-workspace autosave; the agent reads it with `read_design`, edits it with `write_design` under approval, and a generated `.kodra/design` copy keeps the tree on disk |
| Whiteboard | Full-screen whiteboard overlay (`Ctrl+Shift+Alt+M`): sticky notes, rectangles, ellipses, diamonds, text, freehand pen and connectors that stay attached to the shapes they link; pan/zoom, multi-select with resize handles, undo/redo, per-workspace autosave and PNG export |
| MCP | stdio JSON-RPC client, server presets, connect/disconnect, tool list and a tool runner |
| LSP | Language servers on PATH (rust-analyzer, gopls, Dart, TypeScript, Pyright, JSON/CSS/HTML) start per language; completion with auto-import edits, hover docs, go-to-definition (`F12`/`Ctrl+click`), signature help and occurrence highlighting at the cursor, semantic tokens and inline type/parameter hints, call hierarchy (`Shift+Alt+H`) and type hierarchy, rename (`F2`), references (`Shift+F12`), document symbols (`Ctrl+Shift+O`), workspace symbols (`Ctrl+T`), quick fixes (`Ctrl+.`), diagnostics as squiggles plus a Problems panel and status-bar counts |
| Debugger | Debug Adapter Protocol client over stdio (Delve, CodeLLDB, lldb-dap, custom): launch configs, breakpoint gutter with conditions, call stack, lazily expanded variables, watch expressions, console, and step/continue/stop controls (`F5`, `F9`, `F10`, `F11`, `Shift+F11`, `Shift+F5`) |
| Tests | Test explorer for Go, Rust, Python and Node: auto-detection, framework groups, per-test status, run all/file/test, streamed output with command header, cancel, and gutter markers that run a test on click |
| Tasks | Build/run task runner: `.kodra/tasks.json`, `package.json` scripts (nested, package-manager aware) and `Makefile` targets, default build task plus `Ctrl+Alt+B`, streamed output in the bottom panel, stop, per-row status |
| Formatting | Prettier, gofmt, rustfmt and Black format the buffer before it is written (`Format on save`), format on demand (`Shift+Alt+F`), and a workspace-local install wins over `PATH`; languages without an external formatter fall back to the language server; ESLint and Ruff lint after saving into the Problems panel |
| Docker | Containers/images tabs, start/stop/restart, logs, run image |
| Network | Live request log (AI calls, browser fetches, update checks) in the bottom panel |
| Updater | Feed check over HTTPS, SHA-256-verified download to temp, installer confined to the update folder, launch installer, reveal in Explorer (see `docs/updater.md`) |
| Extensions | Declarative extension folders (`extension.json`) contribute colour themes and snippets; install from a folder, enable/disable, remove |
| Themes | Six built-in palettes (Kodra Dark/Light, Midnight, Graphite, Sand, Violet) plus extension themes; a theme restyles the shell, the editor syntax palette and the terminal |
| Shell | Theme picker with live preview, accent colours, font size, tab size, word wrap, session restore, command palette, keybindings |

## Stack

- **Frontend** — Nuxt 3 (`ssr: false`, static output), Vue 3 `<script setup>`, CodeMirror 6, xterm.js
- **Backend** — Tauri v2, Rust, `portable-pty`, `reqwest` (SSE streaming), `rusqlite` (bundled SQLite), `tokio`
- **State** — Nuxt `useState` for UI state, `localStorage` for chat history/session/layout, JSON settings file in the OS config dir

## Getting started

Prerequisites: Node.js 22+, pnpm 9, Rust stable with the MSVC toolchain, and Visual Studio Build
Tools with the C++ workload and Windows SDK.

```bash
pnpm install
pnpm dev          # browser-only preview; backend calls are mocked (app/lib/mock.ts)
pnpm desktop      # real Tauri window with the Rust backend
pnpm typecheck    # vue-tsc over the frontend
pnpm test:rust    # Rust unit tests (updater, migration)
pnpm build        # static frontend build -> .output/public
pnpm desktop:build # production installer (NSIS)
pnpm release:win  # build + hash + update manifest in release/
pnpm icons        # regenerate the icon set from scripts/make-icons.ps1
```

A step-by-step setup and run guide (in Indonesian, covering prerequisites, toolchains and
troubleshooting) lives in [`docs/running.md`](docs/running.md); the [Documentation](#documentation)
table above links the rest.

Language servers are discovered from `PATH`; install the one for your language
(for example `rustup component add rust-analyzer`, or
`go install golang.org/x/tools/gopls@latest`). `Settings → Editor → Language servers` lists
what was found and lets you disable a server for the session.

Debug adapters are discovered the same way. Install Delve with
`go install github.com/go-delve/delve/cmd/dlv@latest`, or put `codelldb` / `lldb-dap` on `PATH`;
`Settings` lists what was detected and the Debug pane lets you override the command.

`pnpm dev` runs entirely in the browser: `app/lib/mock.ts` provides a virtual workspace and canned
responses for every backend command, so the UI can be developed without the Tauri shell.

Settings are stored as JSON in the Tauri config directory (`Settings → About → Config directory`;
`%APPDATA%\app.kodra.desktop` on Windows). Chat history and canvas boards are kept in
`localStorage` per workspace.

## Project layout

```
app/
  app.vue                 shell: title bar, sidebar, editor, agent panel, status bar
  components/             editor, terminal, panes, overlays (design canvas, whiteboard), settings
  composables/            useIde, useChat, useDesign, useGit, useDatabase, useMcp, useBrowser, ...
  lib/                    typed IPC bridge (api.ts), mock backend, design model and operations, markdown, types
src-tauri/
  src/commands/           one module per feature area (pty, workspace, git, ai, db, mcp, lsp, dap, docker, ...)
  src/state.rs            AppState, persisted Settings, session structs
  src/util.rs             workspace path resolution/sandboxing helpers
```

## Backend command groups

`workspace` · `pty` · `exec` · `git` · `ai` · `checkpoint` · `settings` · `db` · `browser` · `mcp` · `lsp` ·
`dap` · `docker` · `skills` · `extensions` · `updater` · `netlog` · `tests` · `tasks` · `format`. All commands are
registered in `src-tauri/src/lib.rs`.

## Agent safety model

- File writes and shell commands require approval through an inline card in the chat panel
  (`autoApprove` in Settings → Agent skips this). Design edits through `write_design` use the same
  card, and the canvas keeps its own undo stack for them.
- Backend file tools resolve every path through `util::resolve_in_workspace`, which rejects `..`
  traversal and symlinks that escape the workspace.
- `run_command` is sandboxed to the workspace directory, uses a 120 s timeout and is killed when
  Kodra exits.
- Before an agent write, `checkpoint_snapshot` copies the file into
  `<app config>/checkpoints/<workspace>/<id>/` (outside the project, so it never shows up in git).
  Files that did not exist yet are recorded as absent. **Restore** in the chat card or the Agent
  pane replays the snapshot in reverse: files get their old contents back and files the agent
  created are deleted. The latest 40 checkpoints per workspace are kept, older ones are pruned.

## Search and replace

`Ctrl+Shift+F` opens project-wide search. Queries are literal by default; the toolbar toggles
**match case**, **whole word** and **regular expression**. Regex queries use the Rust `regex`
syntax and the literal mode escapes punctuation, so searching for `foo.bar` never matches `fooXbar`.

The arrow in the search header reveals the replace field. **Replace all** first asks the backend for
a dry run, shows how many matches and files would change, and only writes after you confirm. Files
are rewritten atomically and only when they are valid UTF-8 and under 2 MB; binary files and build
folders are skipped. Open editor tabs are reloaded from disk after the write, and the action is
refused while an affected tab has unsaved edits so those changes can never be lost. One run is
capped at 20,000 matches. In regex mode `$1` expands capture groups; literal mode treats the
replacement as text.

## Split editor

`Ctrl+\` splits the editor into two side-by-side panes. The focused file is duplicated into the new
pane; after that each pane keeps its own tab strip, active file and scroll position. Opening a file
that is already visible focuses the pane that owns it, and dragging a tab onto the other pane moves
it there instead of opening a second copy. Drag the divider to change the split ratio; it is
remembered across restarts.

`Ctrl+\` again (or the pane toolbar button) merges the side pane back into the main pane without
losing its tabs. The palette adds **View: Split Editor**, **View: Close Split** and **View: Move
Editor to Other Pane**. Layout and both tab strips are restored with the session.

## Debugger

The **Run and Debug** view (`F5`) speaks the Debug Adapter Protocol to a stdio adapter. Delve is the
default for Go (`dlv dap`), with CodeLLDB, `lldb-dap` and a **custom** adapter (raw launch JSON) for
anything else. Adapters are detected on `PATH`; the pane shows the detected path and lets you point
at a different command. Program, arguments, working directory, stop-on-entry and launch/attach are
saved per workspace in `localStorage`. **Attach** reads the process id from the Program field — Delve
gets `{ mode: "local", processId }`, the native adapters get `{ pid }` — and Kodra refuses a
non-numeric PID before creating a session. Stopping an attach session asks the adapter to detach
instead of terminating the target; adapters still decide the outcome (Delve on Windows ends the
process it is attached to).

- **Breakpoints** — click the gutter or press `F9`; the dot turns hollow until the adapter verifies
  it. The pane lists every breakpoint with enable/disable, a condition (`i == 3`) and remove.
- **Stopping** — the pane and the floating editor toolbar show the reason and the top frame; the
  paused line is highlighted and scrolled into view. `F10` steps over, `F11` into, `Shift+F11` out,
  `F5` continues, `Shift+F5` stops, and **Restart** relaunches the session.
- **Inspection** — call stack frames open their file at the right line, scopes expand lazily through
  `variablesReference`, and watch expressions are evaluated in the selected frame with `evaluate`.
- **Console** — adapter output (`output` events and stderr) and lifecycle messages land in the
  Debug Console with stderr highlighted.
- **Commands** — the palette adds `Debug: Start / Continue`, `Stop`, `Pause`, `Restart`, `Step
  Over`, `Step Into`, `Step Out`, `Toggle Breakpoint` and `Remove All Breakpoints`.

The Rust side (`src-tauri/src/commands/dap.rs`) speaks DAP over stdio for CodeLLDB and `lldb-dap`, and
over TCP for Delve, which prints `DAP server listening at: 127.0.0.1:<port>` instead of using stdio.
It frames messages, correlates responses by sequence, forwards every event as `dap:event`, answers
reverse requests such as `runInTerminal` with a refusal so the adapter falls back to its own console,
relays the Go debuggee's stdout into the Debug Console, and kills the adapter when the session is
stopped or the workspace changes.

## Tests

The **Tests** view auto-detects test files after a workspace opens and groups them by framework and
package: Go (`func TestXxx`), Rust (`#[test]` / `#[tokio::test]`), Python (`test_*.py` and
`def test_*`) and Node (`*.test.*` / `*.spec.*`). Each file expands to its tests, and the row shows a
running, passed or failed marker as results stream in.

- **Run** — the header runs every detected package, the file row runs one file, and the play button
  on a test row runs only that test. `Ctrl+Shift+R` runs everything; while a run is active the button
  becomes **Cancel**, which kills the whole process tree.
- **Output** — the bottom panel's **Tests** tab shows the exact command, its working directory and
  the runner's own verbose output. The header chip reports `All tests passed`, `N test(s) failed`,
  `Test run cancelled` or `Running tests…` plus the duration, and the status bar mirrors it.
- **Gutter** — detected tests get a small dot in the editor next to the breakpoints; click it to run
  that test. The dot turns green, red or amber with the latest status.
- **Commands** — the palette adds `Test: Show Test Explorer`, `Run All Tests`, `Run Tests in Active
  File`, `Cancel Test Run` and `Refresh Test Explorer`.

Runs are planned in Rust (`src-tauri/src/commands/tests.rs`) and executed one request at a time, so
a run-all is a queue of package runs rather than a single shell. Go uses `go test -v -count=1` with
`./...` for a package and `. -run ^Name$` for a single test, Rust uses `cargo test --color never`
(plus `-- --exact` when filtering), Python uses `python -m pytest -v`, and Node uses the package
manager's `test` script, forwarding a file path only when a Jest or Vitest config exists. A missing
runner is reported in the pane before anything is spawned. Output is capped and a workspace switch
stops any run in flight.

## Tasks

The **Tasks** view collects everything Kodra can build or run in the open workspace from three
sources, grouped in that order:

- **`.kodra/tasks.json`** — a declarative manifest: `{ "tasks": [{ "label": "Build", "command": "go build ./...", "cwd": "cmd/api", "group": "build", "isDefault": true }] }`.
  Labels are free text; `group` is `build`, `test` or omitted.
- **`package.json` scripts** — every script of the root manifest and of nested manifests up to four
  folders deep (dependencies and build output are skipped). Nested scripts are labelled
  `sub: build`, and the package manager is picked from the nearest lockfile (`pnpm`, `yarn`,
  `bun`, otherwise `npm`).
- **`Makefile` targets** — the targets of the root `Makefile`/`makefile`/`GNUmakefile`, with
  variable assignments and `.PHONY` lines filtered out.

**Run build task** (the play button, `Ctrl+Alt+B`, or the palette's `Task: Run Build Task`) runs the
single default task: the manifest task marked `"isDefault": true`, otherwise the root package
`build` script, otherwise the `build` make target. Any row also runs on its own, and a row that
already ran keeps its last status dot (running, passed, failed, cancelled).

- **Output** — the bottom panel's **Tasks** tab streams stdout/stderr of the selected run, shows the
  exact command and its working directory, and ends with a chip: `Task finished`, `Task failed` or
  `Task cancelled` plus the duration. The status bar mirrors the last run.
- **Stop** — the pane's stop button and the output header's **Stop** kill the whole process tree;
  switching workspaces also stops anything in flight.
- **Commands** — the palette adds `Task: Show Task Explorer`, `Run Build Task`, `Run Last Task`,
  `Stop Running Task` and `Refresh Task Explorer`.

Detection and execution live in `src-tauri/src/commands/tasks.rs`. Commands are re-validated in Rust
before they run: the `cwd` must resolve inside the workspace and the command line is capped at
4000 characters. Runs use `cmd /D /C <command>` on Windows and `sh -lc <command>` elsewhere, with
output capped at 4000 lines in the UI. When a needed tool is not on `PATH` (for example `make`), the
pane says so before you press play.

## Formatting and linting

Kodra runs the formatters and linters you already have, without bundling any:

| Tool | Kind | Languages | Install |
| --- | --- | --- | --- |
| Prettier | formatter | JS/TS/Vue, JSON, CSS, HTML, Markdown, YAML | `npm install -D prettier` |
| gofmt | formatter | Go | ships with Go |
| rustfmt | formatter | Rust | `rustup component add rustfmt` |
| Black | formatter | Python | `pip install black` |
| ESLint | linter | JS/TS/Vue | `npm install -D eslint` |
| Ruff | linter | Python | `pip install ruff` |

A workspace-local install wins: `node_modules/prettier/bin/prettier.cjs` (or
`bin-prettier.js`) and `node_modules/eslint/bin/eslint.js` are spawned through Node, so the version
pinned by the project is the one that runs. Otherwise Kodra falls back to `PATH`, and Python
formatters are also found through `python -m` when the module is installed but the script is not.
`Settings → Editor` lists every tool with `workspace` or `path` scope and shows the install command
for the ones that are missing.

- **Format on save** (Settings → Editor, or the palette) formats the **in-memory buffer** first and
  then writes the result, so a formatter error never blocks the save: the file is written unchanged
  and a `Format failed: …` toast explains why. A successful format reports
  `Saved x.go · formatted with gofmt`.
- **Format Document** (`Shift+Alt+F`) formats the active buffer without saving it, so you can review
  the diff and undo it.
- **Language-server fallback** — when none of the tools above covers the language, Kodra sends
  `textDocument/formatting` to the running language server (Dart uses this path) and applies the
  returned edits. The toast names the server, e.g. `Formatted with dart language server`.
- **Lint on save** runs ESLint or Ruff on the saved text and merges the result into the **Problems**
  panel and the editor squiggles, next to any language server diagnostics. Lint never blocks a save.
  The status bar chip sums language server and linter counts.
- **Commands** — the palette adds `Format: Format Document`, `Lint Active File`, `Toggle Format On
  Save`, `Toggle Lint On Save` and `Refresh Formatter Toolchain`.

Formatting and linting live in `src-tauri/src/commands/format.rs`. Every tool runs with the
workspace root as its working directory (so ESLint finds `eslint.config.js`), stdin carries the
buffer, and a 20-second watchdog kills the whole process tree if a tool hangs. Buffers over 2 MiB
are refused. Only JSON output is parsed: ESLint's `--format json` and
`ruff check --output-format json`; unparseable output is surfaced verbatim instead of being guessed
at.

## Code intelligence

Kodra starts a language server per language (see the feature table) and speaks the standard
Language Server Protocol for the code-aware features:

- **Rename Symbol** (`F2`) asks `textDocument/prepareRename` for the range and suggested name, shows
  a small input dialog, then applies the returned `WorkspaceEdit`. Open files are edited in their
  buffer and stay dirty; files that are not open are written directly. Every touched file is
  reported in the toast.
- **Find All References** (`Shift+F12`) lists `textDocument/references` results with the file, line
  and a preview of the source line. Pick a row to jump to it.
- **Go to Symbol in File** (`Ctrl+Shift+O`) flattens `textDocument/documentSymbol` (both the
  hierarchical and flat response shapes) into a filterable outline with nesting depth.
- **Quick Fix / Code Actions** (`Ctrl+.`) sends the diagnostics that cover the cursor with
  `textDocument/codeAction`, resolves actions through `codeAction/resolve` when needed, then applies
  the edit or runs `workspace/executeCommand`. Servers may also push `workspace/applyEdit`; Kodra
  applies that edit and answers the request so the server never blocks.
- **Semantic tokens** — `textDocument/semanticTokens/full` refines the syntax highlighting with the
  server's token legend, so class names, methods, parameters, properties and type parameters get the
  theme's syntax colours. The legend is read from the `initialize` result and an empty answer is
  retried while the server is still analysing.
- **Inlay hints** — `textDocument/inlayHint` draws inferred types and parameter names inline
  (`final Greeter greeter`, `print(object: …)`). Hints are decoration only: they are not part of the
  text, the undo history or the accessibility tree. Both features can be switched off under
  **Settings → Editor → Language server**.
- **Call hierarchy** — `Shift+Alt+H` (or `Code: Show Call Hierarchy (Callers)`) prepares the symbol
  at the cursor and queries `callHierarchy/incomingCalls`; the `Callees` command uses
  `callHierarchy/outgoingCalls`. Rows show the file that contains the call and jump to the call site.
- **Type hierarchy** — `Code: Show Type Hierarchy (Supertypes)` and `… (Subtypes)` walk
  `typeHierarchy/supertypes` and `typeHierarchy/subtypes`, with `· none` when the tree ends.
- **Commands** — all of these are in the palette (`Code: Rename Symbol`, `Code: Find All References`,
  `Code: Go to Symbol in File…`, `Code: Quick Fix / Code Actions`, `Code: Show Call Hierarchy
  (Callers/Callees)`, `Code: Show Type Hierarchy (Supertypes/Subtypes)`), plus `Code: Restart
  Language Servers` for a stuck server.

`WorkspaceEdit`s are applied in the frontend because LSP positions are UTF-16 code units, exactly
like JavaScript string indices. File create/rename/delete operations are not applied automatically;
they are counted as skipped instead. Navigating to a definition or reference may open a read-only
file outside the workspace (such as the Dart/Flutter SDK); writes and agent tools remain restricted
to the workspace.

Dart files use `dart language-server` (LSP by default). When Flutter is installed, Kodra resolves the
Dart SDK bundled with it (`<flutter>/bin/cache/dart-sdk`) so a Flutter project is analysed with the
same SDK version that `flutter` uses; otherwise it falls back to `dart` on `PATH`. `.dart` files are
highlighted with the Dart legacy mode, and other Flutter-adjacent files (`.kt`, `.java`, `.swift`,
`.gradle`, `.xml`, `.yaml`, `.arb` and C/C++ headers) get their own syntax highlighting too.

## Terminals

``Ctrl+` `` toggles the terminal panel and ``Ctrl+Shift+` `` opens another session. Every session is a real
PTY with its own xterm buffer, so a long-running process keeps going while you work in another tab.
The tab strip shows a status dot per session (running or exited); close a tab with its `×` to stop
only that shell. **Clear** wipes the active buffer and **New terminal** starts a session with the
shell chosen in Settings.

The chevron next to **+** lists the shells actually found on this machine (PowerShell 7, Windows
PowerShell, Command Prompt, WSL and Bash on Windows; bash/zsh/sh elsewhere) and marks the configured
default. Up to eight sessions can run at once. Switching workspaces terminates every PTY, because
Windows keeps the old working directory locked and that would otherwise block removing worktrees.

## Worktrees

Source Control → Worktrees lists every `git worktree` of the open repository. Creating one asks for
a branch and a folder outside the workspace: existing branches are checked out, new ones start at
the current HEAD. **Open** switches the workspace to that folder, **Remove** deletes the worktree
(keeping the branch; folders with uncommitted changes need a forced removal), and **Prune stale**
cleans up entries whose folder was deleted outside Kodra.

## Extensions and themes

Extensions are folders with an `extension.json` manifest. They are **declarative**: a manifest can
contribute colour themes and snippets, but never code, and nothing in it is executed. Install one
from the Extensions pane (**Install from folder**) or by copying the folder into
`<app config>/extensions/<name>/`. The enable switch is stored as `enabled` inside the manifest, and
**Remove** deletes the copied folder.

```json
{
  "id": "ember",
  "name": "Ember Studio",
  "version": "1.0.0",
  "themes": [
    {
      "id": "ember-dark",
      "name": "Ember Dark",
      "kind": "dark",
      "colors": { "surface0": "#120b08", "accent": "#ff8a3d" },
      "syntax": { "keyword": { "color": "#ff8a3d" }, "string": { "color": "#ffd28a" } },
      "terminal": { "background": "#1a0f0a" }
    }
  ],
  "snippets": [
    { "prefix": "log", "body": "console.log(${1:value})", "description": "Log a value" }
  ]
}
```

Themes are plain data (`app/lib/themes.ts`): a UI colour palette (`surface0`…`surface4`, `canvas`,
text tones, accent, status colours), a syntax palette for the editor and optional terminal
overrides. Anything omitted inherits from the built-in theme of the same `kind`, so a manifest only
needs to spell out what it changes. Picking a theme in **Settings → Appearance** previews it live,
and the choose action also adopts the theme's accent colour (the accent picker can still override
it).

Enabled themes appear in the Settings theme grid and can be selected like built-ins. Snippets show
up in the command palette as `Snippet: <prefix>`; running one inserts the expanded body (tab stops
resolved) into the active editor.

Manifests are capped at 512 KiB, installs at 400 files / 8 MiB, and at most 64 themes and 64
snippets are read per manifest. Symlinks are skipped, and a failed install removes its partial
copy. See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Development notes

- In dev builds `window.__kodraCall(command, args)` exposes the IPC bridge so the real backend can be
  scripted over the WebView2 DevTools protocol. Start the app with remote debugging enabled
  (`$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9223'; pnpm desktop`) and
  connect to `http://127.0.0.1:9223`. `window.__kodraOpenFolder(path)` runs the normal folder-switch
  path (used by the terminal teardown test, since the native picker cannot be scripted).
- The updater's installer step is the only action that executes a downloaded binary; it always
  requires a manual click on **Install**.

## Project status

Kodra 1.x targets **Windows x64** only. The feature set is frozen: releases focus on bug fixes,
security and polish. macOS and Linux builds are not shipped and untested.

## Verifying a release

Every release ships a `checksums.txt` and a `latest.json` containing the installer's SHA-256.

```powershell
Get-FileHash .\Kodra_*_x64-setup.exe -Algorithm SHA256
Get-AuthenticodeSignature .\Kodra_*_x64-setup.exe   # Valid once signing is configured
```

Until a code-signing certificate is configured the installer is unsigned, so SmartScreen warnings
are expected. The update path still requires a matching SHA-256 before anything is written to disk.

## Changelog

Release notes live in [CHANGELOG.md](CHANGELOG.md).

## Security and privacy

Kodra has no telemetry. It only reaches the network for features you use (AI provider, update check,
MCP servers, browser preview, git remotes). See [PRIVACY.md](PRIVACY.md) for what is stored locally
and what leaves the machine, and [SECURITY.md](SECURITY.md) for the threat model and how to report a
vulnerability privately.

## License

Kodra is proprietary software, free to download and use. Copyright © 2026 Kodra contributors, all
rights reserved. Redistribution and modification are not permitted. See [LICENSE](LICENSE) and
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
