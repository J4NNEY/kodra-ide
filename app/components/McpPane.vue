<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  Check,
  ChevronDown,
  Loader2,
  Play,
  Plug,
  PlugZap,
  Plus,
  Server,
  Trash2,
  X
} from 'lucide-vue-next'
import type { McpServerConfig, McpTool } from '../lib/types'

const ide = useIde()
const mcp = useMcp()

const showAdd = ref(false)
const editing = ref<McpServerConfig | null>(null)
const form = reactive({ name: '', command: 'npx', args: '', env: '' })
const formError = ref('')
const expanded = ref<Record<string, boolean>>({})

const activeTool = ref<{ server: string; tool: McpTool } | null>(null)
const toolArgs = ref('{}')
const toolResult = ref('')
const toolError = ref('')
const runningTool = ref(false)

const servers = computed(() => ide.settings.value.mcpServers ?? [])

const presets = [
  {
    name: 'filesystem',
    command: 'npx',
    args: '-y\n@modelcontextprotocol/server-filesystem\n.',
    env: ''
  },
  {
    name: 'fetch',
    command: 'uvx',
    args: 'mcp-server-fetch',
    env: ''
  },
  {
    name: 'sqlite',
    command: 'uvx',
    args: 'mcp-server-sqlite\n--db-path\n./demo.sqlite',
    env: ''
  }
]

function statusOf(name: string) {
  const session = mcp.sessions.value[name]
  if (!session) return 'idle'
  if (session.busy) return 'connecting'
  if (session.error) return 'error'
  return 'connected'
}

function sessionOf(name: string) {
  return mcp.sessions.value[name]
}

async function toggle(name: string) {
  const config = servers.value.find((s) => s.name === name)
  if (!config) return
  if (statusOf(name) === 'connected') {
    await mcp.disconnect(name)
    return
  }
  await mcp.connect(config)
  if (!sessionOf(name)?.error) expanded.value[name] = true
}

function openAdd(preset?: (typeof presets)[number]) {
  editing.value = null
  form.name = preset?.name ?? ''
  form.command = preset?.command ?? 'npx'
  form.args = preset?.args ?? ''
  form.env = preset?.env ?? ''
  formError.value = ''
  showAdd.value = true
}

