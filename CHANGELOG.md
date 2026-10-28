# Changelog

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
