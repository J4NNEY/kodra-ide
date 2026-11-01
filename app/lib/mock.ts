import type {
  Branch,
  Commit,
  Entry,
  FilePayload,
  GitStatus,
  QuickFile,
  SearchHit,
  ReplaceChange,
  ReplaceOutcome,
  Settings,
  WorkspaceInfo
} from './types'

/**
 * In-browser fallback so the whole UI can be developed and demoed with `pnpm dev`
 * without building the Tauri shell. It implements a tiny virtual workspace.
 */
export const MOCK_ROOT = 'C:\\demo\\kudo-workspace'

type Node = { dir: boolean; text?: string }

const seed: Record<string, Node> = {
  'README.md': {
    dir: false,
    text: `# Kudo

A clean-room desktop IDE inspired by Sokudo, built with **Tauri v2 + Nuxt 3**.

## Features

- Workspace explorer with git decorations
- Code editor with multi-language highlighting
- Real PTY terminal
- Git panel: stage, commit, branch, pull/push
- AI coding agent with file + shell tools

> This file is served by the in-browser mock workspace. Run \`pnpm desktop\`
> to use the real Tauri backend.
`
  },
  'package.json': {
    dir: false,
    text: `{
  "name": "demo-app",
  "version": "0.2.0",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  }
}
`
  },
  'src/main.ts': {
    dir: false,
    text: `import { createApp } from 'vue'
import App from './App.vue'
import './styles/theme.css'

const app = createApp(App)

app.config.errorHandler = (err) => {
  console.error('[demo] unhandled error', err)
}

app.mount('#app')
`
  },
  'src/App.vue': {
    dir: false,
    text: `<script setup lang="ts">
import { ref } from 'vue'

const count = ref(0)
</script>

<template>
  <main class="shell">
    <h1>Demo workspace</h1>
    <button @click="count++">clicked {{ count }} times</button>
  </main>
</template>

<style scoped>
.shell {
  display: grid;
  place-items: center;
  height: 100vh;
}
</style>
`
  },
  'src/styles/theme.css': {
    dir: false,
    text: `:root {
  --surface-0: #0a0a0a;
  --surface-1: #0f0f0f;
  --surface-2: #141414;
  --text: #e4e4e7;
  --dim: #a1a1aa;
  --accent: #d4a73c;
}
`
  },
  'src/lib/search.ts': {
    dir: false,
    text: `export interface Hit {
  path: string
  line: number
  text: string
}

export function searchFiles(files: Record<string, string>, query: string): Hit[] {
  const out: Hit[] = []
  for (const [path, text] of Object.entries(files)) {
    text.split('\\n').forEach((line, i) => {
      if (line.toLowerCase().includes(query.toLowerCase())) {
        out.push({ path, line: i + 1, text: line.trim() })
      }
    })
  }
  return out
}
`
  },
  'docs/ARCHITECTURE.md': {
    dir: false,
    text: `# Architecture

\`\`\`
Nuxt 3 (SPA)  ──invoke──▶  Tauri (Rust)
     │                        ├── workspace / fs
     │                        ├── git (CLI)
     │                        ├── pty (portable-pty)
     │                        └── ai (SSE streaming)
\`\`\`

The renderer never touches the filesystem directly: every read or write is a
command that resolves the path inside the active workspace root.
`
  },
  'docs/ROADMAP.md': {
    dir: false,
    text: `# Roadmap

- [x] layout shell
- [x] explorer + editor
- [x] terminal
- [x] git panel
- [x] ai agent
- [ ] database manager
- [ ] in-app browser
- [ ] extension host
`
  },
  'scripts/dev.ps1': {
    dir: false,
    text: `param([switch]$Release)
$ErrorActionPreference = 'Stop'
if ($Release) { pnpm build } else { pnpm dev }
`
  }
}

const files = new Map<string, Node>(Object.entries(seed))
const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '')
const rel = (p: string) => {
  const value = norm(p)
  const root = norm(MOCK_ROOT)
  if (value.toLowerCase() === root.toLowerCase()) return ''
  return value.toLowerCase().startsWith(root.toLowerCase() + '\\')
    ? value.slice(root.length + 1)
    : value
}

