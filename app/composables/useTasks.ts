import { computed } from 'vue'
import { call, isTauri, listen as listenEvent } from '../lib/api'

export type TaskStatus = 'idle' | 'running' | 'passed' | 'failed' | 'cancelled'

export interface TaskDef {
  id: string
  label: string
  /** `kodra`, `package` or `make`. */
  source: string
  /** Command line preview shown next to the label. */
  detail: string
  /** Full command line handed to the shell. */
  command: string
  /** Workspace relative folder (empty means the root). */
  cwd: string
  /** `build`, `test` or `none`. */
  group: string
  isDefault: boolean
}

export interface TaskRunInfo {
  id: string
  label: string
  cwd: string
}

export interface TaskOutputLine {
  stream: 'stdout' | 'stderr' | 'info' | 'error'
  text: string
}

interface ExitPayload {
  runId: string
  code: number
  durationMs: number
}

const OUTPUT_LIMIT = 4000

const SOURCE_LABEL: Record<string, string> = {
  kodra: 'Kodra',
  package: 'Package',
  make: 'Make'
}

// One window listener per webview; `listen()` may be reached from several
// composable instances, so the guard lives at module scope.
let listening = false

export function useTasks() {
  const tasks = useState<TaskDef[]>('kodra:tasks', () => [])
  const toolchain = useState<Record<string, string>>('kodra:tasks-toolchain', () => ({}))
  const loading = useState<boolean>('kodra:tasks-loading', () => false)
  const error = useState<string>('kodra:tasks-error', () => '')
  const detectedAt = useState<number>('kodra:tasks-detected-at', () => 0)

  const runStatus = useState<TaskStatus>('kodra:tasks-run-status', () => 'idle')
  const runId = useState<string | null>('kodra:tasks-run-id', () => null)
  const runLabel = useState<string>('kodra:tasks-run-label', () => '')
  const runCwd = useState<string>('kodra:tasks-run-cwd', () => '')
  const current = useState<TaskDef | null>('kodra:tasks-current', () => null)
  const lastTaskId = useState<string>('kodra:tasks-last-id', () => '')
  const cancelled = useState<boolean>('kodra:tasks-cancelled', () => false)
  const exitCode = useState<number | null>('kodra:tasks-exit-code', () => null)
  const durationMs = useState<number>('kodra:tasks-duration', () => 0)
  const output = useState<TaskOutputLine[]>('kodra:tasks-output', () => [])
  const results = useState<Record<string, TaskStatus>>('kodra:tasks-results', () => ({}))

  const active = computed(() => runStatus.value === 'running')
  const hasTasks = computed(() => tasks.value.length > 0)
  const taskCount = computed(() => tasks.value.length)

  const groups = computed(() => {
    const order = ['kodra', 'package', 'make']
    const buckets = new Map<string, TaskDef[]>()
    for (const task of tasks.value) {
      const list = buckets.get(task.source) ?? []
      list.push(task)
      buckets.set(task.source, list)
    }
    return [...buckets.entries()]
      .sort((a, b) => {
        const ai = order.indexOf(a[0])
        const bi = order.indexOf(b[0])
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a[0].localeCompare(b[0])
      })
      .map(([source, list]) => ({
        source,
        label: SOURCE_LABEL[source] ?? source,
        tasks: list
      }))
  })

  function statusOf(task: TaskDef): TaskStatus {
    if (active.value && current.value?.id === task.id) return 'running'
    return results.value[task.id] ?? 'idle'
  }

  function countStatus(status: TaskStatus): number {
    return tasks.value.filter((task) => results.value[task.id] === status).length
  }

  const defaultTask = computed(
    () => tasks.value.find((task) => task.isDefault) ?? null
  )

  const summary = computed(() => {
    if (runStatus.value === 'running') {
      return current.value ? `Running ${current.value.label}…` : 'Running task…'
    }
    if (runStatus.value === 'passed') return 'Task finished'
    if (runStatus.value === 'failed') return 'Task failed'
    if (runStatus.value === 'cancelled') return 'Task cancelled'
    if (!hasTasks.value) return 'No tasks found'
    return `${taskCount.value} task${taskCount.value === 1 ? '' : 's'}`
  })

  function statusColor(): string {
    if (runStatus.value === 'passed') return 'var(--green, #4ec9b0)'
    if (runStatus.value === 'failed') return 'var(--red, #f87171)'
    if (runStatus.value === 'running') return 'var(--accent)'
    if (runStatus.value === 'cancelled') return 'var(--text-faint)'
    return 'var(--text-muted)'
  }

  function durationText(): string {
    if (!durationMs.value) return ''
    const total = durationMs.value
    if (total < 1000) return `${total}ms`
    const seconds = total / 1000
    return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  }

  function appendOutput(stream: TaskOutputLine['stream'], text: string) {
    if (!text) return
    const next = [...output.value, { stream, text }]
    output.value = next.length > OUTPUT_LIMIT ? next.slice(next.length - OUTPUT_LIMIT) : next
  }

  function clearOutput() {
    output.value = []
  }

  async function detect(): Promise<TaskDef[]> {
    if (!isTauri()) {
      tasks.value = mockTasks()
      toolchain.value = { npm: 'mock', node: 'mock' }
      detectedAt.value = Date.now()
      return tasks.value
    }
    loading.value = true
    error.value = ''
    try {
      const [found, tools] = await Promise.all([
        call<TaskDef[]>('tasks_detect'),
        call<Record<string, string>>('tasks_toolchain').catch(() => ({}))
      ])
      tasks.value = found
      toolchain.value = tools ?? {}
      detectedAt.value = Date.now()
      return found
    } catch (err) {
      error.value = String(err)
      tasks.value = []
      return []
    } finally {
      loading.value = false
    }
  }

  function finalize() {
    const task = current.value
    const status: TaskStatus = cancelled.value
      ? 'cancelled'
      : (exitCode.value ?? 0) === 0
        ? 'passed'
        : 'failed'
    runStatus.value = status
    runId.value = null
    if (task) {
      results.value = { ...results.value, [task.id]: status }
      lastTaskId.value = task.id
    }
  }

  async function start(task: TaskDef) {
    if (active.value) await stop()
    output.value = []
    runStatus.value = 'running'
    runLabel.value = task.command
    runCwd.value = ''
    exitCode.value = null
    durationMs.value = 0
    cancelled.value = false
    current.value = task
    try {
      const info = await call<TaskRunInfo>('task_run', { task })
      // A very short task can finish before `task_run` resolves, so only take
      // the id while this session is still the one running.
      if (runStatus.value === 'running' && !runId.value) {
        runId.value = info.id
        runLabel.value = info.label
        runCwd.value = info.cwd
      }
    } catch (err) {
      appendOutput('error', `${String(err)}\n`)
      cancelled.value = true
      finalize()
    }
  }

  function run(task: TaskDef): Promise<void> {
    return start(task)
  }

  function runById(id: string): Promise<void> {
    const task = tasks.value.find((item) => item.id === id)
    return task ? start(task) : Promise.resolve()
  }

  async function runDefault(): Promise<boolean> {
    const task = defaultTask.value
    if (!task) return false
    await start(task)
    return true
  }

  async function runLast(): Promise<boolean> {
    const task =
      tasks.value.find((item) => item.id === lastTaskId.value) ??
      tasks.value.find((item) => item.isDefault)
    if (!task) return false
    await start(task)
    return true
  }

  async function stop() {
    cancelled.value = true
    const id = runId.value
    if (!id) {
      if (runStatus.value === 'running') finalize()
      return
    }
    try {
      await call('task_cancel', { id })
      appendOutput('info', 'Stopping…\n')
    } catch (err) {
      appendOutput('error', `${String(err)}\n`)
    }
  }

  function handleOutput(payload: { runId: string; stream: string; text: string }) {
    if (runId.value && payload.runId !== runId.value) return
    appendOutput(payload.stream === 'stderr' ? 'stderr' : 'stdout', payload.text)
  }

  function handleExit(payload: ExitPayload) {
    if (!payload) return
    if (runId.value ? payload.runId !== runId.value : runStatus.value !== 'running') return
    exitCode.value = payload.code
    durationMs.value += payload.durationMs
    finalize()
  }

  async function listen() {
    if (listening || !isTauri()) return
    listening = true
    await listenEvent<{ runId: string; stream: string; text: string }>('task:output', handleOutput)
    await listenEvent<ExitPayload>('task:exit', handleExit)
  }

  async function init() {
    await listen()
    void detect()
  }

  /** Called when the workspace changes: stop anything still running. */
  function reset() {
    cancelled.value = true
    if (runId.value) {
      const id = runId.value
      runId.value = null
      void call('task_cancel', { id }).catch(() => {})
    }
    if (isTauri()) void call('task_cancel_all').catch(() => {})
    runStatus.value = 'idle'
    current.value = null
    lastTaskId.value = ''
    tasks.value = []
    results.value = {}
    output.value = []
    error.value = ''
    exitCode.value = null
    durationMs.value = 0
    runLabel.value = ''
    runCwd.value = ''
  }

  return {
    tasks,
    groups,
    toolchain,
    loading,
    error,
    detectedAt,
    runStatus,
    runId,
    runLabel,
    runCwd,
    current,
    lastTaskId,
    cancelled,
    exitCode,
    durationMs,
    output,
    results,
    active,
    hasTasks,
    taskCount,
    defaultTask,
    summary,
    statusColor,
    durationText,
    countStatus,
    statusOf,
    appendOutput,
    clearOutput,
    detect,
    listen,
    init,
    reset,
    run,
    runById,
    runDefault,
    runLast,
    stop
  }
}

/** Browser demo data so the pane renders outside Tauri. */
function mockTasks(): TaskDef[] {
  return [
    {
      id: 'kodra:0',
      label: 'Build',
      source: 'kodra',
      detail: 'pnpm build',
      command: 'pnpm build',
      cwd: '',
      group: 'build',
      isDefault: true
    },
    {
      id: 'package::dev',
      label: 'dev',
      source: 'package',
      detail: 'pnpm run dev',
      command: 'pnpm run dev',
      cwd: '',
      group: 'none',
      isDefault: false
    },
    {
      id: 'make:lint',
      label: 'lint',
      source: 'make',
      detail: 'make lint',
      command: 'make lint',
      cwd: '',
      group: 'none',
      isDefault: false
    }
  ]
}
