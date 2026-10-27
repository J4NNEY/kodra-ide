<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
  History,
  Loader2,
  Send,
  Settings2,
  ShieldAlert,
  Square,
  Sparkles,
  Trash2,
  Undo2,
  X
} from 'lucide-vue-next'
import { renderMarkdown } from '../lib/markdown'
import type { ChatMessage } from '../lib/types'
import type { CheckpointSummary } from '../composables/useCheckpoints'

const ide = useIde()
const chat = useChat()
const checkpoints = useCheckpoints()
const settingsTab = useState<string>('kudo:settings-tab', () => 'appearance')

const input = ref('')
const scrollEl = ref<HTMLDivElement | null>(null)
const composerEl = ref<HTMLTextAreaElement | null>(null)
const stick = ref(true)
const expanded = ref<Record<string, boolean>>({})

const providerLabel = computed(() => {
  const ai = ide.settings.value.ai
  switch (ai.provider) {
    case 'anthropic':
      return 'Anthropic'
    case 'demo':
      return 'Demo'
    case 'openai':
      return 'OpenAI-compatible'
    default:
      return ai.provider
  }
})

const visible = computed(() => chat.messages.value.filter((m) => m.role !== 'system'))

const suggestions = [
  'Explain the file I have open',
  'Find a bug in this workspace and fix it',
  'Write tests for the active file',
  'Summarise the repository structure'
]

function render(message: ChatMessage) {
  return renderMarkdown(message.content || '')
}

function toolSummary(message: ChatMessage) {
  const first = message.content.split('\n').find((line) => line.trim())
  return first ? first.slice(0, 140) : ''
}

function send() {
  const text = input.value.trim()
  if (!text || chat.busy.value) return
  input.value = ''
  nextTick(autoSize)
  chat.send(text)
}

function runSuggestion(text: string) {
  input.value = text
  send()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    send()
  }
}

