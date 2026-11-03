# Changelog

## 1.0.0 — 2026-11-03

The first public release. Kodra is the new name for the app formerly called Kudo.

- **Rename and migration** — the product, crate, binary, bundle identifier (`app.kodra.desktop`) and
  user-visible strings are now Kodra. On first launch, settings, checkpoints and extensions are
  copied from the old `dev.kudo.desktop` folder without deleting it, `localStorage` keys move from
  `kudo:*` to `kodra:*`, and `.kudo/skills` / `.kudo/tasks.json` keep working when no `.kodra`
  folder exists. New projects use `.kodra`.
- **Windows installer** — per-user NSIS install with English and Indonesian UI, publisher and
  copyright metadata, a new full icon set (16–256 px ICO), and an optional `signCommand` pipeline
  ready for a code-signing certificate.
- **Hardened updater** — feeds must use HTTPS (localhost is the only plain-HTTP exception), every
  download needs a 64-hex SHA-256 that is checked before anything is written, downloads are capped at
  300 MB, file names are reduced to their final path component, and installers are only launched from
  `<temp>\kodra-updates` and only for `.exe`/`.msi`.
- **Content Security Policy** — the webview now runs with an explicit CSP instead of `csp: null`,
  while still allowing remote images, browser-preview frames and MCP/localhost connections.
- **Release infrastructure** — GitHub Actions CI (typecheck, Rust tests, clippy, frontend build) and
  a tag-driven Windows release workflow, `pnpm release:win` for a hashed installer plus
  `latest.json`, and unit tests for version comparison, URL policy, file-name sanitising, checksum
  verification and legacy-data migration.
- **Documentation and legal** — public README, `docs/releasing.md`, rewritten `docs/updater.md`,
  `SECURITY.md`, `PRIVACY.md` and a proprietary `LICENSE` with third-party notices.

Everything from 0.12.0 and 0.12.1 is included: semantic tokens, inlay hints, call/type hierarchy,
server-side formatting, workspace symbols, signature help, occurrence highlighting, auto-import
completions, and the browser-pane self-embedding fix.

## 0.12.1 — 2026-11-02

The in-app browser no longer embeds Kodra itself.

- **Browser start panel** — opening the pane without a URL (or with an empty *Browser preview
  home*) shows a short start panel instead of guessing `http://localhost:3000`. That guess embedded
  Kodra's own Nuxt dev server in the pane whenever the IDE ran from source.
- **Self-origin guard** — when the address resolves to the origin Kodra is served from, the pane
  explains the problem and offers **Open in system browser** instead of rendering a second IDE
  inside itself.
- **Last URL remembered** — the pane restores the last previewed URL from `localStorage`;
  **Reload** no longer rewrites the configured home, and **Set as home** is disabled until a
  non-self page is open.
- `Browser: Preview localhost:3000` is now **Browser: Preview Local URL…** and asks for the
  address, so it cannot hard-code Kodra's own port.
- The default *Browser preview home* is now empty; settings that still contain the old default
  (`http://localhost:3000`) are cleared when they load, so the start panel appears instead.

## 0.12.0 — 2026-11-02

Language servers now colour the buffer, annotate inferred types and answer hierarchy questions.

- **Semantic tokens** — the editor requests `textDocument/semanticTokens/full` and decorates the
  server's token ranges on top of the syntax tree, so classes, methods, parameters, properties and
  type parameters use the active theme's syntax colours. The server legend is read from
  `initialize`, and an empty answer is retried while analysis warms up.
- **Inlay hints** — inferred types and parameter names are drawn inline (`final Greeter greeter`,
  `print(object: …)`) without becoming part of the text, the undo history or the accessibility tree.
  Both features have their own switches under **Settings → Editor → Language server** and default to
  on.
- **Call hierarchy** — `Shift+Alt+H` (or `Code: Show Call Hierarchy (Callers)`) lists every caller of
  the symbol at the cursor; `Code: Show Call Hierarchy (Callees)` lists what it calls. Rows show the
  containing file and jump to the call site.
- **Type hierarchy** — `Code: Show Type Hierarchy (Supertypes)` and `… (Subtypes)` walk a class or
  interface up and down the inheritance tree; when there is nothing above or below the list says
  `· none`.
- **Formatting from the server** — `Shift+Alt+F` and **Format on save** now fall back to
  `textDocument/formatting` when no external formatter covers the language, so Dart files format
  without a separate toolchain. The toast names the server (`Formatted with dart language server`).
- The client advertises semantic-token, inlay-hint, call-hierarchy and type-hierarchy capabilities
  during `initialize`.

## 0.11.0 — 2026-11-02

Code intelligence now covers the whole workspace and shows more context at the cursor.

- **Workspace symbols** — `Ctrl+T` (or `Code: Go to Symbol in Workspace…`) opens a searchable list
  of every symbol the active language server knows about. The query is answered by the server as you
  type, SDK/dependency symbols outside the workspace are filtered out, and picking a row jumps to the
  declaration.
- **Signature help** — typing `(` or `,` in a call shows the parameter list in a popup with the
  active parameter highlighted and the server's documentation. The hint follows the cursor while the
  argument list stays open and closes as soon as it leaves.
- **Occurrence highlighting** — every read and write of the symbol under the cursor is decorated in
  the editor (writes are stronger), so a variable's uses are visible without selecting the word.
- **Auto-import completions** — completions now honour their `textEdit` replacement range and any
  `additionalTextEdits`. Dart defers auto-import edits to `completionItem/resolve`; Kodra resolves
  those candidates before the popup opens, so picking an unimported class inserts the class *and* its
  `import` in a single undo step.
- Servers that omit `textEdit`/`additionalTextEdits` and snippet completions keep working as before.

