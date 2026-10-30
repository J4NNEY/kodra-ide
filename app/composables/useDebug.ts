import { computed } from 'vue'
import { basename, call, isTauri, listen as listenEvent } from '../lib/api'

export type DebugStatus = 'idle' | 'starting' | 'running' | 'paused' | 'stopped' | 'failed'

export interface Breakpoint {
  path: string
  /** 1-based line, matching the editor gutter. */
  line: number
  enabled: boolean
  verified: boolean
  condition: string
  message?: string
}

export interface DebugFrame {
  id: number
  name: string
  path: string | null
  line: number
  column: number
}

export interface DebugScope {
  name: string
  variablesReference: number
  expensive: boolean
}

export interface DebugVariable {
  name: string
  value: string
  type: string
  variablesReference: number
  children: DebugVariable[]
  expanded: boolean
}

export interface DebugOutputLine {
  category: string
  text: string
}

export interface DebugConfig {
  adapter: string
  request: 'launch' | 'attach'
  /** Binary/program for native adapters, package folder for Delve. */
  program: string
  args: string
  cwd: string
  stopOnEntry: boolean
  /** Optional absolute path that overrides the adapter binary. */
  command: string
  /** Raw launch arguments for the custom adapter. */
  launchJson: string
}

export interface AdapterSpec {
  id: string
  label: string
  command: string
  args: string[]
  /** `tcp` adapters announce a socket address on stdout (Delve); the rest use stdio. */
  transport: 'stdio' | 'tcp'
  languages: string[]
  install: string
  launch: (config: DebugConfig, workspace: string) => Record<string, unknown>
}

function splitArgs(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  return trimmed.match(/"[^"]*"|\S+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? []
}

/** Attach mode reads the target process id from the Program field. */
function attachPid(config: DebugConfig): number {
  const pid = Number(config.program.trim())
  return Number.isInteger(pid) && pid > 0 ? pid : 0
}