/** Mirror the Rust matcher so the browser demo behaves the same way. */
function mockPattern(query: string, caseSensitive: boolean, wholeWord: boolean, isRegex: boolean) {
  if (!query.trim()) throw new Error('search query is empty')
  const source = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = wholeWord ? `\\b(?:${source})\\b` : source
  try {
    return new RegExp(pattern, caseSensitive ? 'g' : 'gi')
  } catch (err) {
    const message = String(err).replace(/^SyntaxError:\s*/, '')
    throw new Error(`invalid regular expression: ${message}`)
  }
}

export const mockWorkspace: WorkspaceInfo = {
  name: 'kudo-workspace',
  path: MOCK_ROOT,
  isGit: true,
  branch: 'main'
}

export function mockListDir(path: string): Entry[] {
  const prefix = rel(path)
  const seen = new Map<string, Entry>()
  for (const [key, node] of files) {
    if (prefix && !key.startsWith(prefix + '\\')) continue
    const rest = prefix ? key.slice(prefix.length + 1) : key
    const [head, ...tail] = rest.split('\\')
    if (!head) continue
    const child = prefix ? `${prefix}\\${head}` : head
    if (!seen.has(child)) {
      seen.set(child, {
        name: head,
        path: `${MOCK_ROOT}\\${child}`,
        isDir: tail.length > 0 || node.dir,
        size: tail.length ? 0 : (node.text?.length ?? 0),
        humanSize: tail.length ? '—' : `${((node.text?.length ?? 0) / 1024).toFixed(1)} KB`,
        modified: Date.now() / 1000 - 3600,
        ext: tail.length ? '' : head.split('.').pop() ?? '',
        hidden: head.startsWith('.')
      })
    }
  }
  return [...seen.values()].sort((a, b) =>
    a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
  )
}

const gitDirty = new Map<string, { index: string; worktree: string }>([
  ['src/main.ts', { index: ' ', worktree: 'M' }],
  ['docs/ROADMAP.md', { index: 'M', worktree: ' ' }],
  ['src/lib/search.ts', { index: '?', worktree: '?' }]
])

export function mockGitStatus(): GitStatus {
  const out = [...gitDirty.entries()].map(([p, s]) => ({
    path: `${MOCK_ROOT}\\${p}`,
    rel: p,
    index: s.index,
    worktree: s.worktree,
    staged: s.index !== ' ' && s.index !== '?',
    status: s.index === '?' ? 'untracked' : 'modified'
  }))
  return {
    branch: 'main',
    upstream: 'origin/main',
    ahead: 2,
    behind: 0,
    files: out,
    clean: out.length === 0
  }
}

const defaultSettings: Settings = {
  theme: 'dark',
  accent: '#d4a73c',
  fontFamily: 'JetBrains Mono, Cascadia Code, Consolas, monospace',
  fontSize: 13,
  tabSize: 2,
  wordWrap: false,
  minimap: true,
  terminalShell: 'powershell.exe',
  terminalFontSize: 12,
  restoreSession: true,
  formatOnSave: false,
  lintOnSave: false,
  ai: {
    provider: 'demo',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: '',
    temperature: 0.3,
    maxTokens: 4096,
    systemPrompt: "You are Kudo's coding agent.",
    agentMode: true,
    autoApprove: false
  },
  recentWorkspaces: [
    { name: 'kudo-workspace', path: MOCK_ROOT, lastOpened: Date.now() / 1000 }
  ],
  mcpServers: [],
  updateFeed: '',
  browserHome: 'http://localhost:3000'
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('kudo:settings')
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>
      return {
        ...defaultSettings,
        ...parsed,
        ai: { ...defaultSettings.ai, ...(parsed.ai ?? {}) }
      }
    }
  } catch {
    /* ignore */
  }
  return structuredClone(defaultSettings)
}

/* ------------------------------------------------------------------ mock db */

type MockTable = { columns: string[]; rows: (string | number | null)[][] }

