import { computed } from 'vue'
import { call, isTauri, listen as listenEvent } from '../lib/api'

export type TestFramework = 'go' | 'rust' | 'python' | 'node'
export type TestStatus = 'idle' | 'running' | 'passed' | 'failed' | 'skipped'
export type RunStatus = 'idle' | 'running' | 'passed' | 'failed' | 'cancelled'

export interface TestCase {
  name: string
  /** 1-based line where the test is declared. */
  line: number
}

export interface TestFile {
  path: string
  /** Workspace relative path with forward slashes. */
  rel: string
  framework: string
  /** Folder the runner is pointed at (package, crate or project root). */
  package: string
  tests: TestCase[]
}

export interface TestRunRequest {
  framework: string
  file?: string
  test?: string
  package?: string
}

export interface TestRunInfo {
  id: string
  label: string
  cwd: string
}

export interface TestOutputLine {
  stream: 'stdout' | 'stderr' | 'info' | 'error'
  text: string
}

interface ExitPayload {
  runId: string
  code: number
  durationMs: number
}

const OUTPUT_LIMIT = 4000

const FRAMEWORK_LABEL: Record<string, string> = {
  go: 'Go',
  rust: 'Rust',
  python: 'Python',
  node: 'Node'
}

// One window listener per webview; `listen()` may be reached from several
// composable instances, so the guard lives at module scope.
let listening = false

const GO_RESULT = /^\s*---\s+(PASS|FAIL|SKIP):\s+(\S+)/
const GO_RUN = /^===\s+RUN\s+(\S+)/
const GO_PACKAGE = /^(?:ok|FAIL|---\s+FAIL:|\?)\s+(\S+)/
const RUST_RESULT = /^\s*test\s+(\S+)\s+\.\.\.\s+(ok|FAILED|ignored)/
const PY_RESULT = /^(\S+\.py)::(\S+)\s+(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)/

/** Cargo prints module paths (`tests::add`); the tree stores bare function names. */
function bareTestName(name: string): string {
  const parts = name.split('::')
  return parts[parts.length - 1] || name
}

function statusFromWord(word: string): TestStatus {
  if (word === 'PASS' || word === 'ok') return 'passed'
  if (word === 'FAIL' || word === 'FAILED' || word === 'ERROR') return 'failed'
  return 'skipped'
}

function normPath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

