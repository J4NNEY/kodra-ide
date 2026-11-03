import { mockCall } from './mock'
import type { ChatMessage, ToolCall } from './types'

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri()) return mockCall<T>(cmd, args as Record<string, any>)
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  const { listen: l } = await import('@tauri-apps/api/event')
  return l<T>(event, (e) => handler(e.payload))
}

// Dev-only bridge so the desktop shell can be exercised from a CDP session.
if (import.meta.dev && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__kodraCall = call
}

export interface AiStreamHandlers {
  onDelta: (text: string) => void
  onError: (message: string) => void
}

export interface AiRequest {
  provider: string
  baseUrl: string
  model: string
  apiKey: string
  system: string
  messages: ChatMessage[]
  tools: ToolDef[]
  temperature: number
  maxTokens: number
  requestId: string
}

export interface AiResponse {
  content: string
  toolCalls: ToolCall[]
  finishReason: string
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** Streams an assistant reply. Works in Tauri (IPC Channel) and in the browser mock. */
export async function streamChat(
  req: AiRequest,
  handlers: AiStreamHandlers
): Promise<AiResponse> {
  if (!isTauri()) {
    const last = [...req.messages].reverse().find((m) => m.role === 'user')
    const text =
      `**Demo mode** — the renderer is running in a browser, so no provider is called.\n\n` +
      `You said:\n\n> ${(last?.content ?? '').slice(0, 400)}\n\n` +
      `Run \`pnpm desktop\` to use the real Rust backend, or open Settings → AI to configure a provider.`
    let content = ''
    for (const piece of text.split(/(?<= )/)) {
      content += piece
      handlers.onDelta(piece)
      await new Promise((r) => setTimeout(r, 14))
    }
    return { content, toolCalls: [], finishReason: 'stop' }
  }

  const { Channel, invoke } = await import('@tauri-apps/api/core')
  const channel = new Channel<{ type: string; text?: string; message?: string }>()
  channel.onmessage = (event) => {
    if (event.type === 'delta' && event.text) handlers.onDelta(event.text)
    else if (event.type === 'error' && event.message) handlers.onError(event.message)
  }

  const result = await invoke<{ content: string; toolCalls: ToolCall[]; finishReason: string }>(
    'ai_chat',
    {
      channel,
      req: {
        provider: req.provider,
        baseUrl: req.baseUrl,
        model: req.model,
        apiKey: req.apiKey,
        system: req.system,
        messages: req.messages.map((m) => ({
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls,
          toolCallId: m.toolCallId,
          name: m.name
        })),
        tools: req.tools,
        temperature: req.temperature,
        maxTokens: req.maxTokens,
        requestId: req.requestId
      }
    }
  )
  return result
}

export async function cancelChat(requestId: string): Promise<void> {
  await call('ai_cancel', { requestId })
}

export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) return 'C:\\demo\\kodra-workspace'
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({ directory: true, multiple: false, title: 'Open folder' })
  return typeof picked === 'string' ? picked : null
}

export async function pickExtensionFolder(): Promise<string | null> {
  if (!isTauri()) return 'C:\\demo\\kodra-extensions\\ember'
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({
    directory: true,
    multiple: false,
    title: 'Select extension folder'
  })
  return typeof picked === 'string' ? picked : null
}

/** Pick an existing SQLite database file. */
export async function pickDatabaseFile(): Promise<string | null> {
  if (!isTauri()) return 'C:\\demo\\kodra-workspace\\demo.sqlite'
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({
    multiple: false,
    title: 'Open SQLite database',
    filters: [
      { name: 'SQLite database', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })
  return typeof picked === 'string' ? picked : null
}

/** Pick a destination path for a new database or an export. */
export async function pickSaveFile(
  defaultPath: string,
  filters: { name: string; extensions: string[] }[] = []
): Promise<string | null> {
  if (!isTauri()) return `C:\\demo\\kodra-workspace\\${defaultPath}`
  const { save } = await import('@tauri-apps/plugin-dialog')
  const picked = await save({ defaultPath, filters })
  return typeof picked === 'string' ? picked : null
}

export function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

export function dirname(path: string): string {
  const norm = path.replace(/\\/g, '/')
  const idx = norm.lastIndexOf('/')
  return idx <= 0 ? norm : path.slice(0, idx)
}

export function relativeTo(root: string, path: string): string {
  return path.replace(root, '').replace(/^[\\/]/, '').replace(/\\/g, '/')
}

export function languageFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    md: 'markdown',
    mdx: 'markdown',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'css',
    less: 'css',
    py: 'python',
    pyi: 'python',
    rs: 'rust',
    go: 'go',
    toml: 'toml',
    yml: 'yaml',
    yaml: 'yaml',
    sh: 'shell',
    ps1: 'powershell',
    ahk: 'autohotkey',
    sql: 'sql',
    dockerfile: 'dockerfile',
    dart: 'dart',
    arb: 'json',
    kt: 'kotlin',
    kts: 'kotlin',
    java: 'java',
    swift: 'swift',
    xml: 'xml',
    gradle: 'groovy',
    groovy: 'groovy',
    properties: 'properties',
    c: 'c',
    h: 'c',
    cc: 'cpp',
    cpp: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    hh: 'cpp',
    cs: 'csharp',
    rb: 'ruby',
    lua: 'lua',
    proto: 'protobuf'
  }
  return map[ext] ?? 'plaintext'
}