function openEdit(config: McpServerConfig) {
  editing.value = config
  form.name = config.name
  form.command = config.command
  form.args = (config.args ?? []).join('\n')
  form.env = Object.entries(config.env ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  formError.value = ''
  showAdd.value = true
}

async function saveServer() {
  const name = form.name.trim()
  const command = form.command.trim()
  if (!name || !command) {
    formError.value = 'Name and command are required.'
    return
  }
  if (!editing.value && servers.value.some((s) => s.name === name)) {
    formError.value = 'A server with that name already exists.'
    return
  }
  const env: Record<string, string> = {}
  for (const line of form.env.split('\n')) {
    const idx = line.indexOf('=')
    if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  const config: McpServerConfig = {
    id: editing.value?.id || crypto.randomUUID(),
    name,
    command,
    args: form.args
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    env,
    enabled: true
  }
  await mcp.saveConfig(config)
  showAdd.value = false
  ide.notify(`${name} saved`, 'success')
}

function removeServer(name: string) {
  mcp.removeConfig(name)
  ide.notify(`${name} removed`)
}

function openTool(server: string, tool: McpTool) {
  activeTool.value = { server, tool }
  const properties =
    (tool.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {}
  const sample: Record<string, unknown> = {}
  for (const key of Object.keys(properties)) sample[key] = ''
  toolArgs.value = JSON.stringify(sample, null, 2)
  toolResult.value = ''
  toolError.value = ''
}

async function runTool() {
  if (!activeTool.value) return
  runningTool.value = true
  toolResult.value = ''
  toolError.value = ''
  try {
    const parsed = toolArgs.value.trim() ? JSON.parse(toolArgs.value) : {}
    const result = await mcp.callTool(activeTool.value.server, activeTool.value.tool.name, parsed)
    toolResult.value = JSON.stringify(result, null, 2)
  } catch (err) {
    toolError.value = String(err)
  } finally {
    runningTool.value = false
  }
}
</script>

<template>
  <div class="pane">
    <div class="sidebar-header">
      <span class="sidebar-title">MCP Servers</span>
      <div class="sidebar-actions">
        <button class="icon-btn" title="Add server" @click="openAdd()">
          <Plus :size="14" />
        </button>
      </div>
    </div>

    <div class="sidebar-body">
      <div v-if="!servers.length" class="mcp-empty">
        <PlugZap :size="24" :stroke-width="1.4" style="opacity: 0.4" />
        <p>No MCP servers configured.</p>
        <span class="hint" style="text-align: center">
          Connect tool servers over stdio. Kodra performs the initialize handshake and
          exposes their tools to the agent.
        </span>
      </div>

      <div v-for="server in servers" :key="server.name" class="mcp-server">
        <div class="mcp-head">
          <span class="status-dot" :class="statusOf(server.name)" />
          <button class="mcp-name" @click="expanded[server.name] = !expanded[server.name]">
            {{ server.name }}
            <ChevronDown
              :size="11"
              :style="{ transform: expanded[server.name] ? 'rotate(180deg)' : '' }"
            />
          </button>
          <button
            class="icon-btn"
            :title="statusOf(server.name) === 'connected' ? 'Disconnect' : 'Connect'"
            @click="toggle(server.name)"
          >
            <Loader2 v-if="statusOf(server.name) === 'connecting'" :size="12" class="spin" />
            <Plug v-else-if="statusOf(server.name) !== 'connected'" :size="12" />
            <Check v-else :size="12" style="color: var(--green)" />
          </button>
        </div>

        <div class="mcp-meta">{{ server.command }} {{ (server.args ?? []).join(' ') }}</div>

        <div v-if="sessionOf(server.name)?.error" class="mcp-error">
          {{ sessionOf(server.name)?.error }}
        </div>

        <div v-if="expanded[server.name]" class="mcp-body">
          <div
            v-if="statusOf(server.name) !== 'connected'"
            class="hint"
            style="padding: 4px 2px"
          >
            Connect to load tools.
          </div>
          <div
            v-else-if="!sessionOf(server.name)?.tools?.length"
            class="hint"
            style="padding: 4px 2px"
          >
            This server reports no tools.
          </div>
          <button
            v-for="tool in sessionOf(server.name)?.tools ?? []"
            :key="tool.name"
            class="mcp-tool"
            :title="tool.description"
            @click="openTool(server.name, tool)"
          >
            <Play :size="10" />
            <span class="tool-name">{{ tool.name }}</span>
          </button>
          <div class="mcp-actions">
            <button class="btn ghost sm" @click="openEdit(server)">Edit</button>
            <button class="btn ghost sm danger" @click="removeServer(server.name)">
              <Trash2 :size="11" /> Remove
            </button>
          </div>
        </div>
      </div>

      <div v-if="servers.length" class="section-label" style="margin-top: 14px">Quick add</div>
      <button
        v-for="preset in presets"
        :key="preset.name"
        class="preset"
        :disabled="servers.some((s) => s.name === preset.name)"
        @click="openAdd(preset)"
      >
        <Server :size="12" /> {{ preset.name }}
      </button>
    </div>

    <Teleport to="body">
      <div v-if="showAdd" class="overlay" @click.self="showAdd = false">
        <div class="modal" style="width: min(560px, 94vw)">
          <div class="modal-head">
            <Server :size="15" />
            <h2>{{ editing ? 'Edit' : 'Add' }} MCP server</h2>
            <div style="flex: 1" />
            <button class="icon-btn" @click="showAdd = false"><X :size="15" /></button>
          </div>
          <div class="modal-body" style="display: flex; flex-direction: column; gap: 12px">
            <div class="field">
              <label>Name</label>
              <input v-model="form.name" class="input" placeholder="filesystem" />
            </div>
            <div class="field">
              <label>Command</label>
              <input v-model="form.command" class="input" spellcheck="false" placeholder="npx" />
            </div>
            <div class="field">
              <label>Arguments · one per line</label>
              <textarea
                v-model="form.args"
                class="input"
                rows="4"
                spellcheck="false"
                placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;."
              />
            </div>
            <div class="field">
              <label>Environment · KEY=value per line</label>
              <textarea v-model="form.env" class="input" rows="2" spellcheck="false" />
            </div>
            <div v-if="formError" class="hint" style="color: var(--red)">{{ formError }}</div>
            <div class="callout">
              Kodra speaks the stdio transport: newline-delimited JSON-RPC, protocol 2024-11-05.
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn ghost" @click="showAdd = false">Cancel</button>
            <div style="flex: 1" />
            <button class="btn primary" @click="saveServer">Save server</button>
          </div>
        </div>
      </div>

      <div v-if="activeTool" class="overlay" @click.self="activeTool = null">
        <div class="modal" style="width: min(680px, 94vw); max-height: 84vh">
          <div class="modal-head">
            <Play :size="14" />
            <h2>{{ activeTool.tool.name }}</h2>
            <span class="hint">{{ activeTool.server }}</span>
            <div style="flex: 1" />
            <button class="icon-btn" @click="activeTool = null"><X :size="15" /></button>
          </div>
          <div class="modal-body" style="display: flex; flex-direction: column; gap: 10px">
            <p class="hint" style="margin: 0">{{ activeTool.tool.description }}</p>
            <div class="field">
              <label>Arguments (JSON)</label>
              <textarea v-model="toolArgs" class="input code" rows="6" spellcheck="false" />
            </div>
            <div v-if="toolError" class="hint" style="color: var(--red)">{{ toolError }}</div>
            <div v-if="toolResult" class="field">
              <label>Result</label>
              <pre class="result">{{ toolResult }}</pre>
            </div>
          </div>
          <div class="modal-foot">
            <div style="flex: 1" />
            <button class="btn primary" :disabled="runningTool" @click="runTool">
              <Loader2 v-if="runningTool" :size="12" class="spin" />
              <Play v-else :size="12" />
              Run tool
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.mcp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 34px 14px;
  color: var(--text-faint);
  font-size: 12px;
  text-align: center;
}
.mcp-empty p {
  margin: 0;
}
.mcp-server {
  padding: 7px 6px;
  border-bottom: 1px solid var(--border);
}
.mcp-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--text-faint);
  flex: 0 0 auto;
}
.status-dot.connected {
  background: var(--green);
  box-shadow: 0 0 6px color-mix(in srgb, var(--green) 60%, transparent);
}
.status-dot.error {
  background: var(--red);
}
.status-dot.connecting {
  background: var(--accent);
  animation: pulse 1s infinite alternate;
}
@keyframes pulse {
  to {
    opacity: 0.35;
  }
}
.mcp-name {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  border: 0;
  background: transparent;
  color: var(--text-dim);
  font-size: 11.5px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}
.mcp-meta {
  padding: 1px 0 0 12px;
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mcp-error {
  margin: 5px 0 0 12px;
  padding: 5px 7px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--red) 10%, transparent);
  color: var(--red);
  font-family: var(--font-mono);
  font-size: 9.5px;
  word-break: break-word;
}
.mcp-body {
  padding: 4px 0 2px 8px;
}
.mcp-tool {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 3px 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10.5px;
  text-align: left;
  cursor: pointer;
}
.mcp-tool:hover {
  background: var(--glass);
  color: var(--accent);
}
.mcp-actions {
  display: flex;
  gap: 4px;
  padding: 5px 2px 2px;
}
.preset {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}
.preset:hover:not(:disabled) {
  background: var(--glass);
  color: var(--text);
}
.preset:disabled {
  opacity: 0.35;
  cursor: default;
}
.code {
  font-family: var(--font-mono);
  font-size: 11px;
}
.result {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-2);
  font-family: var(--font-mono);
  font-size: 10.5px;
  line-height: 1.55;
  color: var(--text-dim);
  white-space: pre-wrap;
  word-break: break-word;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
