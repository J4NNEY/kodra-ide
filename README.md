# Kudo

A desktop IDE for code, terminals, databases and AI agents — built with **Tauri v2 + Nuxt 3 + Rust**.

Kudo is a clean-room implementation inspired by the layout and workflow of [Sokudo](https://sokudo.dev).
No Sokudo source, assets or compiled frontend code are reused; the design tokens were reproduced from
public screenshots and the UI is written from scratch.

## Features

| Area | What works |
| --- | --- |
| Editor | CodeMirror 6, syntax highlighting for 20+ languages, tabs, dirty state, quick open (`Ctrl+P`), go to line, find/replace in file |
| Terminal | Real PTY (`portable-pty`), xterm.js, resizable panel, shells from settings (PowerShell by default on Windows) |
| Workspace | Native folder picker, file tree with inline create/rename/delete, fuzzy search, project-wide search with case/whole-word/regex toggles, previewed replace-all |
| Source control | Git status, stage/unstage, commit, branch switch, history, diff preview, and worktrees (list, create on a new branch, open, remove, prune stale) |
| Agent | Streaming chat with OpenAI-compatible and Anthropic providers, tool calling (`list_dir`, `read_file`, `write_file`, `search_files`, `grep`, `run_command`, `read_skill`), inline approval cards, cancellation |
| Checkpoints | Every agent file write snapshots the previous contents first; chat replies show a Restore card with the touched files and the Agent pane lists recent changes |
| Skills | Discovers `SKILL.md` bundles in `.kudo/skills`, `.claude/skills` and the user config dir; catalog injected into the agent prompt |
| Database | SQLite browser (tables, schema, paging), SQL console with history, CSV export via native save dialog |
| Browser | In-app preview overlay, address bar, request inspector run in Rust (no CORS), open in system browser |
| MCP | stdio JSON-RPC client, server presets, connect/disconnect, tool list and a tool runner |
| LSP | Language servers on PATH (rust-analyzer, gopls, TypeScript, Pyright, JSON/CSS/HTML) start per language; completion, hover docs, go-to-definition (`F12`/`Ctrl+click`), diagnostics as squiggles plus a Problems panel and status-bar counts |
| Docker | Containers/images tabs, start/stop/restart, logs, run image |
| Network | Live request log (AI calls, browser fetches, update checks) in the bottom panel |
| Updater | Feed check, download to temp, launch installer, reveal in Explorer (see `docs/updater.md`) |
| Extensions | Declarative extension folders (`extension.json`) contribute colour themes and snippets; install from a folder, enable/disable, remove |
| Themes | Six built-in palettes (Kudo Dark/Light, Midnight, Graphite, Sand, Violet) plus extension themes; a theme restyles the shell, the editor syntax palette and the terminal |
| Shell | Theme picker with live preview, accent colours, font size, tab size, word wrap, session restore, command palette, keybindings |

## Stack

- **Frontend** — Nuxt 3 (`ssr: false`, static output), Vue 3 `<script setup>`, CodeMirror 6, xterm.js
- **Backend** — Tauri v2, Rust, `portable-pty`, `reqwest` (SSE streaming), `rusqlite` (bundled SQLite), `tokio`
- **State** — Nuxt `useState` for UI state, `localStorage` for chat history/session/layout, JSON settings file in the OS config dir

## Getting started

```bash
pnpm install
pnpm dev          # browser-only preview; backend calls are mocked (app/lib/mock.ts)
pnpm desktop      # real Tauri window with the Rust backend
pnpm build        # static frontend build -> .output/public
pnpm desktop:build # production installer (NSIS)
pnpm exec vue-tsc --noEmit -p tsconfig.json   # typecheck (excludes src-tauri build output)
```

Language servers are discovered from `PATH`; install the one for your language
(for example `rustup component add rust-analyzer`, or
`go install golang.org/x/tools/gopls@latest`). `Settings → Editor → Language servers` lists
what was found and lets you disable a server for the session.

`pnpm dev` runs entirely in the browser: `app/lib/mock.ts` provides a virtual workspace and canned
responses for every backend command, so the UI can be developed without the Tauri shell.

Settings are stored as JSON in the Tauri config directory (`Settings → About → Config directory`).
Chat history is kept in `localStorage` per workspace.

## Project layout

```
app/
  app.vue                 shell: title bar, sidebar, editor, agent panel, status bar
  components/             editor, terminal, panes, overlays, settings
  composables/            useIde, useChat, useGit, useDatabase, useMcp, useBrowser, ...
  lib/                    typed IPC bridge (api.ts), mock backend, markdown, types
src-tauri/
  src/commands/           one module per feature area (pty, workspace, git, ai, db, mcp, lsp, docker, ...)
  src/state.rs            AppState, persisted Settings, session structs
  src/util.rs             workspace path resolution/sandboxing helpers
```

## Backend command groups

`workspace` · `pty` · `exec` · `git` · `ai` · `checkpoint` · `settings` · `db` · `browser` · `mcp` · `lsp` ·
`docker` · `skills` · `extensions` · `updater` · `netlog`. All commands are registered in
`src-tauri/src/lib.rs`.

## Agent safety model

- File writes and shell commands require approval through an inline card in the chat panel
  (`autoApprove` in Settings → Agent skips this).
- Backend file tools resolve every path through `util::resolve_in_workspace`, which rejects `..`
  traversal and symlinks that escape the workspace.
- `run_command` is sandboxed to the workspace directory, uses a 120 s timeout and is killed when
  Kudo exits.
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

## Worktrees

Source Control → Worktrees lists every `git worktree` of the open repository. Creating one asks for
a branch and a folder outside the workspace: existing branches are checked out, new ones start at
the current HEAD. **Open** switches the workspace to that folder, **Remove** deletes the worktree
(keeping the branch; folders with uncommitted changes need a forced removal), and **Prune stale**
cleans up entries whose folder was deleted outside Kudo.

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

- In dev builds `window.__kudoCall(command, args)` exposes the IPC bridge so the real backend can be
  scripted over the WebView2 DevTools protocol. Start the app with remote debugging enabled
  (`$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9223'; pnpm desktop`) and
  connect to `http://127.0.0.1:9223`.
- The updater's installer step is the only action that executes a downloaded binary; it always
  requires a manual click on **Install**.

## Changelog

Release notes live in [CHANGELOG.md](CHANGELOG.md).

## License

Private project — not published.
