import type { ChatMessage, ToolCall } from '../lib/types'
import { call, cancelChat, isTauri, streamChat } from '../lib/api'
import type { ToolDef } from '../lib/api'

const tools: ToolDef[] = [
  {
    name: 'list_dir',
    description:
      'List the entries of a directory inside the workspace. Use an absolute path or a path relative to the workspace root. Defaults to the workspace root.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory to list' } }
    }
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file from the workspace. Returns the full contents.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File to read' } },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description:
      'Create or overwrite a file in the workspace with the given content. Always provide the complete new file contents.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File to write' },
        content: { type: 'string', description: 'Complete file contents' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'search_files',
    description: 'Fuzzy-search file paths in the workspace. Returns up to 40 matches.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query']
    }
  },
  {
    name: 'grep',
    description: 'Search text across workspace files. Returns file, line and matching text.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Literal text to find' },
        case_sensitive: { type: 'boolean' }
      },
      required: ['query']
    }
  },
  {
    name: 'run_command',
    description:
      'Run a one-shot shell command in the workspace root (PowerShell on Windows, sh elsewhere). Prefer read-only commands unless the user asked for a change.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command line to execute' }
      },
      required: ['command']
    }
  },
  {
    name: 'read_skill',
    description:
      'Read a workspace or user skill by its SKILL.md path. Use this when the task matches an available skill.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to SKILL.md' }
      },
      required: ['path']
    }
  }
]

function summarise(value: unknown, max = 20_000): string {
  let text: string
  if (typeof value === 'string') text = value
  else text = JSON.stringify(value, null, 1)
  if (text.length > max) text = text.slice(0, max) + '\n… truncated …'
  return text
}

export interface PendingApproval {
  id: string
  name: string
  title: string
  detail: string
}

/** Resolvers for approval cards currently on screen. Keyed by approval id. */
const approvalResolvers = new Map<string, (ok: boolean) => void>()