function autoSize() {
  const el = composerEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

function onScroll() {
  const el = scrollEl.value
  if (!el) return
  stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 90
}

async function scrollToBottom(force = false) {
  await nextTick()
  const el = scrollEl.value
  if (!el) return
  if (force || stick.value) el.scrollTop = el.scrollHeight
}

function openAiSettings() {
  settingsTab.value = 'ai'
  ide.settingsOpen.value = true
}

function toggleTool(id: string) {
  expanded.value = { ...expanded.value, [id]: !expanded.value[id] }
}

const restoring = ref<string | null>(null)
const missing = ref<Record<string, boolean>>({})

function checkpointOf(message: ChatMessage): CheckpointSummary | undefined {
  if (!message.checkpointId) return undefined
  return checkpoints.summaries.value[message.checkpointId]
}

function checkpointFiles(message: ChatMessage) {
  return checkpointOf(message)?.files ?? []
}

function filesLabel(message: ChatMessage) {
  if (isExpired(message)) return 'expired'
  const files = checkpointFiles(message)
  if (!files.length) return checkpointOf(message) ? 'no file changes' : 'loading…'
  return files.length === 1 ? '1 file' : `${files.length} files`
}

function isExpired(message: ChatMessage) {
  return !!message.checkpointId && !!missing.value[message.checkpointId]
}

function fileState(file: { existed: boolean; changed: boolean }) {
  if (!file.changed) return { tag: '=', label: 'unchanged' }
  return file.existed ? { tag: 'M', label: 'modified' } : { tag: 'A', label: 'created' }
}

async function restoreCheckpoint(message: ChatMessage) {
  const id = message.checkpointId
  if (!id || restoring.value) return
  restoring.value = id
  const result = await checkpoints.restore(id)
  if (result) {
    message.restoredAt = Date.now()
    chat.persist()
  }
  restoring.value = null
}

watch(
  () => visible.value.map((m) => m.checkpointId ?? '').join(','),
  async () => {
    for (const message of visible.value) {
      const id = message.checkpointId
      if (!id || checkpoints.summaries.value[id] || missing.value[id]) continue
      const summary = await checkpoints.get(id)
      if (!summary) missing.value = { ...missing.value, [id]: true }
    }
  },
  { immediate: true }
)

function focusComposer() {
  composerEl.value?.focus()
}

function newChat() {
  if (chat.busy.value) return
  chat.clear()
}

watch(input, () => nextTick(autoSize))
watch(
  () => [visible.value.length, visible.value.at(-1)?.content, chat.busy.value],
  () => scrollToBottom()
)

onMounted(() => {
  chat.load()
  scrollToBottom(true)
  window.addEventListener('kudo:focus-composer', focusComposer)
})

onBeforeUnmount(() => {
  window.removeEventListener('kudo:focus-composer', focusComposer)
})
</script>

<template>
  <aside class="chat-panel" :class="{ hidden: !ide.chatOpen.value }">
    <div class="chat-head">
      <div class="agent-mark"><Bot :size="14" /></div>
      <div class="col">
        <span class="chat-title">Agent</span>
        <span class="chat-sub">{{ providerLabel }} · {{ ide.settings.value.ai.model }}</span>
      </div>
      <div class="spacer" />
      <span v-if="chat.busy.value" class="live-pill"><Loader2 :size="11" class="spin" /> working</span>
      <button class="icon-btn" title="New chat" @click="newChat">
        <Trash2 :size="14" />
      </button>
      <button class="icon-btn" title="Agent settings" @click="openAiSettings">
        <Settings2 :size="14" />
      </button>
      <button class="icon-btn" title="Hide panel" @click="ide.chatOpen.value = false">
        <X :size="14" />
      </button>
    </div>

    <div ref="scrollEl" class="chat-scroll" @scroll.passive="onScroll">
      <div v-if="!visible.length" class="chat-empty">
        <div class="empty-mark" style="width: 46px; height: 46px; font-size: 18px">
          <Sparkles :size="20" />
        </div>
        <h3>How can I help?</h3>
        <p>
          I can read and edit files, run commands and search the workspace. Every change outside
          this panel asks for your approval first.
        </p>
        <div class="suggestions">
          <button
            v-for="suggestion in suggestions"
            :key="suggestion"
            class="suggestion"
            @click="runSuggestion(suggestion)"
          >
            {{ suggestion }}
            <ChevronRight :size="13" />
          </button>
        </div>
      </div>

      <div
        v-for="message in visible"
        :key="message.id"
        class="msg"
        :class="{
          'msg-user': message.role === 'user',
          'msg-assistant': message.role === 'assistant',
          'msg-error': message.error
        }"
      >
        <template v-if="message.role === 'tool'">
          <div class="tool-card">
            <button class="tool-head" @click="toggleTool(message.id)">
              <component :is="expanded[message.id] ? ChevronDown : ChevronRight" :size="12" />
              <span class="tool-name">{{ message.name }}</span>
              <span class="tool-args">{{ toolSummary(message) }}</span>
            </button>
            <pre v-if="expanded[message.id]" class="tool-body">{{ message.content }}</pre>
          </div>
        </template>

        <template v-else>
          <div class="msg-meta">
            <span>{{ message.role === 'user' ? 'You' : providerLabel }}</span>
            <span>·</span>
            <span>{{ new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</span>
            <span v-if="message.pending" class="pending-dot" />
          </div>
          <div v-if="message.role === 'user'" class="bubble">{{ message.content }}</div>
          <div v-else class="bubble md" v-html="render(message)" />
          <div v-if="message.toolCalls?.length" class="call-chips">
            <span v-for="call in message.toolCalls" :key="call.id" class="call-chip">
              {{ call.name }}
            </span>
          </div>
          <div v-if="message.checkpointId" class="checkpoint-card">
            <div class="checkpoint-head">
              <History :size="13" />
              <span class="checkpoint-title">File checkpoint</span>
              <span class="checkpoint-count">· {{ filesLabel(message) }}</span>
              <div class="spacer" />
              <span v-if="message.restoredAt" class="checkpoint-restored">
                <Check :size="11" /> Restored
              </span>
              <button
                v-else
                class="btn ghost sm"
                :disabled="!!restoring || !checkpointOf(message)"
                title="Put these files back the way they were before this reply"
                @click="restoreCheckpoint(message)"
              >
                <Loader2 v-if="restoring === message.checkpointId" :size="11" class="spin" />
                <Undo2 v-else :size="11" />
                Restore
              </button>
            </div>
            <ul v-if="checkpointFiles(message).length" class="checkpoint-files">
              <li v-for="file in checkpointFiles(message)" :key="file.path">
                <span class="file-state" :class="fileState(file).tag === 'A' ? 'added' : ''">
                  {{ fileState(file).tag }}
                </span>
                <span class="file-rel" :title="file.path">{{ file.rel }}</span>
                <span class="file-tag">{{
                  message.restoredAt ? 'reverted' : fileState(file).label
                }}</span>
              </li>
            </ul>
            <p class="checkpoint-note">
              <template v-if="message.restoredAt">
                These files were rolled back to their state before this reply.
              </template>
              <template v-else-if="isExpired(message)">
                This checkpoint is no longer stored on disk.
              </template>
              <template v-else>Snapshot taken before the agent wrote these files.</template>
            </p>
          </div>
        </template>
      </div>
    </div>

    <div class="composer">
      <div v-if="chat.approvals.value.length" class="approvals">
        <div v-for="approval in chat.approvals.value" :key="approval.id" class="approval-card">
          <div class="approval-head">
            <ShieldAlert :size="13" />
            <span>{{ approval.title }}</span>
            <span class="approval-tool">{{ approval.name }}</span>
          </div>
          <pre class="approval-detail">{{ approval.detail.slice(0, 1200) }}</pre>
          <div class="approval-actions">
            <button class="btn ghost sm" @click="chat.resolveApproval(approval.id, false)">
              Deny
            </button>
            <button class="btn primary sm" @click="chat.resolveApproval(approval.id, true)">
              Allow
            </button>
          </div>
        </div>
      </div>
      <div class="composer-box">
        <textarea
          ref="composerEl"
          v-model="input"
          rows="2"
          placeholder="Ask Kudo to build, explain or fix something…"
          spellcheck="false"
          @keydown="onKeydown"
          @input="autoSize"
        />
        <div class="composer-row">
          <button class="model-pill" title="Change model" @click="openAiSettings">
            <Sparkles :size="11" />
            {{ ide.settings.value.ai.model }}
          </button>
          <button
            class="model-pill"
            :style="ide.settings.value.ai.agentMode ? 'color:var(--accent);border-color:#d4a73c55' : ''"
            :title="ide.settings.value.ai.agentMode ? 'Tool calling is on' : 'Tool calling is off'"
            @click="openAiSettings"
          >
            tools {{ ide.settings.value.ai.agentMode ? 'on' : 'off' }}
          </button>
          <div class="spacer" />
          <button v-if="chat.busy.value" class="btn danger sm" @click="chat.stop()">
            <Square :size="11" /> Stop
          </button>
          <button
            v-else
            class="btn primary sm"
            :disabled="!input.trim()"
            title="Send (Enter)"
            @click="send"
          >
            <Send :size="12" /> Send
          </button>
        </div>
      </div>
      <div class="composer-hint">
        <span><CornerDownLeft :size="10" /> Enter to send · Shift+Enter for a new line</span>
        <span v-if="!ide.settings.value.ai.apiKey && ide.settings.value.ai.provider !== 'demo'" class="warn">
          no API key
        </span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}
.agent-mark {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid #d4a73c33;
  flex: 0 0 auto;
}
.live-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 999px;
  padding: 2px 7px;
}
.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 4px;
  text-align: center;
}
.chat-empty h3 {
  margin: 6px 0 0;
  font-size: 14px;
  font-weight: 600;
}
.chat-empty p {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-faint);
  max-width: 280px;
}
.suggestions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  margin-top: 8px;
}
.suggestion {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-dim);
  font-size: 11.5px;
  cursor: pointer;
}
.suggestion:hover {
  border-color: var(--border-strong);
  background: var(--surface-3);
  color: var(--text);
}
.pending-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse 0.9s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.2;
  }
}
.tool-head {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  padding: 0;
  color: inherit;
  cursor: pointer;
  font: inherit;
  min-width: 0;
  text-align: left;
}
.tool-name {
  color: var(--accent);
  font-weight: 600;
  flex: 0 0 auto;
}
.tool-args {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}
.tool-body {
  margin: 4px 0 0;
  padding: 8px;
  max-height: 220px;
  overflow: auto;
  background: var(--surface-0);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 10.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.call-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.call-chip {
  font-size: 10px;
  font-family: var(--font-mono);
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
}
.checkpoint-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
}
.checkpoint-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text);
  min-width: 0;
}
.checkpoint-head svg {
  color: var(--accent);
  flex: 0 0 auto;
}
.checkpoint-title {
  font-weight: 600;
}
.checkpoint-count {
  color: var(--text-faint);
  font-size: 10.5px;
  white-space: nowrap;
}
.checkpoint-restored {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10.5px;
  color: var(--green);
  white-space: nowrap;
}
.checkpoint-files {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 132px;
  overflow: auto;
}
.checkpoint-files li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-dim);
  min-width: 0;
}
.file-state {
  width: 14px;
  flex: 0 0 auto;
  text-align: center;
  border-radius: 3px;
  background: var(--surface-3);
  color: var(--text-muted);
  font-weight: 600;
}
.file-state.added {
  color: var(--green);
}
.file-rel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-tag {
  margin-left: auto;
  flex: 0 0 auto;
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 9.5px;
}
.checkpoint-note {
  margin: 0;
  font-size: 10px;
  color: var(--text-faint);
}
.approvals {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.approval-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--accent) 7%, var(--surface-2));
}
.approval-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text);
}
.approval-head svg {
  color: var(--accent);
  flex: 0 0 auto;
}
.approval-tool {
  margin-left: auto;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 9.5px;
}
.approval-detail {
  margin: 0;
  max-height: 110px;
  overflow: auto;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-0);
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.approval-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.composer-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  color: var(--text-faint);
  padding: 0 2px;
}
.composer-hint span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.warn {
  color: var(--orange);
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
