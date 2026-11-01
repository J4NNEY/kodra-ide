<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronDown, Eraser, Plus, SquareTerminal, Trash2, X } from 'lucide-vue-next'
import { call } from '../lib/api'
import type { TerminalShellInfo } from '../lib/types'
import { useTerminalEpoch } from '../composables/useCommands'
import ProblemsPanel from './ProblemsPanel.vue'
import TaskOutput from './TaskOutput.vue'
import TestOutput from './TestOutput.vue'

const ide = useIde()
const lsp = useLsp()
const tests = useTests()
const tasks = useTasks()
const { lines: outputLines, clear: clearOutput } = useOutputLog()
const epoch = useTerminalEpoch()

const MAX_SESSIONS = 8

type TermStatus = 'starting' | 'running' | 'exited'

interface TermSession {
  id: string
  shell: string
  label: string
  status: TermStatus
}

const sessions = ref<TermSession[]>([])
const activeId = ref('')
const shells = ref<TerminalShellInfo[]>([])
const menuOpen = ref(false)

const controls = new Map<string, { clear: () => void; focus: () => void; fitNow: () => void }>()

let bootedPath: string | null = ide.workspace.value?.path ?? null
let sessionSeq = 0

const activeSession = computed(
  () => sessions.value.find((session) => session.id === activeId.value) ?? null
)

const defaultShell = computed<TerminalShellInfo>(() => {
  const configured = ide.settings.value.terminalShell
  const match = shells.value.find((shell) => sameShell(shell.path, configured))
  if (match) return match
  const detected = shells.value.find((shell) => shell.isDefault)
  if (detected) return detected
  return {
    id: 'shell',
    label: prettyShell(configured),
    path: configured,
    isDefault: true
  }
})

function sameShell(a: string, b: string): boolean {
  const name = (value: string) => value.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  return name(a) === name(b)
}

function shellIsCurrent(shell: TerminalShellInfo): boolean {
  return sameShell(shell.path, ide.settings.value.terminalShell)
}

function shellName(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.exe$/i, '') || 'shell'
}

function prettyShell(path: string): string {
  const name = shellName(path).toLowerCase()
  if (name === 'pwsh') return 'PowerShell 7'
  if (name === 'powershell') return 'Windows PowerShell'
  if (name === 'cmd') return 'Command Prompt'
  if (name === 'wsl') return 'WSL'
  if (name === 'bash') return 'Bash'
  return name
}

async function loadShells() {
  try {
    shells.value = await call<TerminalShellInfo[]>('terminal_shells')
  } catch (err) {
    console.warn('[kudo] could not list shells', err)
  }
}

function controlRef(id: string) {
  return (el: unknown) => {
    if (el) {
      controls.set(id, el as { clear: () => void; focus: () => void; fitNow: () => void })
    } else {
      controls.delete(id)
    }
  }
}

function newSession(shell: TerminalShellInfo = defaultShell.value) {
  if (sessions.value.length >= MAX_SESSIONS) {
    ide.notify(`At most ${MAX_SESSIONS} terminal sessions can run at once`, 'error')
    return
  }
  const path = shell.path || ide.settings.value.terminalShell
  const name = shell.label || prettyShell(path)
  let label = name
  let suffix = 1
  while (sessions.value.some((session) => session.label === label)) {
    suffix++
    label = `${name} (${suffix})`
  }
  const id = `kudo-${Date.now().toString(36)}-${++sessionSeq}`
  sessions.value = [
    ...sessions.value,
    {
      id,
      shell: path,
      label,
      status: 'starting'
    }
  ]
  activeId.value = id
  menuOpen.value = false
  ide.panelTab.value = 'terminal'
  ide.panelVisible.value = true
  void nextTick(() => controls.get(id)?.focus())
}

function ensureSession() {
  if (!sessions.value.length) newSession()
}

function selectSession(id: string) {
  activeId.value = id
  ide.panelTab.value = 'terminal'
  void nextTick(() => {
    const control = controls.get(id)
    control?.fitNow()
    control?.focus()
  })
}

function closeSession(id: string) {
  const index = sessions.value.findIndex((session) => session.id === id)
  if (index < 0) return
  controls.delete(id)
  sessions.value = sessions.value.filter((session) => session.id !== id)
  if (activeId.value === id) {
    const neighbour = sessions.value[index] ?? sessions.value[index - 1] ?? null
    activeId.value = neighbour?.id ?? ''
    if (neighbour) void nextTick(() => controls.get(neighbour.id)?.focus())
  }
}

