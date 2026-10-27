<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import {
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  History,
  MessagesSquare,
  Settings2,
  Sparkles,
  Undo2,
  Wrench
} from 'lucide-vue-next'

const ide = useIde()
const chat = useChat()
const checkpoints = useCheckpoints()
const settingsTab = useState<string>('kudo:settings-tab', () => 'appearance')

const recent = computed(() => chat.messages.value.slice(-4).reverse())

function loadCheckpoints() {
  if (ide.workspace.value) checkpoints.list(8)
}

onMounted(loadCheckpoints)
watch(() => ide.workspace.value?.path, loadCheckpoints)
watch(() => checkpoints.turnId.value, (id) => {
  if (id) checkpoints.list(8)
})

function checkpointTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

async function restoreCheckpoint(id: string) {
  const result = await checkpoints.restore(id)
  if (!result) return
  for (const message of chat.messages.value) {
    if (message.checkpointId === id) message.restoredAt = Date.now()
  }
  chat.persist()
}

const tools = [
  { name: 'list_dir', description: 'Browse workspace folders' },
  { name: 'read_file', description: 'Read file contents' },
  { name: 'write_file', description: 'Create or overwrite files' },
  { name: 'search_files', description: 'Fuzzy-find file paths' },
  { name: 'grep', description: 'Search text in the workspace' },
  { name: 'run_command', description: 'Run a shell command' }
]

const prompts = [
  'Explain the file I have open',
  'Find a bug and fix it',
  'Write tests for the active file',
  'Summarise this repository'
]

function ask(prompt: string) {
  ide.chatOpen.value = true
  chat.send(prompt)
  window.dispatchEvent(new CustomEvent('kudo:focus-composer'))
}

function openSettings() {
  settingsTab.value = 'ai'
  ide.settingsOpen.value = true
}

function snippet(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 64)
}
</script>

<template>
  <div class="pane">
    <div class="sidebar-header">
      <span class="sidebar-title">Agent</span>
      <div class="sidebar-actions">
        <button class="icon-btn" title="Agent settings" @click="openSettings">
          <Settings2 :size="14" />
        </button>
      </div>
    </div>

    <div class="sidebar-body">
      <div class="agent-card">
        <div class="agent-row">
          <div class="agent-mark"><Bot :size="15" /></div>
          <div class="col">
            <span class="agent-name">{{ ide.settings.value.ai.model }}</span>
            <span class="agent-meta">
              {{ ide.settings.value.ai.provider }} · temp {{ ide.settings.value.ai.temperature }}
            </span>
          </div>
          <span class="state">
            <CircleDot v-if="chat.busy.value" :size="12" style="color: var(--accent)" />
            <Check v-else :size="12" style="color: var(--green)" />
          </span>
        </div>
        <div class="agent-stats">
          <div class="stat">
            <span class="stat-value">{{ chat.messages.value.filter((m) => m.role === 'user').length }}</span>
            <span class="stat-label">turns</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ chat.messages.value.filter((m) => m.role === 'tool').length }}</span>
            <span class="stat-label">tool calls</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ ide.tabs.value.length }}</span>
            <span class="stat-label">open files</span>
          </div>
        </div>
        <button class="btn primary sm" style="width: 100%" @click="ide.chatOpen.value = true">
          <MessagesSquare :size="13" /> Open agent panel
        </button>
      </div>

      <div class="section-label">Quick prompts</div>
      <button v-for="prompt in prompts" :key="prompt" class="quick" @click="ask(prompt)">
        <Sparkles :size="12" style="color: var(--accent)" />
        <span>{{ prompt }}</span>
        <ChevronRight :size="12" style="opacity: 0.5" />
      </button>

      <div class="section-label">
        <Wrench :size="10" style="vertical-align: -1px" /> Tools
        <span class="badge" :class="{ off: !ide.settings.value.ai.agentMode }">
          {{ ide.settings.value.ai.agentMode ? 'enabled' : 'disabled' }}
        </span>
      </div>
      <div class="tool-list">
        <div v-for="tool in tools" :key="tool.name" class="tool" :class="{ muted: !ide.settings.value.ai.agentMode }">
          <span class="tool-name">{{ tool.name }}</span>
          <span class="tool-desc">{{ tool.description }}</span>
        </div>
      </div>

      <template v-if="checkpoints.recent.value.length">
        <div class="section-label">
          <History :size="10" style="vertical-align: -1px" /> Recent changes
        </div>
        <div v-for="entry in checkpoints.recent.value" :key="entry.id" class="checkpoint-row">
          <div class="cp-main">
            <span class="cp-label">{{ entry.label || 'Agent edit' }}</span>
            <span class="cp-meta">
              {{ entry.files.length }} {{ entry.files.length === 1 ? 'file' : 'files' }} ·
              {{ checkpointTime(entry.createdAt) }}
              <span v-if="entry.files.every((f) => !f.changed)" class="cp-state">· restored</span>
            </span>
          </div>
          <button
            class="icon-btn"
            title="Restore these files"
            :disabled="checkpoints.loading.value"
            @click="restoreCheckpoint(entry.id)"
          >
            <Undo2 :size="12" />
          </button>
        </div>
      </template>

      <template v-if="recent.length">
        <div class="section-label">Recent activity</div>
        <div v-for="message in recent" :key="message.id" class="recent">
          <span class="role">{{ message.role }}</span>
          <span class="text">{{ snippet(message.content) || '…' }}</span>
        </div>
      </template>

      <div class="foot-hint">
        Write actions and shell commands ask for confirmation unless auto-approve is enabled in
        settings.
      </div>
    </div>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.agent-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
  margin-bottom: 6px;
}
.agent-row {
  display: flex;
  align-items: center;
  gap: 9px;
}
.agent-mark {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid #d4a73c33;
}
.col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.agent-name {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-meta {
  font-size: 10px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  border-top: 1px solid var(--border);
  padding-top: 9px;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.stat-value {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text);
}
.stat-label {
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}
.quick {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim);
  font-size: 11.5px;
  cursor: pointer;
}
.quick span {
  flex: 1;
}
.quick:hover {
  background: var(--glass);
  color: var(--text);
}
.section-label .badge {
  margin-left: 4px;
  font-size: 9px;
  text-transform: none;
  letter-spacing: 0;
  padding: 1px 5px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
}
.section-label .badge.off {
  background: var(--glass);
  color: var(--text-faint);
}
.tool-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 2px;
}
.tool {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 5px 7px;
  border-radius: 6px;
  border: 1px solid transparent;
}
.tool:hover {
  background: var(--glass);
}
.tool.muted {
  opacity: 0.45;
}
.tool-name {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--accent);
}
.tool-desc {
  font-size: 10.5px;
  color: var(--text-faint);
}
.checkpoint-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
}
.checkpoint-row:hover {
  background: var(--glass);
  border-color: var(--border);
}
.cp-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}
.cp-label {
  font-size: 11px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp-meta {
  font-size: 10px;
  color: var(--text-faint);
}
.cp-state {
  color: var(--green);
}
.recent {
  display: flex;
  gap: 7px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-muted);
}
.recent:hover {
  background: var(--glass);
}
.recent .role {
  color: var(--text-faint);
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding-top: 2px;
  width: 54px;
  flex: 0 0 auto;
}
.recent .text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.foot-hint {
  margin-top: 12px;
  padding: 8px;
  border-top: 1px solid var(--border);
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--text-faint);
}
</style>
