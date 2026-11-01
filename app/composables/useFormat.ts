import { computed } from 'vue'
import { call, isTauri, languageFor } from '../lib/api'
import { defaultSettings } from '../lib/defaults'
import type { Settings } from '../lib/types'

/** A formatter or linter the backend knows about. */
export interface FormatTool {
  id: string
  label: string
  /** `formatter` or `linter`. */
  kind: 'formatter' | 'linter'
  languages: string[]
  /** Resolved executable (or wrapper script); empty when not installed. */
  path: string
  /** `workspace`, `path` or empty when missing. */
  scope: string
  install: string
}

export interface FormatOutcome {
  /** Empty when no formatter covers this file. */
  tool: string
  changed: boolean
  text: string
  /** Non-empty when the formatter rejected the buffer. */
  error: string
}

export interface LintIssue {
  line: number
  column: number
  endLine: number
  endColumn: number
  message: string
  severity: 'error' | 'warning' | 'info'
  source: string
  code: string
}

export interface LintOutcome {
  /** Empty when no linter covers this file. */
  tool: string
  issues: LintIssue[]
  /** Raw output when the linter result could not be parsed. */
  raw: string
  /** Non-empty when the linter itself failed. */
  error: string
}

/** A lint issue tagged with the file it belongs to (Problems panel shape). */
export interface LintDiagnostic extends LintIssue {
  path: string
}

/** Linters can be slow; keep the last run per file and reuse it on re-save. */
const MAX_CACHED_FILES = 40