function onStatus(id: string, status: 'running' | 'exited') {
  sessions.value = sessions.value.map((session) =>
    session.id === id ? { ...session, status } : session
  )
}

function clearActive() {
  controls.get(activeId.value)?.clear()
}

async function killAll() {
  await call('pty_kill_all').catch(() => {})
  sessions.value = []
  activeId.value = ''
}

async function maybeBoot() {
  if (!ide.ready.value) return
  if (!ide.panelVisible.value || ide.panelTab.value !== 'terminal') return
  await nextTick()
  ensureSession()
}

function onClearEvent() {
  clearActive()
}

function onCloseEvent() {
  if (activeId.value) closeSession(activeId.value)
}

function onDocClick(event: MouseEvent) {
  if (!menuOpen.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('.term-shell-wrap')) return
  menuOpen.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && menuOpen.value) menuOpen.value = false
}

function stamp(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour12: false })
}

onMounted(async () => {
  window.addEventListener('kudo:terminal-clear', onClearEvent)
  window.addEventListener('kudo:terminal-close', onCloseEvent)
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKeydown)
  await loadShells()
  await maybeBoot()
})

onBeforeUnmount(() => {
  window.removeEventListener('kudo:terminal-clear', onClearEvent)
  window.removeEventListener('kudo:terminal-close', onCloseEvent)
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKeydown)
  void call('pty_kill_all').catch(() => {})
})

watch(
  () => ide.ready.value,
  (ready) => {
    if (ready) void maybeBoot()
  }
)

watch(epoch, () => {
  if (ide.panelVisible.value) newSession()
})

watch(
  () => ide.panelVisible.value,
  async (visible) => {
    if (!visible) return
    await nextTick()
    if (!sessions.value.length) {
      ensureSession()
      return
    }
    const control = controls.get(activeId.value)
    control?.fitNow()
    control?.focus()
  }
)

watch(
  () => ide.panelTab.value,
  async (tab) => {
    if (tab !== 'terminal') return
    await nextTick()
    if (!sessions.value.length) {
      ensureSession()
      return
    }
    const control = controls.get(activeId.value)
    control?.fitNow()
    control?.focus()
  }
)

watch(
  () => ide.workspace.value?.path,
  async (next) => {
    if (next === bootedPath) return
    bootedPath = next ?? null
    // Switching folders must release the old PTYs: Windows keeps the working
    // directory locked, which blocks removing git worktrees.
    await killAll()
    await maybeBoot()
  }
)
</script>