## 0.10.1 — 2026-11-02

Dart and Flutter projects are now first-class: `.dart` files are highlighted and get the full code
intelligence stack instead of falling back to plaintext.

- **Dart language server** — `dart language-server` is detected on `PATH` (or from the Flutter SDK's
  `bin/cache/dart-sdk`) and started per Dart file, so completion, hover, go-to-definition, rename,
  references, document symbols, quick fixes and diagnostics all work in Flutter apps and Dart
  packages.
- **Flutter SDK preference** — when `flutter` is installed, Kodra picks the Dart SDK bundled with it
  so analysis matches the SDK version the project builds with; standalone Dart is the fallback.
- **Dart + Flutter syntax** — added the Dart mode plus Kotlin, Java, Swift, XML, Groovy/Gradle,
  `.properties`, C/C++, C#, Ruby, Lua and Protocol Buffers to the editor language map, and `.arb`
  files are treated as JSON.
- **SDK navigation** — go-to-definition and reference jumps may open read-only files outside the
  workspace (for example Flutter's `binding.dart`), while writes and AI tools stay sandboxed to the
  workspace.
- **Status bar** — language names such as Dart, Go, Kotlin and C++ are spelled properly instead of
  showing the raw lowercase language id.

## 0.10.0 — 2026-11-02

Kodra's language servers now do more than complete and jump: they rename, find references, outline
the file and offer quick fixes.

- **Rename Symbol** — `F2` asks `textDocument/prepareRename` for the range and suggested name, shows
  a small dialog, then applies the returned `WorkspaceEdit`. Open tabs are edited in place and stay
  dirty; files that are not open are written directly, and the toast reports how many files changed.
- **Find All References** — `Shift+F12` lists `textDocument/references` with file, line/column and a
  preview of the source line. Picking a row jumps to that location.
- **Go to Symbol in File** — `Ctrl+Shift+O` turns `textDocument/documentSymbol` (hierarchical or flat)
  into a filterable outline with nesting depth; Enter jumps to the symbol.
- **Quick Fix / Code Actions** — `Ctrl+.` sends the diagnostics covering the cursor to
  `textDocument/codeAction`, resolves actions through `codeAction/resolve` when the server defers the
  edit, and then applies the edit or runs `workspace/executeCommand`.
- **Server-initiated edits** — the client now advertises `workspace.applyEdit`, forwards
  `workspace/applyEdit` requests to the frontend and answers them, so assists and organize-import
  actions that edit through the server work as well. Rename/documentSymbol/codeAction capabilities
  are advertised during `initialize`.
- **Commands** — `Code: Rename Symbol`, `Find All References`, `Go to Symbol in File…`,
  `Quick Fix / Code Actions` and `Restart Language Servers`.
- **Safety** — workspace edits are applied from the end of each file so earlier offsets stay valid;
  edits to files outside the workspace are skipped instead of guessed, and resource operations
  (create/rename/delete) are reported as skipped rather than executed.

## 0.9.0 — 2026-11-01

Kodra can now format the buffer before saving and lint it afterwards.

- **Format on save** — an opt-in setting that runs Prettier, gofmt, rustfmt or Black on the
  **in-memory buffer** and writes the result, so unsaved edits are formatted too. A formatter error
  never blocks the save: the file is written unchanged and a `Format failed: …` toast shows the
  tool's message. Successful saves report `Saved x.go · formatted with gofmt`.
- **Format Document** — `Shift+Alt+F`, also available as `Format: Format Document` in the palette,
  formats the active buffer without saving it, leaving the tab dirty so the change can be reviewed or
  undone. Plain text files answer `No formatter installed for this file type`.
- **Lint on save** — an opt-in setting that runs ESLint or Ruff on the saved text. Diagnostics are
  normalised to 1-based ranges with the rule id in their source (`eslint (no-unused-vars)`,
  `ruff (F401)`) and merged into the **Problems** panel, the editor squiggles and the status-bar
  counts, next to language server diagnostics. Linting never blocks a save.
- **Toolchain** — the six tools are detected per workspace: a local install under `node_modules`
  wins over `PATH` (`prettier`, `eslint` run through Node), Python tools also resolve through
  `python -m` when only the module is installed, and `Settings → Editor` lists each tool with its
  `workspace`/`path` scope or the install command when it is missing.
- **Commands** — `Format: Format Document`, `Lint Active File`, `Toggle Format On Save`,
  `Toggle Lint On Save` and `Refresh Formatter Toolchain`.
- **Safety** — tools run with the workspace root as their working directory (so project configs such
  as `eslint.config.js` apply), receive the buffer on stdin, and are killed with their whole process
  tree after 20 seconds. Buffers over 2 MiB are refused, only JSON output is parsed, and unparseable
  output is surfaced verbatim instead of being guessed at.

## 0.8.0 — 2026-11-01

Kodra can now discover, run and stop the workspace's build and run tasks.

- **Task explorer** — a new **Tasks** activity collects runnable tasks from three sources and groups
  them: a declarative `.kodra/tasks.json` manifest, `package.json` scripts (root plus nested manifests
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
  and `Refresh Task Explorer`, plus an empty state that can create a starter `.kodra/tasks.json`.
- **Safety** — `task_run` re-validates the task in Rust: the command must be non-empty and at most
  4000 characters, and its `cwd` must resolve inside the workspace. Runs use the platform shell
  (`cmd /D /C` on Windows, `sh -lc` elsewhere) and the UI keeps the last 4000 output lines.

## 0.7.0 — 2026-10-31

Kodra can now discover and run the workspace's tests.

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

Kodra can now debug programs through the Debug Adapter Protocol.

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
- **Themes** — six built-in palettes (Kodra Dark/Light, Midnight, Graphite, Sand, Violet) plus
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
