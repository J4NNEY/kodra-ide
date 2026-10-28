<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import '@xterm/xterm/css/xterm.css'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { call, isTauri, listen } from '../lib/api'
import { isColor } from '../lib/themes'

const props = defineProps<{
  sessionId: string
  shell: string
  active: boolean
}>()

const emit = defineEmits<{
  (event: 'status', value: 'running' | 'exited'): void
}>()

const ide = useIde()
const themes = useThemes()
const { push: pushOutput } = useOutputLog()

const host = ref<HTMLDivElement | null>(null)
const status = ref<'idle' | 'running' | 'exited'>('idle')

let term: Terminal | null = null
let fit: FitAddon | null = null
let observer: ResizeObserver | null = null
let unlisteners: Array<() => void> = []
let mockBuffer = ''
let bootToken = 0
let disposed = false

function shellName(): string {
  const base = props.shell.split(/[\\/]/).pop() ?? props.shell
  return base.replace(/\.exe$/i, '')
}

function xtermTheme() {
  const theme = themes.active.value
  const accent = isColor(ide.settings.value.accent)
    ? ide.settings.value.accent
    : theme.colors.accent
  const light = theme.kind === 'light'
  const transparent = 'rgba(0,0,0,0)'

  return {
    background: theme.terminal?.background ?? transparent,
    foreground: theme.terminal?.foreground ?? theme.colors.text,
    cursor: theme.terminal?.cursor ?? accent,
    cursorAccent: theme.colors.surface1,
    selectionBackground: theme.terminal?.selection ?? `${accent}33`,
    black: light ? '#24292f' : '#1a1a1c',
    red: theme.colors.red,
    green: theme.colors.green,
    yellow: accent,
    blue: theme.colors.blue,
    magenta: theme.colors.purple,
    cyan: light ? '#1b7c83' : '#89ddff',
    white: theme.colors.text,
    brightBlack: theme.colors.textFaint,
    brightRed: theme.colors.red,
    brightGreen: theme.colors.green,
    brightYellow: theme.colors.accentStrong,
    brightBlue: theme.colors.blue,
    brightMagenta: theme.colors.purple,
    brightCyan: light ? '#3192aa' : '#a8e9ff',
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
  write('\r\n\x1b[38;5;179mPS\x1b[0m \x1b[38;5;245mC:\\demo\\kudo-workspace\x1b[0m> ')
}

function mockBanner() {
  write(
    `\x1b[38;5;179mKudo terminal\x1b[0m \x1b[38;5;245m(${shellName()}, browser mock)\x1b[0m\r\n`
  )
  write(
    '\x1b[38;5;245mStart the desktop shell with `pnpm desktop` for a real shell session.\x1b[0m'
  )
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
    await call('pty_write', { id: props.sessionId, data })
  } catch (err) {
    pushOutput('terminal', String(err))
  }
}

function setStatus(next: 'running' | 'exited') {
  status.value = next
  emit('status', next)
}

async function boot() {
  const token = ++bootToken
  await nextTick()
  if (disposed || token !== bootToken || !host.value) return

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

  await new Promise((resolve) => requestAnimationFrame(resolve))
  if (disposed || token !== bootToken) return

  safeFit()
  pushOutput('terminal', `session ${props.sessionId} started (${local.cols}x${local.rows})`)

  if (isTauri()) {
    const offData = await listen<{ id: string; data: string }>('pty:data', (payload) => {
      if (payload.id === props.sessionId) term?.write(payload.data)
    })
    if (disposed) {
      offData()
      return
    }
    unlisteners.push(offData)

    const offExit = await listen<{ id: string }>('pty:exit', (payload) => {
      if (payload.id !== props.sessionId) return
      setStatus('exited')
      term?.writeln('\r\n\x1b[38;5;245m[process exited]\x1b[0m')
      pushOutput('terminal', `session ${props.sessionId} exited`)
    })
    if (disposed) {
      offExit()
      return
    }
    unlisteners.push(offExit)

    if (token !== bootToken) return

    try {
      await call('pty_spawn', {
        id: props.sessionId,
        shell: props.shell,
        cwd: ide.workspace.value?.path ?? null,
        cols: local.cols,
        rows: local.rows
      })
      if (disposed || token !== bootToken) {
        // The panel closed while the shell was starting; do not leak the PTY.
        await call('pty_kill', { id: props.sessionId }).catch(() => {})
        return
      }
      setStatus('running')
      pushOutput('terminal', `session ${props.sessionId} spawned ${shellName()}`)
    } catch (err) {
      setStatus('exited')
      local.writeln(`\x1b[31m${String(err)}\x1b[0m`)
      pushOutput('terminal', String(err))
    }
  } else {
    setStatus('running')
    mockBanner()
  }

  if (disposed || token !== bootToken) return

  observer = new ResizeObserver(() => {
    if (!term || !safeFit()) return
    if (isTauri()) {
      call('pty_resize', { id: props.sessionId, cols: term.cols, rows: term.rows }).catch(() => {})
    }
  })
  if (host.value) observer.observe(host.value)

  // Layout can settle a frame after mount (tab bar, scrollbar, fonts).
  setTimeout(() => {
    if (!disposed && token === bootToken) safeFit()
  }, 150)
}

function clear() {
  term?.clear()
  term?.focus()
}

function focus() {
  term?.focus()
}

function fitNow() {
  safeFit()
}

async function teardown() {
  disposed = true
  bootToken++
  for (const off of unlisteners) off()
  unlisteners = []
  if (isTauri()) {
    await call('pty_kill', { id: props.sessionId }).catch(() => {})
  }
  observer?.disconnect()
  observer = null
  term?.dispose()
  term = null
  fit = null
  status.value = 'idle'
}

defineExpose({ clear, focus, fitNow })

onMounted(() => {
  void boot()
})

onBeforeUnmount(() => {
  void teardown()
})

watch(
  () => props.active,
  async (active) => {
    if (!active) return
    await nextTick()
    requestAnimationFrame(() => {
      if (!safeFit()) return
      focus()
    })
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

watch([() => themes.active.value.id, () => ide.settings.value.accent], () => {
  if (term) term.options.theme = xtermTheme()
})
</script>

<template>
  <div ref="host" class="terminal-host" />
</template>