<template>
  <section class="bottom-panel" :class="{ hidden: !ide.panelVisible.value }">
    <div class="panel-head">
      <button
        class="panel-tab"
        :class="{ active: ide.panelTab.value === 'terminal' }"
        @click="ide.panelTab.value = 'terminal'"
      >
        <SquareTerminal :size="13" /> Terminal
      </button>
      <button
        class="panel-tab"
        :class="{ active: ide.panelTab.value === 'problems' }"
        @click="ide.panelTab.value = 'problems'"
      >
        Problems <span class="tab-count">{{ lsp.allDiagnostics.value.length }}</span>
      </button>
      <button
        class="panel-tab"
        :class="{ active: ide.panelTab.value === 'output' }"
        @click="ide.panelTab.value = 'output'"
      >
        Output
      </button>
      <button
        class="panel-tab panel-tab-tests"
        :class="{ active: ide.panelTab.value === 'tests' }"
        @click="ide.panelTab.value = 'tests'"
      >
        Tests
        <span v-if="tests.active.value" class="dot-live" />
      </button>
      <button
        class="panel-tab panel-tab-tasks"
        :class="{ active: ide.panelTab.value === 'tasks' }"
        @click="ide.panelTab.value = 'tasks'"
      >
        Tasks
        <span v-if="tasks.active.value" class="dot-live" />
      </button>
      <button
        class="panel-tab"
        :class="{ active: ide.panelTab.value === 'network' }"
        @click="ide.panelTab.value = 'network'"
      >
        Network
      </button>

      <div style="flex: 1" />

      <span v-if="activeSession?.status === 'running'" class="dot-live" style="margin-right: 6px" />
      <div class="term-shell-wrap">
        <button class="icon-btn term-new" title="New terminal" @click="newSession()">
          <Plus :size="14" />
        </button>
        <button
          class="icon-btn term-shell-btn"
          title="Choose shell"
          @click.stop="menuOpen = !menuOpen"
        >
          <ChevronDown :size="11" />
        </button>
        <div v-if="menuOpen" class="term-shell-menu">
          <div class="shell-menu-head">New terminal</div>
          <button
            v-for="shell in shells"
            :key="shell.id"
            class="shell-item"
            :class="{ active: shellIsCurrent(shell) }"
            :title="shell.path"
            @click="newSession(shell)"
          >
            <span class="shell-item-name">{{ shell.label }}</span>
            <span v-if="shellIsCurrent(shell)" class="shell-item-badge">default</span>
          </button>
          <div v-if="!shells.length" class="shell-item empty">No shells detected</div>
        </div>
      </div>
      <button class="icon-btn" title="Clear" @click="clearActive">
        <Eraser :size="14" />
      </button>
      <button class="icon-btn" title="Close panel" @click="ide.panelVisible.value = false">
        <X :size="14" />
      </button>
    </div>

    <div v-show="ide.panelTab.value === 'terminal'" class="term-tabs">
      <button
        v-for="session in sessions"
        :key="session.id"
        class="term-tab"
        :class="{ active: session.id === activeId }"
        :title="session.shell"
        :data-session-id="session.id"
        :data-status="session.status"
        @click="selectSession(session.id)"
      >
        <span class="term-dot" :class="session.status" />
        <span class="term-tab-label">{{ session.label }}</span>
        <span class="term-close" title="Close session" @click.stop="closeSession(session.id)">
          <X :size="10" />
        </span>
      </button>
      <button class="icon-btn term-tab-add" title="New terminal" @click="newSession()">
        <Plus :size="12" />
      </button>
    </div>

    <div v-show="ide.panelTab.value === 'terminal'" class="term-body">
      <div v-if="!sessions.length" class="term-empty">
        <SquareTerminal :size="22" />
        <div class="term-empty-title">No terminal sessions</div>
        <div class="term-empty-hint">
          Start a shell in the current workspace. Sessions stay alive while you switch tabs.
        </div>
        <div class="term-empty-actions">
          <button class="btn primary sm term-empty-new" @click="newSession()">
            <Plus :size="12" /> New terminal
          </button>
          <button
            v-for="shell in shells"
            :key="shell.id"
            class="btn ghost sm term-empty-shell"
            @click="newSession(shell)"
          >
            {{ shell.label }}
          </button>
        </div>
      </div>
      <div
        v-for="session in sessions"
        v-show="session.id === activeId"
        :key="session.id"
        class="term-slot"
        :data-session-id="session.id"
        :data-shell="session.shell"
      >
        <TerminalSession
          :ref="controlRef(session.id)"
          :session-id="session.id"
          :shell="session.shell"
          :active="session.id === activeId"
          @status="onStatus(session.id, $event)"
        />
      </div>
    </div>

    <div v-if="ide.panelTab.value === 'problems'" class="panel-body">
      <ProblemsPanel />
    </div>

    <div v-if="ide.panelTab.value === 'output'" class="panel-body">
      <div class="out-head">
        <span>Channel: terminal</span>
        <div style="flex: 1" />
        <button class="btn ghost sm" @click="clearOutput()">
          <Trash2 :size="12" /> Clear
        </button>
      </div>
      <div v-for="line in outputLines" :key="line.id" class="out-line">
        <span class="stamp">{{ stamp(line.time) }}</span>
        <span class="channel">[{{ line.channel }}]</span>
        <span>{{ line.text }}</span>
      </div>
      <div v-if="!outputLines.length" class="panel-empty">No output yet.</div>
    </div>

    <NetworkPanel v-if="ide.panelTab.value === 'network'" />
    <TestOutput v-if="ide.panelTab.value === 'tests'" />
    <TaskOutput v-if="ide.panelTab.value === 'tasks'" />
  </section>
</template>

<style scoped>
.tab-count {
  font-size: 9.5px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--glass);
  color: var(--text-faint);
}
.panel-empty {
  padding: 12px 4px;
  color: var(--text-faint);
  font-size: 11.5px;
}
.out-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 4px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border);
  color: var(--text-faint);
  font-size: 10.5px;
}
.out-line {
  display: flex;
  gap: 8px;
  white-space: pre-wrap;
  word-break: break-word;
}
.out-line .stamp {
  color: var(--text-faint);
}
.out-line .channel {
  color: var(--accent);
}
</style>
