import type { McpConnectResult, McpServerConfig, McpTool } from '../lib/types'
import { call } from '../lib/api'

export interface McpSessionState {
  id: string
  name: string
  tools: McpTool[]
  info: unknown
  protocolVersion: string
  busy: boolean
  error: string
}

export function useMcp() {
  const ide = useIde()
  const sessions = useState<Record<string, McpSessionState>>('kodra:mcp-sessions', () => ({}))

  function configFor(name: string) {
    return (ide.settings.value.mcpServers ?? []).find((s) => s.name === name)
  }

  async function connect(config: McpServerConfig) {
    sessions.value = {
      ...sessions.value,
      [config.name]: {
        id: '',
        name: config.name,
        tools: [],
        info: null,
        protocolVersion: '',
        busy: true,
        error: ''
      }
    }
    try {
      const result = await call<McpConnectResult>('mcp_connect', {
        name: config.name,
        command: config.command,
        args: config.args ?? [],
        env: config.env ?? {}
      })
      sessions.value = {
        ...sessions.value,
        [config.name]: {
          id: result.id,
          name: result.name,
          tools: result.tools ?? [],
          info: result.serverInfo,
          protocolVersion: result.protocolVersion,
          busy: false,
          error: ''
        }
      }
      return result
    } catch (err) {
      sessions.value = {
        ...sessions.value,
        [config.name]: {
          ...sessions.value[config.name],
          busy: false,
          error: String(err)
        }
      }
      ide.notify(`MCP ${config.name}: ${String(err)}`, 'error')
      return null
    }
  }

  async function disconnect(name: string) {
    const session = sessions.value[name]
    if (session?.id) {
      try {
        await call('mcp_disconnect', { id: session.id })
      } catch {
        /* already gone */
      }
    }
    const next = { ...sessions.value }
    delete next[name]
    sessions.value = next
  }

  async function refreshTools(name: string) {
    const session = sessions.value[name]
    if (!session?.id) return
    try {
      const tools = await call<McpTool[]>('mcp_list_tools', { id: session.id })
      sessions.value = {
        ...sessions.value,
        [name]: { ...session, tools }
      }
    } catch (err) {
      sessions.value = {
        ...sessions.value,
        [name]: { ...session, error: String(err) }
      }
    }
  }

  async function callTool(name: string, tool: string, args: unknown) {
    const session = sessions.value[name]
    if (!session?.id) throw new Error('server is not connected')
    return call<unknown>('mcp_call_tool', {
      id: session.id,
      tool,
      arguments: args
    })
  }

  async function probe(command: string) {
    return call<string>('mcp_probe', { command })
  }

  function removeConfig(name: string) {
    const next = JSON.parse(JSON.stringify(ide.settings.value)) as typeof ide.settings.value
    next.mcpServers = (next.mcpServers ?? []).filter((s) => s.name !== name)
    ide.saveSettings(next)
    disconnect(name)
  }

  function saveConfig(config: McpServerConfig) {
    const next = JSON.parse(JSON.stringify(ide.settings.value)) as typeof ide.settings.value
    const list = next.mcpServers ?? []
    const idx = list.findIndex((s) => s.name === config.name)
    if (idx >= 0) list[idx] = config
    else list.push(config)
    next.mcpServers = list
    return ide.saveSettings(next)
  }

  return { sessions, connect, disconnect, refreshTools, callTool, probe, saveConfig, removeConfig, configFor }
}