const mockDb: Record<string, MockTable> = {
  users: {
    columns: ['id', 'email', 'name', 'plan', 'created_at'],
    rows: [
      [1, 'ada@kudo.dev', 'Ada Lovelace', 'pro', '2026-01-04 09:12:00'],
      [2, 'grace@kudo.dev', 'Grace Hopper', 'team', '2026-01-18 14:41:00'],
      [3, 'linus@kudo.dev', 'Linus Torvalds', 'free', '2026-02-02 08:05:00'],
      [4, 'margaret@kudo.dev', 'Margaret Hamilton', 'pro', '2026-02-21 19:33:00']
    ]
  },
  sessions: {
    columns: ['id', 'user_id', 'token', 'expires_at'],
    rows: [
      ['s_01', 1, 'tok_a1b2c3', '2026-11-01 00:00:00'],
      ['s_02', 2, 'tok_d4e5f6', '2026-11-03 00:00:00'],
      ['s_03', 2, 'tok_g7h8i9', '2026-11-04 00:00:00']
    ]
  },
  events: {
    columns: ['id', 'type', 'payload', 'created_at'],
    rows: [
      [1, 'workspace_open', '{"path":"C:\\\\demo\\\\kudo-workspace"}', '2026-10-27 08:00:01'],
      [2, 'agent_turn', '{"tokens":812,"tools":2}', '2026-10-27 08:02:11'],
      [3, 'file_save', '{"path":"src/main.ts"}', '2026-10-27 08:03:44'],
      [4, 'terminal_spawn', '{"shell":"powershell.exe"}', '2026-10-27 08:04:09']
    ]
  }
}

function dbResultFor(sql: string): {
  columns: string[]
  rows: (string | number | null)[][]
  affected: number
  lastInsertId: number
  durationMs: number
  truncated: boolean
} {
  const started = performance.now()
  const lower = sql.toLowerCase()
  const table = Object.keys(mockDb).find((name) => new RegExp(`\\b${name}\\b`).test(lower))
  if (!table) {
    if (lower.includes('sqlite_master')) {
      return {
        columns: ['name', 'type'],
        rows: Object.keys(mockDb).map((name) => [name, 'table']),
        affected: 0,
        lastInsertId: 0,
        durationMs: Math.round(performance.now() - started),
        truncated: false
      }
    }
    return {
      columns: [],
      rows: [],
      affected: lower.startsWith('insert') ? 1 : 0,
      lastInsertId: lower.startsWith('insert') ? 42 : 0,
      durationMs: Math.round(performance.now() - started),
      truncated: false
    }
  }
  const data = mockDb[table]
  if (lower.includes('count(*)')) {
    return {
      columns: ['count(*)'],
      rows: [[data.rows.length]],
      affected: 0,
      lastInsertId: 0,
      durationMs: Math.round(performance.now() - started),
      truncated: false
    }
  }
  return {
    columns: data.columns,
    rows: data.rows,
    affected: 0,
    lastInsertId: 0,
    durationMs: Math.round(performance.now() - started),
    truncated: false
  }
}

const mockSkills = [
  {
    name: 'release-checklist',
    description: 'Verify the desktop build before tagging a release.',
    path: `${MOCK_ROOT}\\.kudo\\skills\\release-checklist\\SKILL.md`,
    source: 'workspace'
  },
  {
    name: 'review-pr',
    description: 'Review a pull request for correctness, tests and regressions.',
    path: `${MOCK_ROOT}\\.kudo\\skills\\review-pr\\SKILL.md`,
    source: 'workspace'
  },
  {
    name: 'sql-migration',
    description: 'Write and apply a safe SQLite migration with a rollback path.',
    path: 'C:\\Users\\you\\AppData\\Roaming\\kudo\\skills\\sql-migration\\SKILL.md',
    source: 'user'
  }
]

let netSeq = 3
const mockNet: {
  id: number
  kind: string
  method: string
  url: string
  status: number | null
  durationMs: number
  bytes: number
  error: string | null
  at: number
}[] = [
  {
    id: 1,
    kind: 'ai',
    method: 'POST',
    url: 'https://api.openai.com/v1/chat/completions',
    status: 200,
    durationMs: 1840,
    bytes: 3120,
    error: null,
    at: Math.floor(Date.now() / 1000) - 240
  },
  {
    id: 2,
    kind: 'http',
    method: 'GET',
    url: 'http://localhost:3000/api/health',
    status: 200,
    durationMs: 14,
    bytes: 26,
    error: null,
    at: Math.floor(Date.now() / 1000) - 90
  }
]

