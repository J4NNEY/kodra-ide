<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import '@xterm/xterm/css/xterm.css'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Eraser, Plus, SquareTerminal, Trash2, X } from 'lucide-vue-next'
import { call, isTauri, listen } from '../lib/api'
import { useTerminalEpoch } from '../composables/useCommands'

const ide = useIde()
const { lines: outputLines, push: pushOutput, clear: clearOutput } = useOutputLog()
const epoch = useTerminalEpoch()
const effectiveTheme = useEffectiveTheme()

const host = ref<HTMLDivElement | null>(null)
const status = ref<'idle' | 'running' | 'exited'>('idle')

let term: Terminal | null = null
let fit: FitAddon | null = null
let observer: ResizeObserver | null = null
let unlisteners: Array<() => void> = []
let sessionId = ''
let mockBuffer = ''
let bootedPath: string | null = null

function xtermTheme() {
  const accent = ide.settings.value.accent

  if (effectiveTheme.value === 'light') {
    return {
      background: 'rgba(0,0,0,0)',
      foreground: '#24292f',
      cursor: accent,
      cursorAccent: '#ffffff',
      selectionBackground: `${accent}33`,
      black: '#24292f',
      red: '#b31d28',
      green: '#2f8a4c',
      yellow: '#9a6700',
      blue: '#0b5cad',
      magenta: '#8250df',
      cyan: '#1b7c83',
      white: '#f6f8fa',
      brightBlack: '#57606a',
      brightRed: '#d1242f',
      brightGreen: '#1a7f37',
      brightYellow: '#bf8700',
      brightBlue: '#0969da',
      brightMagenta: '#a475f9',
      brightCyan: '#3192aa',
      brightWhite: '#ffffff'
    }
  }

  return {
    background: 'rgba(0,0,0,0)',
    foreground: '#e6e6e9',
    cursor: accent,
    cursorAccent: '#0a0a0a',
    selectionBackground: `${accent}44`,
    black: '#1a1a1c',
    red: '#e4676b',
    green: '#73c991',
    yellow: accent,
    blue: '#6cb6ff',
    magenta: '#c792ea',
    cyan: '#89ddff',
    white: '#e6e6e9',
    brightBlack: '#52525b',
    brightRed: '#ff8b8e',
    brightGreen: '#8fd6a5',
    brightYellow: '#ffc857',
    brightBlue: '#8ec7ff',
    brightMagenta: '#d9b3f5',
    brightCyan: '#a8e9ff',
    brightWhite: '#ffffff'
  }
}

function write(text: string) {
  term?.write(text)
}

/** xterm throws if it is asked to measure a zero-sized or unpainted viewport. */
function safeFit(): boolean {
  const el = host.value
  if (!fit || !el || !el.clientWidth || !el.clientHeight) return false
  try {
    fit.fit()
    return true
  } catch (err) {
    console.warn('[kudo] terminal fit skipped', err)
    return false
  }
}

function promptMock() {
  write('\r\n\x1b[38;5;179mPS\x1b[0m \x1b[38;5;245m' + 'C:\\demo\\kudo-workspace' + '\x1b[0m> ')
}

function mockBanner() {
  write('\x1b[38;5;179mKudo terminal\x1b[0m \x1b[38;5;245m(browser mock)\x1b[0m\r\n')
  write('\x1b[38;5;245mStart the desktop shell with `pnpm desktop` for a real PowerShell session.\x1b[0m')
  promptMock()
}

function handleMockData(data: string) {
  for (const ch of data) {
    if (ch === '\r') {
      write('\r\n')
      const command = mockBuffer.trim()
      mockBuffer = ''
      if (!command) {
        promptMock()
      } else if (command === 'clear' || command === 'cls') {
        write('\x1b[2J\x1b[H')
        promptMock()
      } else if (command === 'help') {
        write('Mock shell — try `clear`, `help`, or run `pnpm desktop`.\r\n')
        promptMock()
      } else {
        write(`\x1b[38;5;245m"${command}" is not available in the browser mock.\x1b[0m\r\n`)
        promptMock()
      }
      continue
    }
    if (ch === '\u007f') {
      if (mockBuffer.length) {
        mockBuffer = mockBuffer.slice(0, -1)
        write('\b \b')
      }
      continue
    }
    if (ch === '\u0003') {
      mockBuffer = ''
      write('^C')
      promptMock()
      continue
    }
    if (ch === '\t') continue
    if (ch >= ' ') {
      mockBuffer += ch
      write(ch)
    }
  }
}

async function onData(data: string) {
  if (!isTauri()) {
    handleMockData(data)
    return
  }
  try {
    await call('pty_write', { id: sessionId, data })
  } catch (err) {
    pushOutput('terminal', String(err))
  }
}

let bootToken = 0

async function disposeCurrent() {
  for (const off of unlisteners) off()
  unlisteners = []
  if (isTauri() && sessionId) {
    await call('pty_kill', { id: sessionId }).catch(() => {})
  }
  sessionId = ''
  observer?.disconnect()
  observer = null
  term?.dispose()
  term = null
  fit = null
  status.value = 'idle'
}