const ADAPTERS: AdapterSpec[] = [
  {
    id: 'dlv',
    label: 'Go — Delve',
    command: 'dlv',
    args: ['dap'],
    transport: 'tcp',
    languages: ['go'],
    install: 'go install github.com/go-delve/delve/cmd/dlv@latest',
    launch: (config, workspace) =>
      config.request === 'attach'
        ? { mode: 'local', processId: attachPid(config) }
        : {
            mode: 'debug',
            program: config.program.trim() || workspace,
            args: splitArgs(config.args),
            cwd: config.cwd.trim() || workspace,
            stopOnEntry: config.stopOnEntry
          }
  },
  {
    id: 'codelldb',
    label: 'Native — CodeLLDB',
    command: 'codelldb',
    args: ['--stdio'],
    transport: 'stdio',
    languages: ['rust', 'c', 'cpp'],
    install: 'Install CodeLLDB and put its `codelldb` binary on PATH',
    launch: (config, workspace) =>
      config.request === 'attach'
        ? { pid: attachPid(config), terminal: 'console' }
        : {
            program: config.program.trim(),
            args: splitArgs(config.args),
            cwd: config.cwd.trim() || workspace,
            stopOnEntry: config.stopOnEntry,
            terminal: 'console'
          }
  },
  {
    id: 'lldb-dap',
    label: 'Native — lldb-dap',
    command: 'lldb-dap',
    args: [],
    transport: 'stdio',
    languages: ['rust', 'c', 'cpp'],
    install: 'Installs with LLVM as `lldb-dap`',
    launch: (config, workspace) =>
      config.request === 'attach'
        ? { pid: attachPid(config), terminal: 'console' }
        : {
            program: config.program.trim(),
            args: splitArgs(config.args),
            cwd: config.cwd.trim() || workspace,
            stopOnEntry: config.stopOnEntry,
            terminal: 'console'
          }
  },
  {
    id: 'custom',
    label: 'Custom stdio adapter',
    command: '',
    args: [],
    transport: 'stdio',
    languages: [],
    install: 'Point this at any debug adapter that speaks DAP over stdin/stdout',
    launch: (config) => {
      if (!config.launchJson.trim()) return {}
      try {
        const parsed = JSON.parse(config.launchJson)
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }
  }
]

function defaultConfig(workspace: string | null): DebugConfig {
  return {
    adapter: 'dlv',
    request: 'launch',
    program: workspace ?? '',
    args: '',
    cwd: workspace ?? '',
    stopOnEntry: false,
    command: '',
    launchJson: '{\n  "program": "",\n  "args": []\n}'
  }
}

const OUTPUT_LIMIT = 400

// Only one window listener is needed per webview, but `start()` may run from a
// different composable instance (or module copy) than `init()`, so everything
// the handshake shares has to live in Nuxt state rather than module variables.
let listening = false

export function useDebug() {
  const ide = useIde()
  const status = useState<DebugStatus>('kudo:debug-status', () => 'idle')
  const sessionId = useState<string | null>('kudo:debug-session', () => null)
  const error = useState<string>('kudo:debug-error', () => '')
  const config = useState<DebugConfig>('kudo:debug-config', () => defaultConfig(null))
  const breakpoints = useState<Breakpoint[]>('kudo:debug-breakpoints', () => [])
  const frames = useState<DebugFrame[]>('kudo:debug-frames', () => [])
  const scopes = useState<DebugScope[]>('kudo:debug-scopes', () => [])
  const variables = useState<DebugVariable[]>('kudo:debug-variables', () => [])
  const threadId = useState<number>('kudo:debug-thread', () => 0)
  const stopReason = useState<string>('kudo:debug-reason', () => '')
  const output = useState<DebugOutputLine[]>('kudo:debug-output', () => [])
  const initializedSeen = useState<boolean>('kudo:debug-initialized', () => false)
  const adapters = useState<Record<string, string>>('kudo:debug-adapters', () => ({}))
  const capabilities = useState<Record<string, unknown>>('kudo:debug-capabilities', () => ({}))
  const watchResults = useState<Array<{ expression: string; result: string; error: string }>>(
    'kudo:debug-watch',
    () => []
  )

  const active = computed(() => status.value !== 'idle' && status.value !== 'stopped')
  const paused = computed(() => status.value === 'paused')
  const selectedFrame = computed(() => frames.value[0] ?? null)
  const adapterSpecs = computed(() =>
    ADAPTERS.map((spec) => ({
      ...spec,
      available: spec.id === 'custom' || !!adapters.value[spec.command]
    }))
  )
  const currentAdapter = computed(
    () => ADAPTERS.find((spec) => spec.id === config.value.adapter) ?? ADAPTERS[0]
  )
  const summary = computed(() => {
    if (status.value === 'paused') {
      const frame = selectedFrame.value
      const where = frame?.path ? `${basename(frame.path)}:${frame.line}` : ''
      return where ? `Paused at ${where}` : 'Paused'
    }
    if (status.value === 'running') return 'Running'
    if (status.value === 'starting') return 'Starting…'
    if (status.value === 'failed') return 'Debug session failed'
    return ''
  })
  const statusColor = computed(() => {
    if (status.value === 'paused') return 'var(--warning, #d4a73c)'
    if (status.value === 'running') return 'var(--success, #4ec9b0)'
    if (status.value === 'failed') return 'var(--danger, #f87171)'
    return 'var(--text-muted)'
  })

  function workspaceKey(): string {
    return ide.workspace.value?.path ?? ''
  }

  /** Match adapter-reported paths against the paths used by open tabs. */
  function canonicalPath(path: string): string {
    if (!path) return ''
    const normalized = path.replace(/\\/g, '/').toLowerCase()
    const tab = ide.tabs.value.find(
      (item) => item.path.replace(/\\/g, '/').toLowerCase() === normalized
    )
    return tab?.path ?? path
  }

  function samePath(a: string, b: string): boolean {
    return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
  }

  /** Load the breakpoints and launch config saved for the open workspace. */
  function loadWorkspaceState() {
    const key = workspaceKey()
    if (!key || typeof localStorage === 'undefined') {
      config.value = defaultConfig(key)
      breakpoints.value = []
      return
    }
    try {
      const stored = JSON.parse(localStorage.getItem(`kudo:debug:${key}`) ?? 'null')
      config.value = {
        ...defaultConfig(key),
        ...(stored?.config ?? {})
      }
    } catch {
      config.value = defaultConfig(key)
    }
    try {
      const saved = JSON.parse(localStorage.getItem(`kudo:breakpoints:${key}`) ?? 'null')
      breakpoints.value = Array.isArray(saved)
        ? saved
            .filter((bp: any) => bp && typeof bp.path === 'string' && Number.isFinite(bp.line))
            .map((bp: any) => ({
              path: String(bp.path),
              line: Number(bp.line),
              enabled: bp.enabled !== false,
              verified: false,
              condition: typeof bp.condition === 'string' ? bp.condition : ''
            }))
        : []
    } catch {
      breakpoints.value = []
    }
  }

  function persist() {
    if (typeof localStorage === 'undefined') return
    const key = workspaceKey()
    if (!key) return
    localStorage.setItem(
      `kudo:debug:${key}`,
      JSON.stringify({ config: config.value })
    )
    localStorage.setItem(
      `kudo:breakpoints:${key}`,
      JSON.stringify(
        breakpoints.value.map((bp) => ({
          path: bp.path,
          line: bp.line,
          enabled: bp.enabled,
          condition: bp.condition
        }))
      )
    )
  }

  function pushOutput(category: string, text: string) {
    if (!text) return
    const lines = text.replace(/\r/g, '').split('\n')
    const next = [...output.value]
    for (const line of lines) {
      if (!line.length && lines.length === 1) continue
      next.push({ category, text: line })
    }
    output.value = next.slice(-OUTPUT_LIMIT)
  }

  async function request<T = any>(command: string, args: Record<string, unknown> = {}) {
    if (!sessionId.value) throw new Error('no debug session')
    return await call<T>('dap_request', {
      id: sessionId.value,
      command,
      arguments: args
    })
  }

  // ---------- event plumbing ----------

  async function listen() {
    if (listening || !isTauri()) return
    listening = true
    await listenEvent<{ sessionId: string; event: string; body: any }>('dap:event', (payload) => {
      if (payload.sessionId && sessionId.value && payload.sessionId !== sessionId.value) return
      void handleEvent(payload.event, payload.body ?? {})
    })
    await listenEvent<{ sessionId: string; error: string }>('dap:exit', (payload) => {
      if (sessionId.value && payload.sessionId !== sessionId.value) return
      if (!sessionId.value) return
      sessionId.value = null
      frames.value = []
      scopes.value = []
      variables.value = []
      initializedSeen.value = false
      if (status.value !== 'failed') status.value = 'stopped'
      if (payload.error && !/closed the connection/i.test(payload.error)) {
        pushOutput('stderr', payload.error)
      }
    })
  }

  function waitForInitialized(timeoutMs = 20_000): Promise<void> {
    if (initializedSeen.value) return Promise.resolve()
    // Poll the shared flag: the `initialized` event may be handled by another
    // composable instance than the one waiting here.
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs
      const timer = setInterval(() => {
        if (initializedSeen.value || Date.now() >= deadline) {
          clearInterval(timer)
          resolve()
        }
      }, 50)
    })
  }

  async function handleEvent(event: string, body: any) {
    switch (event) {
      case 'initialized': {
        initializedSeen.value = true
        return
      }
      case 'stopped': {
        status.value = 'paused'
        stopReason.value = String(body.reason ?? 'breakpoint')
        threadId.value = Number(body.threadId ?? threadId.value ?? 0)
        await refreshFrames()
        return
      }
      case 'continued': {
        status.value = 'running'
        frames.value = []
        scopes.value = []
        variables.value = []
        return
      }
      case 'terminated':
      case 'exited': {
        status.value = 'stopped'
        frames.value = []
        scopes.value = []
        variables.value = []
        return
      }
      case 'output': {
        pushOutput(String(body.category ?? 'console'), String(body.output ?? ''))
        return
      }
      case 'breakpoint': {
        const bp = body.breakpoint
        if (bp && Number.isFinite(bp.line)) {
          const path = bp.source?.path ?? ''
          const match = breakpoints.value.find(
            (item) => item.line === Number(bp.line) && (!path || samePath(item.path, String(path)))
          )
          if (match) {
            match.verified = !!bp.verified
            match.message = bp.message ? String(bp.message) : undefined
            breakpoints.value = [...breakpoints.value]
          }
        }
        return
      }
      case 'capabilities': {
        capabilities.value = { ...capabilities.value, ...(body ?? {}) }
        return
      }
      case 'invalidated': {
        if (status.value !== 'paused') return
        if (Array.isArray(body?.areas) && body.areas.includes('variables')) {
          await refreshScopes()
        }
        return
      }
      default:
        return
    }
  }

  // ---------- stack / variables ----------

  async function refreshFrames() {
    if (!sessionId.value || !threadId.value) return
    try {
      const res = await request('stackTrace', { threadId: threadId.value, startFrame: 0 })
      frames.value = (res.stackFrames ?? []).map((frame: any) => ({
        id: Number(frame.id),
        name: String(frame.name ?? ''),
        path: frame.source?.path ? canonicalPath(String(frame.source.path)) : null,
        line: Number(frame.line ?? 1),
        column: Number(frame.column ?? 1)
      }))
      const top = frames.value[0]
      if (top?.path) await ide.openFile(top.path, top.line)
      await refreshScopes()
    } catch (err) {
      pushOutput('stderr', String(err))
    }
  }

  async function refreshScopes() {
    const frame = frames.value[0]
    if (!frame || !sessionId.value) {
      scopes.value = []
      variables.value = []
      return
    }
    try {
      const res = await request('scopes', { frameId: frame.id })
      scopes.value = (res.scopes ?? []).map((scope: any) => ({
        name: String(scope.name ?? ''),
        variablesReference: Number(scope.variablesReference ?? 0),
        expensive: !!scope.expensive
      }))
      variables.value = []
      const first = scopes.value.find((scope) => scope.variablesReference > 0 && !scope.expensive)
      if (first) await expandScope(first)
    } catch (err) {
      pushOutput('stderr', String(err))
    }
  }

  async function fetchVariables(reference: number): Promise<DebugVariable[]> {
    if (!reference || !sessionId.value) return []
    const res = await request('variables', { variablesReference: reference })
    return (res.variables ?? []).map((variable: any) => ({
      name: String(variable.name ?? ''),
      value: String(variable.value ?? ''),
      type: String(variable.type ?? ''),
      variablesReference: Number(variable.variablesReference ?? 0),
      children: [],
      expanded: false
    }))
  }

  async function expandScope(scope: DebugScope) {
    try {
      const list = await fetchVariables(scope.variablesReference)
      variables.value = list
    } catch (err) {
      pushOutput('stderr', String(err))
    }
  }

  async function expandVariable(target: DebugVariable) {
    if (!target.variablesReference) return
    if (target.expanded) {
      target.expanded = false
      variables.value = [...variables.value]
      return
    }
    try {
      target.children = await fetchVariables(target.variablesReference)
      target.expanded = true
      variables.value = [...variables.value]
    } catch (err) {
      pushOutput('stderr', String(err))
    }
  }

  async function evaluate(expression: string, frameScoped = true) {
    const trimmed = expression.trim()
    if (!trimmed) return
    const entry = { expression: trimmed, result: '', error: '' }
    try {
      const args: Record<string, unknown> = { expression: trimmed, context: 'watch' }
      if (frameScoped && frames.value[0]) args.frameId = frames.value[0].id
      const res = await request('evaluate', args)
      entry.result = String(res.result ?? '')
    } catch (err) {
      entry.error = String(err)
    }
    watchResults.value = [entry, ...watchResults.value.filter((item) => item.expression !== trimmed)]
  }

  function clearWatch() {
    watchResults.value = []
  }

  // ---------- breakpoints ----------

  function breakpointsFor(path: string): Breakpoint[] {
    return breakpoints.value.filter((bp) => bp.path === path)
  }

  async function toggleBreakpoint(path: string, line: number) {
    if (!path) return
    const existing = breakpoints.value.find((bp) => bp.path === path && bp.line === line)
    if (existing) {
      breakpoints.value = breakpoints.value.filter((bp) => bp !== existing)
    } else {
      breakpoints.value = [
        ...breakpoints.value,
        { path, line, enabled: true, verified: false, condition: '' }
      ]
    }
    persist()
    await syncBreakpoints(path)
  }

  async function setBreakpointEnabled(bp: Breakpoint, enabled: boolean) {
    bp.enabled = enabled
    breakpoints.value = [...breakpoints.value]
    persist()
    await syncBreakpoints(bp.path)
  }

  async function removeBreakpoint(bp: Breakpoint) {
    breakpoints.value = breakpoints.value.filter((item) => item !== bp)
    persist()
    await syncBreakpoints(bp.path)
  }

  async function setBreakpointCondition(bp: Breakpoint, condition: string) {
    bp.condition = condition
    breakpoints.value = [...breakpoints.value]
    persist()
    await syncBreakpoints(bp.path)
  }

  function clearBreakpoints() {
    breakpoints.value = []
    persist()
  }

  async function syncBreakpoints(path: string) {
    if (!sessionId.value) return
    const list = breakpoints.value.filter((bp) => bp.path === path && bp.enabled)
    try {
      const res = await request('setBreakpoints', {
        source: { path, name: basename(path) },
        breakpoints: list.map((bp) => ({
          line: bp.line,
          ...(bp.condition ? { condition: bp.condition } : {})
        }))
      })
      const verified = res.breakpoints ?? []
      verified.forEach((item: any, index: number) => {
        const bp = list[index]
        if (!bp) return
        bp.verified = !!item.verified
        bp.message = item.message ? String(item.message) : undefined
      })
      breakpoints.value = [...breakpoints.value]
    } catch (err) {
      pushOutput('stderr', String(err))
    }
  }

  async function syncAllBreakpoints() {
    const paths = [...new Set(breakpoints.value.map((bp) => bp.path))]
    for (const path of paths) await syncBreakpoints(path)
  }

  // ---------- session control ----------

  function buildLaunch(workspace: string): Record<string, unknown> {
    return currentAdapter.value.launch(config.value, workspace)
  }

  async function start() {
    if (!isTauri()) {
      ide.notify('Debugging needs the desktop app', 'error')
      return
    }
    if (active.value) {
      await continueExecution()
      return
    }
    const workspace = ide.workspace.value?.path ?? ''
    if (!workspace) {
      ide.notify('Open a folder before starting a debug session', 'error')
      return
    }
    const spec = currentAdapter.value
    if (spec.id !== 'custom' && config.value.request === 'attach' && !attachPid(config.value)) {
      ide.notify('Attach needs the PID of a running process in the Program field', 'error')
      return
    }
    const command = config.value.command.trim() || adapters.value[spec.command] || spec.command
    if (!command) {
      ide.notify('Set the adapter command in the Debug view', 'error')
      return
    }

    status.value = 'starting'
    error.value = ''
    initializedSeen.value = false
    output.value = []
    stopReason.value = ''
    frames.value = []
    scopes.value = []
    variables.value = []

    try {
      const result = await call<{ id: string; adapter: string; capabilities: Record<string, unknown> }>(
        'dap_start',
        {
          req: {
            name: spec.label,
            adapter: spec.id,
            command,
            args: spec.args,
            cwd: config.value.cwd.trim() || workspace,
            request: config.value.request,
            transport: spec.transport,
            launch: buildLaunch(workspace)
          }
        }
      )
      sessionId.value = result.id
      capabilities.value = result.capabilities ?? {}
      pushOutput('console', `Starting ${spec.label}…`)

      await waitForInitialized()
      if ((status.value as DebugStatus) === 'failed') return
      await syncAllBreakpoints()
      if (!sessionId.value) return
      // Delve returns no capabilities at all but still requires this handshake
      // step to start the program, so only an explicit `false` skips it.
      if (capabilities.value.supportsConfigurationDoneRequest !== false) {
        await request('configurationDone', {}).catch((err) => pushOutput('stderr', String(err)))
      }
      if ((status.value as DebugStatus) !== 'paused') status.value = 'running'
    } catch (err) {
      status.value = 'failed'
      error.value = String(err)
      pushOutput('stderr', error.value)
      if (sessionId.value) {
        const id = sessionId.value
        sessionId.value = null
        await call('dap_stop', { id }).catch(() => {})
      }
      ide.notify(error.value, 'error')
    }
  }

  async function continueExecution() {
    if (status.value !== 'paused') return
    // Reset before awaiting the response: the adapter may emit `stopped` (and
    // the IPC event may be dispatched) before the request promise resolves.
    status.value = 'running'
    frames.value = []
    scopes.value = []
    variables.value = []
    try {
      await request('continue', { threadId: threadId.value })
    } catch (err) {
      pushOutput('stderr', String(err))
    }
  }

  async function pause() {
    if (status.value !== 'running') return
    try {
      await request('pause', { threadId: threadId.value })
    } catch (err) {
      pushOutput('stderr', String(err))
    }
  }

  async function step(command: 'next' | 'stepIn' | 'stepOut') {
    if (status.value !== 'paused') return
    // See continueExecution: the `stopped` event can beat the response promise.
    status.value = 'running'
    frames.value = []
    scopes.value = []
    variables.value = []
    try {
      await request(command, { threadId: threadId.value })
    } catch (err) {
      pushOutput('stderr', String(err))
    }
  }

  async function stop() {
    const id = sessionId.value
    sessionId.value = null
    status.value = 'stopped'
    frames.value = []
    scopes.value = []
    variables.value = []
    threadId.value = 0
    if (!id) return
    try {
      await call('dap_stop', { id })
    } catch {
      /* the adapter is already gone */
    }
    pushOutput('console', 'Debug session stopped')
  }

  async function restart() {
    await stop()
    await start()
  }

  async function detect() {
    try {
      adapters.value = await call<Record<string, string>>('dap_detect')
    } catch {
      adapters.value = {}
    }
    return adapters.value
  }

  /** Pick a sensible adapter and program for the open workspace. */
  function suggestConfig() {
    const workspace = ide.workspace.value?.path ?? ''
    const specs = adapterSpecs.value.filter((spec) => spec.available)
    const next = { ...config.value }
    // A saved adapter stays selected even when it is not on PATH: the user may
    // have typed an absolute command path in the Debug view.
    if (!ADAPTERS.some((spec) => spec.id === next.adapter)) {
      next.adapter = specs[0]?.id ?? 'custom'
    }
    if (!next.program.trim()) next.program = workspace
    if (!next.cwd.trim()) next.cwd = workspace
    config.value = next
    persist()
    return specs
  }

  async function init() {
    await listen()
    loadWorkspaceState()
    await detect()
    suggestConfig()
  }

  function reset() {
    if (sessionId.value) {
      const id = sessionId.value
      sessionId.value = null
      void call('dap_stop', { id }).catch(() => {})
    }
    status.value = 'idle'
    frames.value = []
    scopes.value = []
    variables.value = []
    output.value = []
    threadId.value = 0
    error.value = ''
    stopReason.value = ''
    initializedSeen.value = false
  }

  return {
    status,
    sessionId,
    error,
    config,
    breakpoints,
    frames,
    scopes,
    variables,
    threadId,
    stopReason,
    output,
    adapters,
    capabilities,
    watchResults,
    active,
    paused,
    selectedFrame,
    adapterSpecs,
    currentAdapter,
    summary,
    statusColor,
    init,
    listen,
    detect,
    loadWorkspaceState,
    persist,
    start,
    continueExecution,
    pause,
    step,
    stop,
    restart,
    reset,
    suggestConfig,
    request,
    refreshFrames,
    refreshScopes,
    expandScope,
    expandVariable,
    evaluate,
    clearWatch,
    breakpointsFor,
    toggleBreakpoint,
    setBreakpointEnabled,
    setBreakpointCondition,
    removeBreakpoint,
    clearBreakpoints,
    syncBreakpoints,
    pushOutput
  }
}