const mockContainers = [
  {
    ID: 'c1a2b3c4d5e6',
    Names: 'kudo-postgres',
    Image: 'postgres:16-alpine',
    State: 'running',
    Status: 'Up 3 hours',
    Ports: '0.0.0.0:5432->5432/tcp'
  },
  {
    ID: 'f6e5d4c3b2a1',
    Names: 'kudo-redis',
    Image: 'redis:7-alpine',
    State: 'running',
    Status: 'Up 3 hours',
    Ports: '0.0.0.0:6379->6379/tcp'
  },
  {
    ID: '9a8b7c6d5e4f',
    Names: 'kudo-worker',
    Image: 'kudo/worker:dev',
    State: 'exited',
    Status: 'Exited (1) 22 minutes ago',
    Ports: ''
  }
]

const mockImages = [
  { Repository: 'postgres', Tag: '16-alpine', ID: 'a1b2c3d4', Size: '243MB' },
  { Repository: 'redis', Tag: '7-alpine', ID: 'e5f6a7b8', Size: '41MB' },
  { Repository: 'kudo/worker', Tag: 'dev', ID: 'c9d8e7f6', Size: '512MB' }
]


export async function mockCall<T>(cmd: string, args: Record<string, any> = {}): Promise<T> {
  const ok = <V>(v: V) => v as unknown as T
  switch (cmd) {
    case 'current_workspace':
      return ok(mockWorkspace)
    case 'open_workspace': {
      const target = String(args.path ?? MOCK_ROOT)
      const name = target.split(/[\\/]/).filter(Boolean).pop() ?? 'workspace'
      return ok({ ...mockWorkspace, path: target, name })
    }
    case 'close_workspace':
      return ok(undefined)
    case 'list_dir':
      return ok(mockListDir(args.path ?? MOCK_ROOT))
    case 'read_file': {
      const r = rel(args.path)
      const node = files.get(r)
      if (!node || node.dir) throw new Error(`file not found: ${r}`)
      return ok<FilePayload>({
        path: args.path,
        text: node.text ?? '',
        binary: false,
        size: node.text?.length ?? 0,
        humanSize: `${((node.text?.length ?? 0) / 1024).toFixed(1)} KB`
      })
    }
    case 'write_file': {
      const r = rel(args.path)
      files.set(r, { dir: false, text: args.text ?? '' })
      return ok(undefined)
    }
    case 'export_text':
      return ok(args.path)
    case 'create_path': {
      const r = rel(args.path)
      files.set(r, { dir: !!args.isDir, text: args.isDir ? undefined : '' })
      return ok(`${MOCK_ROOT}\\${r}`)
    }
    case 'rename_path': {
      const from = rel(args.from)
      const to = rel(args.to)
      const node = files.get(from)
      if (node) {
        files.delete(from)
        files.set(to, node)
      }
      return ok(`${MOCK_ROOT}\\${to}`)
    }
    case 'delete_path': {
      const r = rel(args.path)
      for (const key of [...files.keys()]) {
        if (key === r || key.startsWith(r + '\\')) files.delete(key)
      }
      return ok(undefined)
    }
    case 'search_files': {
      const q = String(args.query ?? '').toLowerCase()
      const hits: QuickFile[] = [...files.keys()]
        .filter((k) => !q || k.toLowerCase().includes(q))
        .slice(0, 60)
        .map((k) => ({ name: k.split('\\').pop() ?? k, path: `${MOCK_ROOT}\\${k}`, rel: k }))
      return ok(hits)
    }
    case 'search_in_files': {
      const q = String(args.query ?? '')
      const hits: SearchHit[] = []
      if (!q) return ok(hits)
      const matcher = mockPattern(q, !!args.caseSensitive, !!args.wholeWord, !!args.isRegex)
      for (const [k, node] of files) {
        if (node.dir || !node.text) continue
        node.text.split('\n').forEach((line, i) => {
          matcher.lastIndex = 0
          const found = matcher.exec(line)
          if (found && hits.length < 400) {
            hits.push({
              path: `${MOCK_ROOT}\\${k}`,
              rel: k,
              line: i + 1,
              column: [...line.slice(0, found.index)].length + 1,
              text: line.trim().slice(0, 240)
            })
          }
        })
      }
      return ok(hits)
    }
    case 'replace_in_files': {
      const q = String(args.query ?? '')
      const matcher = mockPattern(q, !!args.caseSensitive, !!args.wholeWord, !!args.isRegex)
      const replacement = String(args.replacement ?? '')
      const changes: ReplaceChange[] = []
      let total = 0
      for (const [k, node] of files) {
        if (node.dir || !node.text) continue
        const matches = [...node.text.matchAll(matcher)]
        if (!matches.length) continue
        total += matches.length
        if (total > 20_000) throw new Error('too many matches; narrow the search first')
        const lines = [...new Set(matches.map((m) => node.text!.slice(0, m.index).split('\n').length))]
        changes.push({
          path: `${MOCK_ROOT}\\${k}`,
          rel: k,
          matches: matches.length,
          lines: lines.slice(0, 40)
        })
        if (!args.dryRun) {
          const next = args.isRegex
            ? node.text.replace(matcher, replacement)
            : node.text.replace(matcher, () => replacement)
          files.set(k, { dir: false, text: next })
        }
      }
      return ok<ReplaceOutcome>({ matches: total, files: changes.length, changes })
    }
    case 'workspace_stats':
      return ok({ files: files.size, dirs: 8, bytes: 240_000 })
    case 'git_status':
      return ok(mockGitStatus())
    case 'git_branches':
      return ok<Branch[]>([
        { name: 'main', current: true, remote: false },
        { name: 'feat/agent-tools', current: false, remote: false },
        { name: 'origin/main', current: false, remote: true }
      ])
    case 'git_log':
      return ok<Commit[]>([
        { hash: 'a1b2c3d4e5f6', short: 'a1b2c3d', author: 'Zanni', date: '2026-10-27', subject: 'feat: agent tool loop' },
        { hash: 'b2c3d4e5f6a1', short: 'b2c3d4e', author: 'Zanni', date: '2026-10-26', subject: 'fix: terminal resize on Windows' },
        { hash: 'c3d4e5f6a1b2', short: 'c3d4e5f', author: 'Zanni', date: '2026-10-25', subject: 'chore: theme tokens' }
      ])
    case 'git_diff':
      return ok(
        `diff --git a/${rel(args.path)} b/${rel(args.path)}\nindex 1111111..2222222 100644\n--- a/${rel(args.path)}\n+++ b/${rel(args.path)}\n@@ -1,4 +1,6 @@\n-old line\n+new line\n+another line\n`
      )
    case 'git_stage':
    case 'git_unstage':
    case 'git_stage_all':
    case 'git_discard':
    case 'git_commit':
    case 'git_checkout_branch':
    case 'git_create_branch':
    case 'git_push':
    case 'git_pull':
    case 'git_fetch':
      return ok('ok')
    case 'get_settings':
      return ok(loadSettings())
    case 'save_settings':
      localStorage.setItem('kudo:settings', JSON.stringify(args.settings))
      return ok(args.settings)
    case 'reset_settings':
      localStorage.removeItem('kudo:settings')
      return ok(defaultSettings)
    case 'app_info':
      return ok({
        name: 'Kudo',
        version: '0.7.0',
        platform: 'browser-mock',
        arch: 'wasm',
        configDir: 'localStorage'
      })
    case 'ai_probe':
      return ok(['gpt-4o-mini', 'gpt-4o', 'claude-3-5-sonnet', 'llama3.2'])
    case 'run_command':
      return ok({
        stdout: `MOCK SHELL\n$ ${args.command}\n\n(commands are disabled in the browser mock — run the desktop build)`,
        stderr: '',
        code: 0,
        durationMs: 12
      })
    case 'pty_spawn':
    case 'pty_write':
    case 'pty_resize':
    case 'pty_kill':
      return ok(undefined)
    case 'pty_kill_all':
      return ok(0)
    case 'pty_is_running':
      return ok(false)
    case 'dap_detect':
      return ok({})
    case 'dap_start':
    case 'dap_request':
    case 'dap_stop':
      return ok(undefined)
    case 'tests_detect':
      return ok([
        {
          path: 'C:\\demo\\kudo-workspace\\lib\\strutil_test.go',
          rel: 'lib/strutil_test.go',
          framework: 'go',
          package: 'lib',
          tests: [
            { name: 'TestTrim', line: 14 },
            { name: 'TestSplit', line: 26 }
          ]
        },
        {
          path: 'C:\\demo\\kudo-workspace\\app\\test_models.py',
          rel: 'app/test_models.py',
          framework: 'python',
          package: 'app',
          tests: [
            { name: 'test_create', line: 9 },
            { name: 'test_update', line: 17 }
          ]
        }
      ])
    case 'tests_toolchain':
      return ok({ go: 'C:\\Program Files\\Go\\bin\\go.exe', python: 'C:\\Python313\\python.exe' })
    case 'test_run':
      return ok({ id: 'mock-run', label: 'go test -v -count=1 ./...', cwd: 'C:\\demo\\kudo-workspace' })
    case 'test_cancel':
      return ok(true)
    case 'test_cancel_all':
      return ok(0)
    case 'tasks_detect':
      return ok([
        {
          id: 'kudo:0',
          label: 'Build',
          source: 'kudo',
          detail: 'pnpm build',
          command: 'pnpm build',
          cwd: '',
          group: 'build',
          isDefault: true
        },
        {
          id: 'package::dev',
          label: 'dev',
          source: 'package',
          detail: 'pnpm run dev',
          command: 'pnpm run dev',
          cwd: '',
          group: 'none',
          isDefault: false
        },
        {
          id: 'make:lint',
          label: 'lint',
          source: 'make',
          detail: 'make lint',
          command: 'make lint',
          cwd: '',
          group: 'none',
          isDefault: false
        }
      ])
    case 'tasks_toolchain':
      return ok({ npm: 'C:\\Program Files\\nodejs\\npm.cmd', node: 'C:\\Program Files\\nodejs\\node.exe' })
    case 'task_run':
      return ok({ id: 'mock-task-run', label: 'pnpm build', cwd: 'C:\\demo\\kudo-workspace' })
    case 'task_cancel':
      return ok(true)
    case 'task_cancel_all':
      return ok(0)
    case 'format_toolchain':
      return ok([
        {
          id: 'prettier',
          label: 'Prettier',
          kind: 'formatter',
          languages: ['javascript', 'typescript', 'json', 'css', 'html', 'markdown', 'yaml', 'vue'],
          path: 'C:\\demo\\kudo-workspace\\node_modules\\prettier\\bin\\prettier.cjs',
          scope: 'workspace',
          install: 'npm install -D prettier'
        },
        {
          id: 'gofmt',
          label: 'gofmt',
          kind: 'formatter',
          languages: ['go'],
          path: 'C:\\Program Files\\Go\\bin\\gofmt.exe',
          scope: 'path',
          install: 'ships with the Go toolchain'
        },
        {
          id: 'rustfmt',
          label: 'rustfmt',
          kind: 'formatter',
          languages: ['rust'],
          path: '',
          scope: '',
          install: 'rustup component add rustfmt'
        },
        {
          id: 'black',
          label: 'Black',
          kind: 'formatter',
          languages: ['python'],
          path: 'C:\\Python313\\Scripts\\black.exe',
          scope: 'path',
          install: 'pip install black'
        },
        {
          id: 'eslint',
          label: 'ESLint',
          kind: 'linter',
          languages: ['javascript', 'typescript', 'vue'],
          path: 'C:\\demo\\kudo-workspace\\node_modules\\eslint\\bin\\eslint.js',
          scope: 'workspace',
          install: 'npm install -D eslint'
        },
        {
          id: 'ruff',
          label: 'Ruff',
          kind: 'linter',
          languages: ['python'],
          path: 'C:\\Python313\\Scripts\\ruff.exe',
          scope: 'path',
          install: 'pip install ruff'
        }
      ])
    case 'format_document': {
      const text = String(args.text ?? '')
      // The browser demo has no real formatter: normalise trailing spaces so
      // the save path can still be exercised.
      const formatted = text
        .split('\n')
        .map((line: string) => line.replace(/[ \t]+$/, ''))
        .join('\n')
      return ok({ tool: 'prettier', changed: formatted !== text, text: formatted })
    }
    case 'lint_document':
      return ok({
        tool: 'eslint',
        issues: [
          {
            line: 2,
            column: 1,
            endLine: 2,
            endColumn: 8,
            message: 'Demo lint issue: prefer const',
            severity: 'warning',
            source: 'eslint (prefer-const)',
            code: 'prefer-const'
          }
        ],
        raw: '',
        error: ''
      })
    case 'terminal_shells': {
      const configured = loadSettings().terminalShell
      const configuredName = configured
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.exe$/i, '')
        .toLowerCase()
      const shells = [
        {
          id: 'pwsh',
          label: 'PowerShell 7',
          path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
        },
        {
          id: 'powershell',
          label: 'Windows PowerShell',
          path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
        },
        { id: 'cmd', label: 'Command Prompt', path: 'C:\\Windows\\System32\\cmd.exe' },
        { id: 'wsl', label: 'WSL', path: 'C:\\Windows\\System32\\wsl.exe' },
        { id: 'bash', label: 'Bash', path: 'C:\\Program Files\\Git\\bin\\bash.exe' }
      ]
      const match = shells.find((shell) => shell.id === configuredName)
      if (!match && configured.trim()) {
        shells.unshift({
          id: configuredName || 'shell',
          label: configuredName || 'Shell',
          path: configured
        })
      }
      const defaultId = match?.id ?? shells[0]?.id
      return ok(shells.map((shell) => ({ ...shell, isDefault: shell.id === defaultId })))
    }
    case 'db_engine_info':
      return ok({ version: '3.46.0 (mock)', available: true })
    case 'db_connect': {
      const path = String(args.path ?? 'C:\\demo\\kudo-workspace\\demo.sqlite')
      const name = path.split(/[\\/]/).pop() ?? 'demo.sqlite'
      return ok({ id: 'mock-db', path, name, tables: Object.keys(mockDb).length })
    }
    case 'db_disconnect':
      return ok(undefined)
    case 'db_list_tables':
      return ok(
        Object.entries(mockDb).map(([name, table]) => ({
          name,
          kind: 'table',
          rows: table.rows.length
        }))
      )
    case 'db_table_schema': {
      const table = mockDb[String(args.table)]
      return ok(
        (table?.columns ?? []).map((name, i) => ({
          name,
          kind: i === 0 ? 'INTEGER' : 'TEXT',
          notNull: i === 0,
          primaryKey: i === 0,
          defaultValue: null
        }))
      )
    }
    case 'db_query':
    case 'db_execute_script':
      return ok(dbResultFor(String(args.sql ?? '')))
    case 'skills_list':
      return ok(mockSkills)
    case 'skill_read':
      return ok(
        `---\nname: ${String(args.path).split(/[\\/]/).slice(-2, -1)[0] ?? 'skill'}\ndescription: Mock skill body\n---\n\n# Mock skill\n\nThis is served by the browser mock. Open the desktop build to read the real file.\n`
      )
    case 'skill_save':
    case 'skill_scaffold':
      return ok(`${MOCK_ROOT}\\.kudo\\skills\\new-skill\\SKILL.md`)
    case 'docker_info':
      return ok({ available: true, version: '27.3.1 (mock)', error: null })
    case 'docker_containers':
      return ok(mockContainers)
    case 'docker_images':
      return ok(mockImages)
    case 'docker_action':
      return ok('ok')
    case 'docker_logs':
      return ok({
        id: args.id,
        text: `2026-10-27T08:00:00Z container ${args.id} started\n2026-10-27T08:00:02Z listening on port 5432\n2026-10-27T08:01:12Z checkpoint complete`
      })
    case 'docker_run_image':
      return ok('started (mock)')
    case 'netlog_list': {
      return ok([...mockNet].reverse())
    }
    case 'netlog_clear':
      mockNet.length = 0
      return ok(undefined)
    case 'browser_ping':
      return ok({ ok: true, status: 200, latencyMs: 12, error: null })
    case 'browser_fetch': {
      const started = performance.now()
      try {
        const response = await fetch(String(args.url), {
          method: String(args.method ?? 'GET'),
          headers: (args.headers as [string, string][])?.length
            ? Object.fromEntries(args.headers as [string, string][])
            : undefined,
          body: args.body ? String(args.body) : undefined
        })
        const body = await response.text()
        mockNet.push({
          id: ++netSeq,
          kind: 'http',
          method: String(args.method ?? 'GET'),
          url: String(args.url),
          status: response.status,
          durationMs: Math.round(performance.now() - started),
          bytes: body.length,
          error: null,
          at: Math.floor(Date.now() / 1000)
        })
        return ok({
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers.entries()],
          body,
          contentType: response.headers.get('content-type') ?? '',
          durationMs: Math.round(performance.now() - started),
          truncated: false
        })
      } catch (err) {
        mockNet.push({
          id: ++netSeq,
          kind: 'http',
          method: String(args.method ?? 'GET'),
          url: String(args.url),
          status: null,
          durationMs: Math.round(performance.now() - started),
          bytes: 0,
          error: String(err),
          at: Math.floor(Date.now() / 1000)
        })
        throw new Error(
          `Browser mock cannot call ${args.url} (CORS). The desktop build proxies requests through Rust.`
        )
      }
    }
    case 'browser_open_external':
      window.open(String(args.url), '_blank', 'noopener')
      return ok(undefined)
    case 'mcp_probe':
      return ok(`C:\\Program Files\\nodejs\\${args.command}.cmd`)
    case 'mcp_connect': {
      const name = String(args.name ?? 'mock-server')
      return ok({
        id: 'mock-mcp',
        name,
        serverInfo: { name, version: '1.0.0' },
        capabilities: { tools: {} },
        protocolVersion: '2024-11-05',
        tools: [
          {
            name: 'read_file',
            description: 'Read a text file from the configured root.',
            inputSchema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path']
            },
            server: name
          },
          {
            name: 'list_directory',
            description: 'List entries in a directory.',
            inputSchema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path']
            },
            server: name
          },
          {
            name: 'fetch',
            description: 'Fetch a URL and return its text body.',
            inputSchema: {
              type: 'object',
              properties: { url: { type: 'string' } },
              required: ['url']
            },
            server: name
          }
        ]
      })
    }
    case 'mcp_list_tools':
      return ok([])
    case 'mcp_call_tool':
      return ok({
        content: [
          {
            type: 'text',
            text: `Mock MCP result for ${args.tool} with ${JSON.stringify(args.arguments ?? {})}`
          }
        ],
        isError: false
      })
    case 'mcp_disconnect':
      return ok(undefined)
    case 'update_check': {
      if (!String(args.feedUrl ?? '').trim()) {
        throw new Error('Set an update feed URL in Settings → About first')
      }
      return ok({
        currentVersion: '0.7.0',
        latestVersion: '0.7.0',
        available: true,
        notes: '## Kudo 0.7.0\n\n- Test explorer for Go, Rust, Python and Node projects\n- Run a file or a single test, stream output, cancel a run\n- Per-test status in the sidebar and the editor gutter\n',
        publishedAt: '2026-10-30T00:00:00Z',
        url: 'https://example.com/kudo_0.7.0_x64-setup.exe',
        feed: String(args.feedUrl)
      })
    }
    case 'update_download':
      return ok({
        path: 'C:\\Users\\you\\AppData\\Local\\Temp\\kudo-updates\\kudo-setup.exe',
        bytes: 84_000_000,
        fileName: 'kudo-setup.exe'
      })
    case 'update_install':
    case 'update_reveal':
      return ok(undefined)
    default:
      return ok(undefined)
  }
}
