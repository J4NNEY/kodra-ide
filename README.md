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
| Workspace | Native folder picker, file tree with inline create/rename/delete, fuzzy search, project-wide grep |
| Source control | Git status, stage/unstage, commit, branch switch, history, diff preview |
| Agent | Streaming chat with OpenAI-compatible and Anthropic providers, tool calling (`list_dir`, `read_file`, `write_file`, `search_files`, `grep`, `run_command`, `read_skill`), inline approval cards, cancellation |
| Skills | Discovers `SKILL.md` bundles in `.kudo/skills`, `.claude/skills` and the user config dir; catalog injected into the agent prompt |
| Database | SQLite browser (tables, schema, paging), SQL console with history, CSV export via native save dialog |
| Browser | In-app preview overlay, address bar, request inspector run in Rust (no CORS), open in system browser |
| MCP | stdio JSON-RPC client, server presets, connect/disconnect, tool list and a tool runner |
| LSP | Generic client (Content-Length framing): start/stop, request/notify, document sync + completion |
| Docker | Containers/images tabs, start/stop/restart, logs, run image |
| Network | Live request log (AI calls, browser fetches, update checks) in the bottom panel |
| Updater | Feed check, download to temp, launch installer, reveal in Explorer (see `docs/updater.md`) |
| Shell | Dark/light themes, accent colours, font size, tab size, word wrap, session restore, command palette, keybindings |

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
pnpm exec vue-tsc --noEmit -p .nuxt/tsconfig.json   # typecheck
```

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

`workspace` · `pty` · `exec` · `git` · `ai` · `settings` · `db` · `browser` · `mcp` · `lsp` · `docker` ·
`skills` · `updater` · `netlog`. All commands are registered in `src-tauri/src/lib.rs`.

## Agent safety model

- File writes and shell commands require approval through an inline card in the chat panel
  (`autoApprove` in Settings → Agent skips this).
- Backend file tools resolve every path through `util::resolve_in_workspace`, which rejects `..`
  traversal and symlinks that escape the workspace.
- `run_command` is sandboxed to the workspace directory, uses a 120 s timeout and is killed when
  Kudo exits.

## Development notes

- In dev builds `window.__kudoCall(command, args)` exposes the IPC bridge so the real backend can be
  scripted over the WebView2 DevTools protocol. Start the app with remote debugging enabled
  (`$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9223'; pnpm desktop`) and
  connect to `http://127.0.0.1:9223`.
- The updater's installer step is the only action that executes a downloaded binary; it always
  requires a manual click on **Install**.

## License

Private project — not published.