export function useChat() {
  const ide = useIde()
  const checkpoints = useCheckpoints()
  const messages = useState<ChatMessage[]>('kodra:chat-messages', () => [])
  const busy = useState<boolean>('kodra:chat-busy', () => false)
  const requestId = useState<string | null>('kodra:chat-request', () => null)
  const loadedKey = useState<string>('kodra:chat-key', () => '')
  const approvals = useState<PendingApproval[]>('kodra:chat-approvals', () => [])

  function requestApproval(toolCall: ToolCall, title: string, detail: string) {
    const id = crypto.randomUUID()
    approvals.value = [...approvals.value, { id, name: toolCall.name, title, detail }]
    return new Promise<boolean>((resolve) => approvalResolvers.set(id, resolve))
  }

  function resolveApproval(id: string, ok: boolean) {
    const resolve = approvalResolvers.get(id)
    approvalResolvers.delete(id)
    approvals.value = approvals.value.filter((a) => a.id !== id)
    resolve?.(ok)
  }

  function cancelApprovals() {
    for (const pending of [...approvals.value]) resolveApproval(pending.id, false)
    approvals.value = []
  }

  const storageKey = computed(() =>
    `kodra:chat:${ide.workspace.value?.path ?? 'scratch'}`
  )

  function persist() {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(storageKey.value, JSON.stringify(messages.value.slice(-120)))
  }

  function load() {
    if (typeof localStorage === 'undefined') return
    if (loadedKey.value === storageKey.value) return
    loadedKey.value = storageKey.value
    try {
      const raw = localStorage.getItem(storageKey.value)
      messages.value = raw ? JSON.parse(raw) : []
    } catch {
      messages.value = []
    }
  }

  function clear() {
    cancelApprovals()
    messages.value = []
    persist()
  }

  async function executeTool(toolCall: ToolCall): Promise<string> {
    let args: Record<string, any> = {}
    try {
      args = JSON.parse(toolCall.arguments || '{}')
    } catch {
      return `Invalid JSON arguments: ${toolCall.arguments}`
    }

    const needsApproval = ['write_file', 'run_command'].includes(toolCall.name)
    if (needsApproval && !ide.settings.value.ai.autoApprove) {
      const title =
        toolCall.name === 'write_file'
          ? `Write ${args.path ?? 'a file'}?`
          : 'Run a shell command?'
      const detail =
        toolCall.name === 'write_file'
          ? String(args.content ?? '')
          : String(args.command ?? '')
      const allowed = await requestApproval(toolCall, title, detail)
      if (!allowed) return 'The user denied this action.'
    }

    try {
      switch (toolCall.name) {
        case 'list_dir': {
          const entries = await call<any[]>('list_dir', { path: args.path ?? ide.workspace.value?.path })
          return summarise(
            entries.map((e) => ({
              name: e.name,
              dir: e.isDir,
              size: e.humanSize,
              path: e.path
            }))
          )
        }
        case 'read_file': {
          const file = await call<{ text: string; binary: boolean }>('read_file', {
            path: args.path
          })
          if (file.binary) return 'The file is binary and cannot be shown as text.'
          return summarise(file.text)
        }
        case 'write_file': {
          await checkpoints.snapshot(String(args.path ?? ''))
          await call('write_file', { path: args.path, text: args.content ?? '' })
          const open = ide.tabs.value.find((t) => t.path === args.path)
          if (open) {
            open.content = args.content ?? ''
            open.savedContent = args.content ?? ''
            open.dirty = false
          }
          return `Wrote ${args.path}`
        }
        case 'search_files': {
          const hits = await call<any[]>('search_files', { query: args.query, limit: 40 })
          return summarise(hits.map((h) => h.rel))
        }
        case 'grep': {
          const hits = await call<any[]>('search_in_files', {
            query: args.query,
            caseSensitive: !!args.case_sensitive,
            limit: 80
          })
          return summarise(hits.map((h) => `${h.rel}:${h.line}: ${h.text}`))
        }
        case 'run_command': {
          const out = await call<{ stdout: string; stderr: string; code: number }>(
            'run_command',
            { command: args.command }
          )
          return summarise(
            `exit ${out.code}\n${out.stdout}${out.stderr ? `\n[stderr]\n${out.stderr}` : ''}`
          )
        }
        case 'read_skill': {
          const text = await call<string>('skill_read', { path: args.path })
          return summarise(text)
        }
        default:
          return `Unknown tool: ${toolCall.name}`
      }
    } catch (err) {
      return `Tool failed: ${String(err)}`
    }
  }

  async function send(text: string) {
    const content = text.trim()
    if (!content || busy.value) return
    load()

    const user: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: Date.now()
    }
    messages.value = [...messages.value, user]
    busy.value = true
    checkpoints.beginTurn(content)

    let skillContext = ''
    if (ide.settings.value.ai.agentMode) {
      try {
        const skills = await call<{ name: string; description: string; path: string }[]>(
          'skills_list'
        )
        if (skills.length) {
          skillContext =
            '\n\nAvailable skills — call `read_skill` with the path before applying one:\n' +
            skills
              .slice(0, 40)
              .map((s) => `- ${s.name}: ${s.description || 'no description'} (${s.path})`)
              .join('\n')
        }
      } catch {
        /* skills are optional */
      }
    }

    const id = `chat-${Date.now()}`
    requestId.value = id

    try {
      for (let turn = 0; turn < 8; turn++) {
        const assistant: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          pending: true,
          createdAt: Date.now()
        }
        messages.value = [...messages.value, assistant]
        const idx = messages.value.length - 1

        const result = await streamChat(
          {
            provider: ide.settings.value.ai.provider,
            baseUrl: ide.settings.value.ai.baseUrl,
            model: ide.settings.value.ai.model,
            apiKey: ide.settings.value.ai.apiKey,
            system: ide.settings.value.ai.systemPrompt + skillContext,
            messages: messages.value
              .filter((m) => !m.pending || m.content)
              .map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                toolCalls: m.toolCalls,
                toolCallId: m.toolCallId,
                createdAt: m.createdAt
              })),
            tools: ide.settings.value.ai.agentMode ? tools : [],
            temperature: ide.settings.value.ai.temperature,
            maxTokens: ide.settings.value.ai.maxTokens,
            requestId: id
          },
          {
            onDelta: (chunk) => {
              const live = messages.value[idx]
              if (live) live.content += chunk
            },
            onError: (message) => {
              const live = messages.value[idx]
              if (live) {
                live.error = true
                live.content += `\n\n${message}`
              }
            }
          }
        )

        const live = messages.value[idx]
        if (live) {
          live.pending = false
          live.content = result.content || live.content
          if (result.toolCalls?.length) live.toolCalls = result.toolCalls
        }
        persist()

        if (!result.toolCalls?.length) break

        for (const toolCall of result.toolCalls) {
          messages.value = [
            ...messages.value,
            {
              id: crypto.randomUUID(),
              role: 'tool',
              content: 'Running…',
              toolCallId: toolCall.id,
              name: toolCall.name,
              createdAt: Date.now()
            }
          ]
          const toolIndex = messages.value.length - 1
          const output = await executeTool(toolCall)
          messages.value[toolIndex] = {
            ...messages.value[toolIndex],
            content: output
          }
          const reply = messages.value[idx]
          if (reply && !reply.checkpointId && checkpoints.turnId.value) {
            reply.checkpointId = checkpoints.turnId.value
          }
          persist()
        }
      }
    } catch (err) {
      ide.notify(String(err), 'error')
    } finally {
      busy.value = false
      requestId.value = null
      persist()
    }
  }

  async function stop() {
    if (requestId.value && isTauri()) await cancelChat(requestId.value)
    cancelApprovals()
    busy.value = false
  }

  return {
    messages,
    busy,
    approvals,
    send,
    stop,
    clear,
    load,
    persist,
    resolveApproval
  }
}