async function teardown() {
  bootToken++
  await disposeCurrent()
}

async function boot() {
  const token = ++bootToken
  await disposeCurrent()
  await nextTick()
  if (token !== bootToken || !host.value) return

  const localId = `kudo-${Math.random().toString(36).slice(2, 9)}`
  sessionId = localId

  const local = new Terminal({
    fontFamily: ide.settings.value.fontFamily,
    fontSize: ide.settings.value.terminalFontSize,
    lineHeight: 1.35,
    cursorBlink: true,
    cursorStyle: 'bar',
    allowProposedApi: true,
    scrollback: 6000,
    theme: xtermTheme()
  })
  term = local

  const localFit = new FitAddon()
  fit = localFit
  local.loadAddon(localFit)
  local.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank')))
  local.open(host.value)
  local.onData(onData)
  bootedPath = ide.workspace.value?.path ?? null

  await new Promise((resolve) => requestAnimationFrame(resolve))
  if (token !== bootToken) return

  safeFit()
  pushOutput('terminal', `session started (${local.cols}x${local.rows})`)

  if (isTauri()) {
    unlisteners.push(
      await listen<{ id: string; data: string }>('pty:data', (payload) => {
        if (payload.id === sessionId) term?.write(payload.data)
      })
    )
    unlisteners.push(
      await listen<{ id: string }>('pty:exit', (payload) => {
        if (payload.id !== sessionId) return
        status.value = 'exited'
        term?.writeln('\r\n\x1b[38;5;245m[process exited]\x1b[0m')
        pushOutput('terminal', 'process exited')
      })
    )

    if (token !== bootToken) return

    try {
      await call('pty_spawn', {
        id: localId,
        shell: ide.settings.value.terminalShell,
        cwd: ide.workspace.value?.path ?? null,
        cols: local.cols,
        rows: local.rows
      })
      status.value = 'running'
      pushOutput('terminal', `spawned ${ide.settings.value.terminalShell}`)
    } catch (err) {
      status.value = 'exited'
      local.writeln(`\x1b[31m${String(err)}\x1b[0m`)
      pushOutput('terminal', String(err))
    }
  } else {
    status.value = 'running'
    mockBanner()
  }

  if (token !== bootToken) return

  observer = new ResizeObserver(() => {
    if (!term || !safeFit()) return
    if (isTauri() && sessionId) {
      call('pty_resize', { id: sessionId, cols: term.cols, rows: term.rows }).catch(() => {})
    }
  })
  if (host.value) observer.observe(host.value)

  // Layout can settle a frame after mount (panel height, scrollbar, fonts).
  setTimeout(() => {
    if (token === bootToken) safeFit()
  }, 150)
}

function clear() {
  term?.clear()
  term?.focus()
}

function restart() {
  boot()
}

function close() {
  ide.panelVisible.value = false
}

function onClearEvent() {
  clear()
}

onMounted(() => {
  if (ide.ready.value) boot()
  window.addEventListener('kudo:terminal-clear', onClearEvent)
})

watch(
  () => ide.ready.value,
  (ready) => {
    if (ready && !term) boot()
  }
)

onBeforeUnmount(() => {
  window.removeEventListener('kudo:terminal-clear', onClearEvent)
  teardown()
})

watch(epoch, () => {
  if (ide.panelVisible.value) boot()
})

watch(
  () => ide.workspace.value?.path,
  (next) => {
    if (next && next !== bootedPath && ide.panelVisible.value) boot()
  }
)

watch(
  () => ide.panelVisible.value,
  async (visible) => {
    if (!visible) return
    await nextTick()
    safeFit()
    term?.focus()
  }
)

watch(
  () => ide.settings.value.terminalFontSize,
  (size) => {
    if (term) {
      term.options.fontSize = size
      nextTick(() => safeFit())
    }
  }
)

watch([effectiveTheme, () => ide.settings.value.accent], () => {
  if (term) term.options.theme = xtermTheme()
})

function stamp(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour12: false })
}
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
        Problems <span class="tab-count">0</span>
      </button>
      <button
        class="panel-tab"
        :class="{ active: ide.panelTab.value === 'output' }"
        @click="ide.panelTab.value = 'output'"
      >
        Output
      </button>
      <button
        class="panel-tab"
        :class="{ active: ide.panelTab.value === 'network' }"
        @click="ide.panelTab.value = 'network'"
      >
        Network
      </button>

      <div style="flex: 1" />

      <span v-if="status === 'running'" class="dot-live" style="margin-right: 6px" />
      <button class="icon-btn" title="New terminal" @click="restart">
        <Plus :size="14" />
      </button>
      <button class="icon-btn" title="Clear" @click="clear">
        <Eraser :size="14" />
      </button>
      <button class="icon-btn" title="Close panel" @click="close">
        <X :size="14" />
      </button>
    </div>

    <div v-show="ide.panelTab.value === 'terminal'" ref="host" class="terminal-host" />

    <div v-if="ide.panelTab.value === 'problems'" class="panel-body">
      <div class="panel-empty">No problems have been detected in the workspace.</div>
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
