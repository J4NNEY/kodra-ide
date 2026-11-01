# Changelog

## 0.8.0 — 2026-11-01

Kudo can now discover, run and stop the workspace's build and run tasks.

- **Task explorer** — a new **Tasks** activity collects runnable tasks from three sources and groups
  them: a declarative `.kudo/tasks.json` manifest, `package.json` scripts (root plus nested manifests
  up to four folders deep, with the package manager chosen from the nearest lockfile and nested
  scripts labelled `sub: build`), and the root `Makefile`'s targets. The pane shows the command line
  next to every row and warns when a required tool (for example `make`) is not on `PATH`.
- **Run and stop** — each row runs on its own, the header play button runs the default build task
  (manifest `isDefault`, else the root package `build` script, else the `build` make target), and
  `Ctrl+Alt+B` does the same from anywhere. Rows keep a status dot (running, passed, failed,
  cancelled). **Stop** in the pane header or the output panel kills the whole process tree, and a
  workspace switch stops anything still running.
- **Output panel** — the **Tasks** tab streams stdout and stderr of the current run, keeps the exact
  command plus resolved working directory in the header, and ends with a `Task finished`,
  `Task failed` or `Task cancelled` chip with the duration. The status bar mirrors the last run.
- **Commands** — `Task: Show Task Explorer`, `Run Build Task`, `Run Last Task`, `Stop Running Task`
  and `Refresh Task Explorer`, plus an empty state that can create a starter `.kudo/tasks.json`.
- **Safety** — `task_run` re-validates the task in Rust: the command must be non-empty and at most
  4000 characters, and its `cwd` must resolve inside the workspace. Runs use the platform shell
  (`cmd /D /C` on Windows, `sh -lc` elsewhere) and the UI keeps the last 4000 output lines.

## 0.7.0 — 2026-10-31

Kudo can now discover and run the workspace's tests.

- **Test explorer** — a new **Tests** activity lists detected test files by framework and package:
  Go (`func TestXxx`), Rust (`#[test]` / `#[tokio::test]`), Python (`test_*.py`, `def test_*`) and
  Node (`*.test.*` / `*.spec.*`). Files expand into individual tests, and every row shows its latest
  status while a run streams in. The pane warns when the matching runner is not installed and can
  refresh detection on demand.
- **Runs** — run every package, a whole file, or one test. The header button turns into **Cancel**
  during a run and kills the entire process tree. Run-all executes one request per package,
  sequentially, so output stays attributable.
- **Output panel** — the **Tests** tab prints the exact command and working directory before the
  runner's verbose output. The chip reports `All tests passed`, `N test(s) failed`,
  `Test run cancelled` or `Running tests…` with the duration, and the status bar carries the same
  state. Output is capped and clears per run.
- **Gutter markers** — detected test lines get a dot in a dedicated gutter next to the breakpoints.
  Clicking a dot runs that single test and the dot is coloured by its status (green, red, amber).
- **Commands** — `Test: Show Test Explorer`, `Run All Tests` (`Ctrl+Shift+R`), `Run Tests in Active
  File`, `Cancel Test Run` and `Refresh Test Explorer`.
- **Runners** — `go test -v -count=1` (`./...` per package, `. -run ^Name$` for one test),
  `cargo test --color never` (`-- --exact` when filtered), `python -m pytest -v`, and the package
  manager's `test` script for Node, which only forwards a file path when a Jest or Vitest config
  exists. Runners are looked up on `PATH` in Rust and spawned with a tree-killing cancel path.

## 0.6.0 — 2026-10-29

Kudo can now debug programs through the Debug Adapter Protocol.

- **Debug view** — a new **Run and Debug** activity (`F5`, palette `View: Run and Debug`) with launch
  configurations for Delve (`dlv dap`), CodeLLDB, `lldb-dap` and a custom stdio adapter that takes
  raw launch JSON. Program, arguments, working directory, launch/attach and stop-on-entry persist per
  workspace; detected adapters are listed with their `PATH` location. Attach mode takes the process
  id from the Program field, validates it before starting and asks the adapter to detach on stop.
- **Breakpoints in the gutter** — click next to a line or press `F9` to toggle. Dots are hollow until
  the adapter verifies them; the pane can disable, remove, clear or attach a condition to any
  breakpoint, and breakpoints survive restarts with the workspace.
- **Paused state** — the highlighted line scrolls into view, a floating toolbar shows the current
  frame, and the call stack, scopes and variables are loaded from the adapter. Scopes and compound
  values expand lazily.
- **Actions** — `F5` continue, `Shift+F5` stop, `F10` step over, `F11` step into, `Shift+F11` step
  out, plus pause and restart from the toolbar, pane and palette.
- **Watch and console** — expressions are evaluated in the selected frame; adapter output and stderr
  are streamed into the Debug Console.