export function useFormat() {
  // Same state key as `useIde`, so toggles and the settings dialog stay in sync
  // without making this composable depend on the IDE one.
  const settings = useState<Settings>('kudo:settings', () => structuredClone(defaultSettings))
  const tools = useState<FormatTool[]>('kudo:format-tools', () => [])
  const detectedAt = useState<number>('kudo:format-detected-at', () => 0)
  const busy = useState<boolean>('kudo:format-busy', () => false)
  const lastTool = useState<string>('kudo:format-last-tool', () => '')
  const lastPath = useState<string>('kudo:format-last-path', () => '')
  const issues = useState<Record<string, LintIssue[]>>('kudo:lint-issues', () => ({}))
  const errors = useState<Record<string, string>>('kudo:lint-errors', () => ({}))
  const lintedAt = useState<Record<string, number>>('kudo:lint-last', () => ({}))

  const formatOnSave = computed(() => settings.value.formatOnSave)
  const lintOnSave = computed(() => settings.value.lintOnSave)
  const formatters = computed(() => tools.value.filter((tool) => tool.kind === 'formatter'))
  const linters = computed(() => tools.value.filter((tool) => tool.kind === 'linter'))

  const lintDiagnostics = computed<LintDiagnostic[]>(() =>
    Object.entries(issues.value)
      .flatMap(([path, list]) => list.map((issue) => ({ ...issue, path })))
      .sort((a, b) =>
        a.path === b.path ? a.line - b.line || a.column - b.column : a.path.localeCompare(b.path)
      )
  )

  const lintErrorCount = computed(
    () => lintDiagnostics.value.filter((issue) => issue.severity === 'error').length
  )
  const lintWarningCount = computed(
    () => lintDiagnostics.value.filter((issue) => issue.severity === 'warning').length
  )

  function installed(tool: FormatTool): boolean {
    return Boolean(tool.path)
  }

  function formatterFor(language: string): FormatTool | undefined {
    return formatters.value.find((tool) => installed(tool) && tool.languages.includes(language))
  }

  function linterFor(language: string): FormatTool | undefined {
    return linters.value.find((tool) => installed(tool) && tool.languages.includes(language))
  }

  function toolFor(path: string, kind: 'formatter' | 'linter'): FormatTool | undefined {
    const language = languageFor(path)
    return kind === 'formatter' ? formatterFor(language) : linterFor(language)
  }

  async function detect(): Promise<FormatTool[]> {
    busy.value = true
    try {
      tools.value = await call<FormatTool[]>('format_toolchain')
      detectedAt.value = Date.now()
      return tools.value
    } catch {
      tools.value = []
      return []
    } finally {
      busy.value = false
    }
  }

  /**
   * Format one buffer. Never throws: a rejected buffer comes back unchanged
   * with `error` set so the caller can still save the file.
   */
  async function formatText(path: string, text: string, tool?: string): Promise<FormatOutcome> {
    if (!path) return { tool: '', changed: false, text, error: '' }
    busy.value = true
    try {
      const result = await call<{ tool: string; changed: boolean; text: string }>('format_document', {
        path,
        text,
        tool: tool ?? null
      })
      if (result.changed) {
        lastTool.value = result.tool
        lastPath.value = path
      }
      return { ...result, error: '' }
    } catch (err) {
      return { tool: tool ?? '', changed: false, text, error: String(err) }
    } finally {
      busy.value = false
    }
  }

  /**
   * Run the linter for `path` and store what it reported. Returns null when no
   * linter is installed for this language.
   */
  async function lintText(path: string, text: string): Promise<LintOutcome | null> {
    if (!path) return null
    try {
      const result = await call<LintOutcome>('lint_document', { path, text })
      const nextIssues = { ...issues.value }
      const nextErrors = { ...errors.value }
      if (!result.tool) {
        delete nextIssues[path]
        delete nextErrors[path]
      } else {
        nextIssues[path] = result.issues
        if (result.error) nextErrors[path] = result.error
        else delete nextErrors[path]
        lintedAt.value = { ...lintedAt.value, [path]: Date.now() }
        prune(nextIssues)
      }
      issues.value = nextIssues
      errors.value = nextErrors
      return result
    } catch (err) {
      errors.value = { ...errors.value, [path]: String(err) }
      return null
    }
  }

  function prune(next: Record<string, LintIssue[]>) {
    const paths = Object.keys(lintedAt.value)
    if (paths.length <= MAX_CACHED_FILES) return
    const keep = paths
      .sort((a, b) => (lintedAt.value[b] ?? 0) - (lintedAt.value[a] ?? 0))
      .slice(0, MAX_CACHED_FILES)
    for (const path of paths) {
      if (!keep.includes(path)) delete next[path]
    }
  }

  function issuesFor(path: string): LintIssue[] {
    return issues.value[path] ?? []
  }

  function errorFor(path: string): string {
    return errors.value[path] ?? ''
  }

  function clearPath(path: string) {
    if (!issues.value[path] && !errors.value[path]) return
    const nextIssues = { ...issues.value }
    const nextErrors = { ...errors.value }
    delete nextIssues[path]
    delete nextErrors[path]
    issues.value = nextIssues
    errors.value = nextErrors
  }

  function reset() {
    issues.value = {}
    errors.value = {}
    lintedAt.value = {}
    lastTool.value = ''
    lastPath.value = ''
  }

  /** Persist the two save-time toggles, then report the new values. */
  async function toggleFormatOnSave(): Promise<boolean> {
    const next = { ...settings.value, formatOnSave: !settings.value.formatOnSave }
    settings.value = next
    if (isTauri()) await call('save_settings', { settings: next }).catch(() => {})
    return next.formatOnSave
  }

  async function toggleLintOnSave(): Promise<boolean> {
    const next = { ...settings.value, lintOnSave: !settings.value.lintOnSave }
    settings.value = next
    if (isTauri()) await call('save_settings', { settings: next }).catch(() => {})
    return next.lintOnSave
  }

  return {
    settings,
    tools,
    detectedAt,
    busy,
    lastTool,
    lastPath,
    issues,
    errors,
    lintedAt,
    formatOnSave,
    lintOnSave,
    formatters,
    linters,
    lintDiagnostics,
    lintErrorCount,
    lintWarningCount,
    formatterFor,
    linterFor,
    toolFor,
    detect,
    formatText,
    lintText,
    issuesFor,
    errorFor,
    clearPath,
    reset,
    toggleFormatOnSave,
    toggleLintOnSave
  }
}