export function useTests() {
  const files = useState<TestFile[]>('kudo:tests-files', () => [])
  const toolchain = useState<Record<string, string>>('kudo:tests-toolchain', () => ({}))
  const loading = useState<boolean>('kudo:tests-loading', () => false)
  const error = useState<string>('kudo:tests-error', () => '')
  const detectedAt = useState<number>('kudo:tests-detected-at', () => 0)

  const runStatus = useState<RunStatus>('kudo:tests-run-status', () => 'idle')
  const runId = useState<string | null>('kudo:tests-run-id', () => null)
  const runLabel = useState<string>('kudo:tests-run-label', () => '')
  const runCwd = useState<string>('kudo:tests-run-cwd', () => '')
  const queue = useState<TestRunRequest[]>('kudo:tests-queue', () => [])
  const activeRequest = useState<TestRunRequest | null>('kudo:tests-active', () => null)
  const cancelled = useState<boolean>('kudo:tests-cancelled', () => false)
  const failedAny = useState<boolean>('kudo:tests-failed-any', () => false)
  const exitCode = useState<number | null>('kudo:tests-exit-code', () => null)
  const durationMs = useState<number>('kudo:tests-duration', () => 0)
  const output = useState<TestOutputLine[]>('kudo:tests-output', () => [])
  const results = useState<Record<string, TestStatus>>('kudo:tests-results', () => ({}))
  const fileResults = useState<Record<string, TestStatus>>('kudo:tests-file-results', () => ({}))
  const collapsed = useState<Record<string, boolean>>('kudo:tests-collapsed', () => ({}))

  const active = computed(() => runStatus.value === 'running')
  const hasTests = computed(() => files.value.length > 0)
  const testCount = computed(() =>
    files.value.reduce(
      (total, file) => total + (file.tests.length || (file.framework === 'node' ? 1 : 0)),
      0
    )
  )
  /** Distinct `(framework, package)` pairs used by "run all". */
  const groups = computed(() => {
    const seen = new Set<string>()
    const out: Array<{ framework: string; package: string; files: TestFile[] }> = []
    for (const file of files.value) {
      const key = `${file.framework}|${file.package}`
      let group = out.find((item) => `${item.framework}|${item.package}` === key)
      if (!group) {
        if (seen.has(key)) continue
        seen.add(key)
        group = { framework: file.framework, package: file.package, files: [] }
        out.push(group)
      }
      group.files.push(file)
    }
    return out
  })
  const summary = computed(() => {
    if (runStatus.value === 'running') return 'Running tests…'
    if (runStatus.value === 'passed') return 'All tests passed'
    if (runStatus.value === 'failed') {
      const failed = countStatus('failed')
      return failed ? `${failed} test${failed === 1 ? '' : 's'} failed` : 'Test run failed'
    }
    if (runStatus.value === 'cancelled') return 'Test run cancelled'
    return 'No test run yet'
  })
  const statusColor = computed(() => {
    if (runStatus.value === 'running') return 'var(--warning, #d4a73c)'
    if (runStatus.value === 'passed') return 'var(--success, #4ec9b0)'
    if (runStatus.value === 'failed') return 'var(--danger, #f87171)'
    if (runStatus.value === 'cancelled') return 'var(--text-muted)'
    return 'var(--text-muted)'
  })

  function durationText(): string {
    if (!durationMs.value) return ''
    return durationMs.value >= 1000 ? `${(durationMs.value / 1000).toFixed(1)}s` : `${durationMs.value}ms`
  }

  function countStatus(status: TestStatus): number {
    // Every verdict is stored twice when the file is known (`name` and
    // `rel::name`), so collapse the pairs before counting.
    const seen = new Set<string>()
    for (const [key, value] of Object.entries(results.value)) {
      if (value !== status) continue
      seen.add(key.split('::').pop() ?? key)
    }
    return seen.size
  }

  function frameworkLabel(framework: string): string {
    return FRAMEWORK_LABEL[framework] ?? framework
  }

  function fileFor(path: string): TestFile | null {
    const target = normPath(path)
    return files.value.find((file) => normPath(file.path) === target) ?? null
  }

  /** Find the test declared at a given 1-based line in a file. */
  function testAt(rel: string, line: number): string | null {
    const file = files.value.find((item) => item.rel === rel)
    if (!file) return null
    return file.tests.find((test) => test.line === line)?.name ?? null
  }

  /** Look a test up across the tree, so gutter and pane share one status map. */
  function statusOf(fileOrRel: TestFile | string, name: string): TestStatus {
    const rel = typeof fileOrRel === 'string' ? fileOrRel : fileOrRel.rel
    return results.value[`${rel}::${name}`] ?? results.value[name] ?? 'idle'
  }

  function fileStatus(file: TestFile): TestStatus {
    return fileResults.value[file.rel] ?? 'idle'
  }

  function isCollapsed(rel: string): boolean {
    return !!collapsed.value[rel]
  }

  function toggleCollapsed(rel: string) {
    collapsed.value = { ...collapsed.value, [rel]: !collapsed.value[rel] }
  }

  function appendOutput(stream: TestOutputLine['stream'], text: string) {
    if (!text) return
    const next = [...output.value, { stream, text }]
    output.value = next.length > OUTPUT_LIMIT ? next.slice(next.length - OUTPUT_LIMIT) : next
  }

  function clearOutput() {
    output.value = []
  }

  function setStatus(name: string, status: TestStatus, rel?: string) {
    const next = { ...results.value, [name]: status }
    if (rel) next[`${rel}::${name}`] = status
    results.value = next
  }

  function markRunning(name: string, rel?: string) {
    setStatus(name, 'running', rel)
  }

  function markResult(name: string, status: TestStatus, rel?: string) {
    setStatus(name, status, rel)
    if (status === 'failed') failedAny.value = true
  }

  /** Pull per-test verdicts out of the runner's own output. */
  function parseLine(text: string) {
    const line = text.trimEnd()
    if (!line) return
    let match = GO_RESULT.exec(line)
    if (match) {
      const name = match[2].split('/')[0]
      markResult(name, statusFromWord(match[1]), activeRel())
      return
    }
    match = GO_RUN.exec(line)
    if (match) {
      if (!match[1].includes('/')) markRunning(match[1], activeRel())
      return
    }
    match = RUST_RESULT.exec(line)
    if (match) {
      markResult(bareTestName(match[1]), statusFromWord(match[2]), activeRel())
      return
    }
    match = PY_RESULT.exec(line)
    if (match) {
      const rel = match[1].replace(/\\/g, '/')
      markResult(bareTestName(match[2]), statusFromWord(match[3]), rel)
      return
    }
    if (GO_PACKAGE.test(line) && /^FAIL/.test(line)) failedAny.value = true
  }

  function activeRel(): string | undefined {
    return activeRequest.value?.file || undefined
  }

  async function detect(): Promise<TestFile[]> {
    if (!isTauri()) {
      files.value = mockFiles()
      detectedAt.value = Date.now()
      return files.value
    }
    loading.value = true
    error.value = ''
    try {
      const [found, tools] = await Promise.all([
        call<TestFile[]>('tests_detect'),
        call<Record<string, string>>('tests_toolchain').catch(() => ({}))
      ])
      files.value = found
      toolchain.value = tools ?? {}
      detectedAt.value = Date.now()
      return found
    } catch (err) {
      error.value = String(err)
      files.value = []
      return []
    } finally {
      loading.value = false
    }
  }

  function requestsForAll(): TestRunRequest[] {
    return groups.value.map((group) => ({
      framework: group.framework,
      package: group.package || undefined
    }))
  }

  async function runMany(requests: TestRunRequest[]) {
    const list = requests.filter((req) => req.framework)
    if (!list.length) return
    if (runStatus.value === 'running') await cancel()
    output.value = []
    results.value = {}
    fileResults.value = {}
    failedAny.value = false
    cancelled.value = false
    exitCode.value = null
    durationMs.value = 0
    runLabel.value = ''
    runId.value = null
    runStatus.value = 'running'
    queue.value = list.slice(1)
    const first = list[0]
    activeRequest.value = first
    const started = await startNextFrom(first)
    if (!started) finalize()
  }

  async function startNextFrom(req: TestRunRequest): Promise<boolean> {
    activeRequest.value = req
    try {
      const info = await call<TestRunInfo>('test_run', { req })
      runId.value = info.id
      runLabel.value = info.label
      runCwd.value = info.cwd
      appendOutput('info', `$ ${info.label}\n`)
      return true
    } catch (err) {
      appendOutput('error', `${String(err)}\n`)
      failedAny.value = true
      if (queue.value.length) {
        const next = queue.value.shift()!
        return startNextFrom(next)
      }
      return false
    }
  }

  function runAll() {
    return runMany(requestsForAll())
  }

  function runFramework(framework: string) {
    return runMany(
      groups.value
        .filter((group) => group.framework === framework)
        .map((group) => ({ framework: group.framework, package: group.package || undefined }))
    )
  }

  function runPackage(framework: string, pkg: string) {
    return runMany([{ framework, package: pkg || undefined }])
  }

  function runFile(file: TestFile) {
    return runMany([{ framework: file.framework, file: file.rel, package: file.package || undefined }])
  }

  function runTest(file: TestFile, name: string) {
    return runMany([
      { framework: file.framework, file: file.rel, test: name, package: file.package || undefined }
    ])
  }

  async function cancel() {
    const id = runId.value
    cancelled.value = true
    queue.value = []
    if (!id) {
      if (runStatus.value === 'running') finalize()
      return
    }
    try {
      await call('test_cancel', { id })
      appendOutput('info', 'Cancelling…\n')
    } catch (err) {
      appendOutput('error', `${String(err)}\n`)
    }
  }

  function settleRunning() {
    const next: Record<string, TestStatus> = {}
    for (const [key, value] of Object.entries(results.value)) {
      next[key] = value === 'running' ? 'idle' : value
    }
    results.value = next
  }

  function finalize() {
    runId.value = null
    activeRequest.value = null
    queue.value = []
    settleRunning()
    if (cancelled.value) {
      runStatus.value = 'cancelled'
      return
    }
    runStatus.value = failedAny.value || (exitCode.value ?? 0) !== 0 ? 'failed' : 'passed'
  }

  function handleExit(payload: ExitPayload) {
    if (!payload) return
    // A run can finish before `test_run` resolves; accept the exit while the
    // session is still ours, and ignore anything from an older run.
    if (runId.value ? payload.runId !== runId.value : runStatus.value !== 'running') return
    exitCode.value = payload.code
    durationMs.value += payload.durationMs
    if (payload.code !== 0) failedAny.value = true

    const req = activeRequest.value
    if (req?.file) {
      const status: TestStatus = payload.code === 0 ? 'passed' : 'failed'
      fileResults.value = { ...fileResults.value, [req.file]: status }
      // Runners without a machine readable per-test line still get a verdict.
      if (req.framework === 'node' || req.framework === 'rust') {
        const file = files.value.find((item) => item.rel === req.file)
        for (const test of file?.tests ?? []) {
          const key = `${req.file}::${test.name}`
          if (!results.value[key]) results.value = { ...results.value, [key]: status }
        }
      }
    }

    runId.value = null
    if (!cancelled.value && queue.value.length) {
      const next = queue.value.shift()!
      void startNextFrom(next)
      return
    }
    finalize()
  }

  async function listen() {
    if (listening || !isTauri()) return
    listening = true
    await listenEvent<{ runId: string; stream: string; text: string }>('test:output', (payload) => {
      if (runId.value && payload.runId !== runId.value) return
      const stream = payload.stream === 'stderr' ? 'stderr' : 'stdout'
      appendOutput(stream, payload.text)
      parseLine(payload.text)
    })
    await listenEvent<ExitPayload>('test:exit', handleExit)
  }

  async function init() {
    await listen()
    void detect()
  }

  /** Called when the workspace changes: stop anything still running. */
  function reset() {
    queue.value = []
    cancelled.value = true
    if (runId.value) {
      const id = runId.value
      runId.value = null
      void call('test_cancel', { id }).catch(() => {})
    }
    if (isTauri()) void call('test_cancel_all').catch(() => {})
    runStatus.value = 'idle'
    activeRequest.value = null
    files.value = []
    results.value = {}
    fileResults.value = {}
    output.value = []
    error.value = ''
    failedAny.value = false
    exitCode.value = null
    durationMs.value = 0
    runLabel.value = ''
  }

  return {
    files,
    groups,
    toolchain,
    loading,
    error,
    detectedAt,
    runStatus,
    runId,
    runLabel,
    runCwd,
    activeRequest,
    cancelled,
    exitCode,
    durationMs,
    output,
    results,
    fileResults,
    active,
    hasTests,
    testCount,
    summary,
    statusColor,
    durationText,
    countStatus,
    frameworkLabel,
    fileFor,
    testAt,
    statusOf,
    fileStatus,
    isCollapsed,
    toggleCollapsed,
    appendOutput,
    clearOutput,
    detect,
    listen,
    init,
    reset,
    runAll,
    runFramework,
    runPackage,
    runFile,
    runTest,
    cancel
  }
}

/** Browser demo data so the pane renders outside Tauri. */
function mockFiles(): TestFile[] {
  return [
    {
      path: 'C:\\demo\\kudo-workspace\\src\\math.test.ts',
      rel: 'src/math.test.ts',
      framework: 'node',
      package: 'src',
      tests: []
    },
    {
      path: 'C:\\demo\\kudo-workspace\\lib\\strutil_test.go',
      rel: 'lib/strutil_test.go',
      framework: 'go',
      package: 'lib',
      tests: [
        { name: 'TestTrim', line: 14 },
        { name: 'TestSplit', line: 26 }
      ]
    },
    {
      path: 'C:\\demo\\kudo-workspace\\app\\test_models.py',
      rel: 'app/test_models.py',
      framework: 'python',
      package: 'app',
      tests: [
        { name: 'test_create', line: 9 },
        { name: 'test_update', line: 17 }
      ]
    }
  ]
}