- **Transport** — DAP is framed over the adapter's stdin/stdout (CodeLLDB, `lldb-dap`, custom) or,
  for Delve, over the TCP socket announced on stdout by `dlv dap`. Responses are correlated by
  sequence, events are forwarded as `dap:event`, `runInTerminal` is refused so adapters use their own
  console, the Go debuggee's stdout is relayed into the Debug Console, and the adapter is killed on
  stop or workspace switch (Delve's debug binaries are cleaned up with it).

## 0.5.0 — 2026-10-28

Editors can now be split into two panes.

- **Independent panes** — `Ctrl+\` opens a second editor pane with its own tab strip, active file
  and scroll position. Each pane shows the conventional breadcrumbs and dirty indicators.
- **Drag tabs between panes** — dropping a tab on the other pane moves it instead of creating a
  duplicate. Opening a file that is already open focuses the pane that owns it; the focused pane
  receives new files, so every action (explorer, quick open, go-to-definition) lands where the user
  is working.
- **Resizable divider** — drag the vertical divider to adjust the split; the ratio persists in
  `localStorage`. `Ctrl+\` or the pane toolbar button closes the split and merges the side tabs back
  into the main pane.
- **Commands** — `View: Split Editor`, `View: Close Split` and `View: Move Editor to Other Pane` are
  available from the palette.
- **Session restore** — pane membership and each pane's active tab are stored with the rest of the
  session and restored on launch.
- **LSP** — document references are counted per editor view, so closing one of two panes showing the
  same file no longer sends `didClose` while the other view still needs diagnostics.

## 0.4.0 — 2026-10-28

Terminal sessions are now independent, tabbed PTYs.

- **Multiple sessions** — every tab owns its own xterm instance and PTY, so two shells can run
  simultaneous commands without sharing output or scrollback. Up to eight sessions are allowed.
- **Session tabs** — switch between shells without restarting them; each tab shows a running/exited
  dot and a close button that stops only that PTY. Closing the last tab leaves an empty state with a
  one-click **New terminal** action.
- **Shell picker** — `terminal_shells` detects PowerShell 7, Windows PowerShell, Command Prompt, WSL
  and Bash (bash/zsh/sh elsewhere), labels them and flags the configured default. The chevron next to
  **+** starts a session with any detected shell; Settings reuses the same list instead of a
  hard-coded array.
- **Safe teardown** — `pty_kill_all` runs whenever the workspace changes or the panel unmounts, so
  every shell (and its children) is terminated before folders are released.
- **Commands** — `Terminal: New Session` opens an additional tab and
  `Terminal: Close Active Session` stops the current one from the palette.

## 0.3.0 — 2026-10-28

Workspace-wide search and replace.

- **Search options** — `search_in_files` gained whole-word and regular-expression flags on top of
  match case. Literal queries are escaped, so `foo.bar` does not behave like a regex. Regex errors
  are reported inline in the Search pane as you type (no toast per keystroke), and match columns are
  counted in characters, not bytes.
- **Replace all** — `replace_in_files` previews a workspace-wide replacement (`dryRun`) and reports
  the match count, the changed files and the first matching lines. Confirming rewrites files
  atomically, preserving their permissions and only touching valid UTF-8 text files.
- **Open tabs** — clean editor tabs are reloaded from disk after a replace; tabs with unsaved edits
  block the action with a message instead of being overwritten.
- **Limits** — one replace action is capped at 20,000 matches, and the preview lists at most 40
  line numbers per file. Binary files, files over 2 MB and build folders (`.git`, `node_modules`,
  `target`, `dist`, …) are skipped.
- **Browser mock** — the in-browser workspace mirrors the same matcher, preview and replacement
  semantics for `pnpm dev`.

## 0.2.0 — 2026-10-28

Extensions, themes, worktrees, checkpoints and language servers land in one release.

- **Extensions** — declarative folders with an `extension.json` manifest contribute colour themes
  and snippets. Install from a folder, enable/disable, and remove from the Extensions pane. Nothing
  in a manifest is executed.
- **Themes** — six built-in palettes (Kudo Dark/Light, Midnight, Graphite, Sand, Violet) plus
  extension themes, with live preview in Settings. A theme drives the shell tokens, the CodeMirror
  syntax palette and the xterm colours; missing values inherit from the built-in theme of the same
  kind.
- **Snippets** — enabled snippets appear in the command palette and insert their expanded body into
  the active editor.
- **Worktrees** — list, create on a new branch, open, remove and prune Git worktrees from Source
  Control. Terminal PTYs are torn down on workspace switch so Windows releases folder locks.
- **Checkpoints** — agent file writes snapshot the previous contents outside the workspace; a
  Restore card in chat (and the Agent pane) replays changes in reverse.
- **Language servers** — rust-analyzer, gopls, TypeScript, Pyright and JSON/CSS/HTML servers on
  `PATH`: completion, hover, go-to-definition, diagnostics and a Problems panel.
- **Hardening** — extension manifests are size-checked before reading (512 KiB), contributions are
  capped at 64 per kind, installs are limited to 400 files / 8 MiB and clean up after a failed copy.
  The About card and updater now show the running version instead of a hard-coded baseline.

## 0.1.0

First functional build: CodeMirror editor, PTY terminal, Git status/stage/commit, streaming agent
chat with tool approvals, SQLite browser and SQL console, in-app browser, MCP servers, Docker pane,
network log and the update feed.
