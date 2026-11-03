export interface WorkspaceInfo {
  name: string
  path: string
  isGit: boolean
  branch: string | null
}

export interface Entry {
  name: string
  path: string
  isDir: boolean
  size: number
  humanSize: string
  modified: number
  ext: string
  hidden: boolean
}

export interface FilePayload {
  path: string
  text: string
  binary: boolean
  size: number
  humanSize: string
}

export interface QuickFile {
  name: string
  path: string
  rel: string
}

export interface SearchHit {
  path: string
  rel: string
  line: number
  column: number
  text: string
}

export interface ReplaceChange {
  path: string
  rel: string
  matches: number
  /** First matching line numbers (capped by the backend for the preview). */
  lines: number[]
}

export interface ReplaceOutcome {
  matches: number
  files: number
  changes: ReplaceChange[]
}

export interface GitFile {
  path: string
  rel: string
  index: string
  worktree: string
  staged: boolean
  status: string
}

export interface GitStatus {
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  files: GitFile[]
  clean: boolean
}

export interface Branch {
  name: string
  current: boolean
  remote: boolean
}

export interface Worktree {
  path: string
  head: string
  short: string
  branch: string | null
  detached: boolean
  bare: boolean
  locked: string | null
  prunable: string | null
  main: boolean
  current: boolean
}

export interface ExtensionInfo {
  folder: string
  id: string
  name: string
  version: string
  description: string
  author: string
  path: string
  enabled: boolean
  themes: Record<string, unknown>[]
  snippets: Record<string, unknown>[]
  error: string | null
}

export interface Commit {
  hash: string
  short: string
  author: string
  date: string
  subject: string
}

export interface RecentWorkspace {
  name: string
  path: string
  lastOpened: number
}

export interface AiSettings {
  provider: string
  baseUrl: string
  model: string
  apiKey: string
  temperature: number
  maxTokens: number
  systemPrompt: string
  agentMode: boolean
  autoApprove: boolean
}

export interface Settings {
  theme: string
  accent: string
  fontFamily: string
  fontSize: number
  tabSize: number
  wordWrap: boolean
  minimap: boolean
  terminalShell: string
  terminalFontSize: number
  restoreSession: boolean
  formatOnSave: boolean
  lintOnSave: boolean
  inlayHints: boolean
  semanticHighlighting: boolean
  ai: AiSettings
  recentWorkspaces: RecentWorkspace[]
  mcpServers: McpServerConfig[]
  updateFeed: string
  browserHome: string
}

export interface TerminalShellInfo {
  id: string
  label: string
  path: string
  isDefault: boolean
}

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  name?: string
  pending?: boolean
  error?: boolean
  createdAt: number
  meta?: string
  /** Checkpoint created before the tools in this reply touched files. */
  checkpointId?: string
  /** When the user rolled the checkpoint back. */
  restoredAt?: number
}

export interface EditorTab {
  path: string
  name: string
  content: string
  savedContent: string
  language: string
  binary: boolean
  scrollTop?: number
  dirty?: boolean
}

export type SidebarView =
  | 'explorer'
  | 'search'
  | 'git'
  | 'debug'
  | 'tests'
  | 'tasks'
  | 'agent'
  | 'database'
  | 'skills'
  | 'docker'
  | 'mcp'
  | 'extensions'

export interface CommandOutput {
  stdout: string
  stderr: string
  code: number
  durationMs: number
}

/* ---------------------------------------------------------------- database */

export interface DbConnection {
  id: string
  path: string
  name: string
  tables: number
}

export interface DbTable {
  name: string
  kind: string
  rows: number
}

export interface DbColumn {
  name: string
  kind: string
  notNull: boolean
  primaryKey: boolean
  defaultValue: string | null
}

export interface DbResult {
  columns: string[]
  rows: unknown[][]
  affected: number
  lastInsertId: number
  durationMs: number
  truncated: boolean
}

/* -------------------------------------------------------------------- mcp */

export interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
}

export interface McpTool {
  name: string
  description: string
  inputSchema: unknown
  server: string
}

export interface McpConnectResult {
  id: string
  name: string
  serverInfo: unknown
  capabilities: unknown
  protocolVersion: string
  tools: McpTool[]
}

/* ----------------------------------------------------------------- skills */

export interface Skill {
  name: string
  description: string
  path: string
  source: string
}

/* ----------------------------------------------------------------- docker */

export interface DockerInfo {
  available: boolean
  version: string
  error: string | null
}

export interface DockerContainer {
  ID?: string
  Names?: string
  Image?: string
  State?: string
  Status?: string
  Ports?: string
  CreatedAt?: string
  [key: string]: unknown
}

/* ---------------------------------------------------------------- network */

export interface NetEntry {
  id: number
  kind: string
  method: string
  url: string
  status: number | null
  durationMs: number
  bytes: number
  error: string | null
  at: number
}

/* ---------------------------------------------------------------- updater */

export interface UpdateCheck {
  currentVersion: string
  latestVersion: string
  available: boolean
  notes: string
  publishedAt: string
  url: string | null
  sha256: string | null
  feed: string
}

export interface UpdateDownload {
  path: string
  bytes: number
  fileName: string
  verified: boolean
}
