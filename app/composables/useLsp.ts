import { computed } from 'vue'
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { snippetCompletion } from '@codemirror/autocomplete'
import { call, isTauri, languageFor, listen as listenEvent } from '../lib/api'

/** A diagnostic normalised to 1-based line/column for the editor. */
export interface LspDiagnostic {
  path: string
  line: number
  column: number
  endLine: number
  endColumn: number
  message: string
  severity: 'error' | 'warning' | 'info' | 'hint'
  source: string
}

interface ServerSpec {
  name: string
  languages: string[]
  command: string
  args: string[]
  install: string
}

interface SessionState {
  id: string
  name: string
  status: 'starting' | 'ready' | 'failed'
  error?: string
}

const CATALOG: ServerSpec[] = [
  {
    name: 'rust-analyzer',
    languages: ['rust'],
    command: 'rust-analyzer',
    args: [],
    install: 'rustup component add rust-analyzer'
  },
  {
    name: 'gopls',
    languages: ['go'],
    command: 'gopls',
    args: [],
    install: 'go install golang.org/x/tools/gopls@latest'
  },
  {
    name: 'typescript-language-server',
    languages: ['typescript', 'javascript'],
    command: 'typescript-language-server',
    args: ['--stdio'],
    install: 'npm install -g typescript-language-server typescript'
  },
  {
    name: 'pyright',
    languages: ['python'],
    command: 'pyright-langserver',
    args: ['--stdio'],
    install: 'npm install -g pyright'
  },
  {
    name: 'vscode-json-language-server',
    languages: ['json'],
    command: 'vscode-json-language-server',
    args: ['--stdio'],
    install: 'npm install -g vscode-langservers-extracted'
  },
  {
    name: 'vscode-css-language-server',
    languages: ['css'],
    command: 'vscode-css-language-server',
    args: ['--stdio'],
    install: 'npm install -g vscode-langservers-extracted'
  },
  {
    name: 'vscode-html-language-server',
    languages: ['html'],
    command: 'vscode-html-language-server',
    args: ['--stdio'],
    install: 'npm install -g vscode-langservers-extracted'
  }
]

const SEVERITY: Record<number, LspDiagnostic['severity']> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'hint'
}

const KIND: Record<number, string> = {
  2: 'method',
  3: 'function',
  4: 'function',
  5: 'property',
  6: 'variable',
  7: 'class',
  8: 'interface',
  9: 'namespace',
  10: 'property',
  11: 'class',
  12: 'interface',
  13: 'class',
  14: 'keyword',
  15: 'text',
  16: 'text',
  17: 'text',
  18: 'text',
  19: 'type',
  20: 'constant',
  21: 'constant',
  22: 'struct',
  23: 'keyword',
  24: 'keyword',
  25: 'variable'
}

// Module state: one server session per language for the whole app.
const starting = new Map<string, Promise<string | null>>()
const openedDocs = new Map<string, number>()
const docVersion = new Map<string, number>()
/** Number of editor views currently holding a document open. */
const docRefs = new Map<string, number>()

function pathToUri(path: string): string {
  const normalised = path.replace(/\\/g, '/')
  const encoded = normalised
    .replace(/%/g, '%25')
    .replace(/ /g, '%20')
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F')
  return encoded.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`
}

function uriToPath(uri: string): string {
  let rest = uri.replace(/^file:\/\//, '')
  try {
    rest = decodeURIComponent(rest)
  } catch {
    /* keep the raw value */
  }
  if (/^\/[a-zA-Z]:/.test(rest)) rest = rest.slice(1)
  if (/^[a-z]:/.test(rest)) rest = rest[0].toUpperCase() + rest.slice(1)
  return rest.replace(/\//g, '\\')
}

function toMarkdown(contents: unknown): string {
  if (!contents) return ''
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) return contents.map(toMarkdown).filter(Boolean).join('\n\n')
  if (typeof contents === 'object') {
    const record = contents as Record<string, unknown>
    if (typeof record.language === 'string' && typeof record.value === 'string') {
      return '```' + record.language + '\n' + record.value + '\n```'
    }
    if (typeof record.value === 'string') return record.value
  }
  return ''
}

export function useLsp() {
  const ide = useIde()
  const detected = useState<Record<string, string>>('kudo:lsp-detected', () => ({}))
  const disabled = useState<string[]>('kudo:lsp-disabled', () => [])
  const sessions = useState<Record<string, SessionState>>('kudo:lsp-sessions', () => ({}))
  const diagnostics = useState<Record<string, LspDiagnostic[]>>('kudo:lsp-diagnostics', () => ({}))
  const ready = useState<boolean>('kudo:lsp-listening', () => false)

  const specs = computed(() =>
    CATALOG.map((spec) => ({
      ...spec,
      path: detected.value[spec.command] ?? '',
      enabled: !disabled.value.includes(spec.name)
    }))
  )

  const allDiagnostics = computed(() =>
    Object.values(diagnostics.value)
      .flat()
      .sort((a, b) => (a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path)))
  )

  const errorCount = computed(() => allDiagnostics.value.filter((d) => d.severity === 'error').length)
  const warningCount = computed(
    () => allDiagnostics.value.filter((d) => d.severity === 'warning').length
  )

  function diagnosticsFor(path: string): LspDiagnostic[] {
    return diagnostics.value[path] ?? []
  }

  function specFor(language: string): ServerSpec | undefined {
    return CATALOG.find((spec) => spec.languages.includes(language))
  }

  function sessionFor(language: string): SessionState | undefined {
    const spec = specFor(language)
    return spec ? sessions.value[spec.name] : undefined
  }

  function isSupported(language: string): boolean {
    const spec = specFor(language)
    if (!spec) return false
    return !disabled.value.includes(spec.name)
  }

  async function detect(): Promise<Record<string, string>> {
    try {
      detected.value = await call<Record<string, string>>('lsp_detect')
    } catch {
      detected.value = {}
    }
    return detected.value
  }

  function toggle(name: string, enabled: boolean) {
    const next = new Set(disabled.value)
    if (enabled) next.delete(name)
    else next.add(name)
    disabled.value = [...next]
    if (!enabled) {
      const session = sessions.value[name]
      if (session?.id) void call('lsp_stop', { id: session.id }).catch(() => {})
      const { [name]: _removed, ...rest } = sessions.value
      sessions.value = rest
    }
  }

  function reset() {
    for (const session of Object.values(sessions.value)) {
      if (session.id) void call('lsp_stop', { id: session.id }).catch(() => {})
    }
    sessions.value = {}
    diagnostics.value = {}
    openedDocs.clear()
    docVersion.clear()
    docRefs.clear()
    starting.clear()
  }

  async function listen(): Promise<void> {
    if (ready.value || !isTauri()) return
    ready.value = true
    await listenEvent<{
      sessionId: string
      method: string
      params: any
    }>('lsp:notification', (payload) => {
      if (payload.method !== 'textDocument/publishDiagnostics') return
      const path = uriToPath(String(payload.params?.uri ?? ''))
      if (!path) return
      const incoming: LspDiagnostic[] = (payload.params?.diagnostics ?? []).map((item: any) => ({
        path,
        line: (item.range?.start?.line ?? 0) + 1,
        column: (item.range?.start?.character ?? 0) + 1,
        endLine: (item.range?.end?.line ?? item.range?.start?.line ?? 0) + 1,
        endColumn: (item.range?.end?.character ?? item.range?.start?.character ?? 0) + 1,
        message: String(item.message ?? ''),
        severity: SEVERITY[item.severity as number] ?? 'info',
        source: String(item.source ?? '')
      }))
      const next = { ...diagnostics.value }
      if (incoming.length) next[path] = incoming
      else delete next[path]
      diagnostics.value = next
    })
    await listenEvent<{ sessionId: string; error: string }>('lsp:exit', (payload) => {
      const entry = Object.entries(sessions.value).find(([, s]) => s.id === payload.sessionId)
      if (!entry) return
      // The next attempt must re-open documents on the fresh server process.
      openedDocs.clear()
      docVersion.clear()
      sessions.value = {
        ...sessions.value,
        [entry[0]]: { ...entry[1], status: 'failed', error: payload.error }
      }
    })
  }

  async function ensureServer(language: string): Promise<string | null> {
    if (!isTauri()) return null
    const spec = specFor(language)
    if (!spec || disabled.value.includes(spec.name)) return null

    const current = sessions.value[spec.name]
    if (current?.status === 'ready') return current.id
    const pending = starting.get(spec.name)
    if (pending) return pending

    const workspace = ide.workspace.value?.path
    if (!workspace) return null

    const promise = (async () => {
      await listen()
      if (!detected.value[spec.command]) await detect()
      const command = detected.value[spec.command]
      if (!command) {
        sessions.value = {
          ...sessions.value,
          [spec.name]: {
            id: '',
            name: spec.name,
            status: 'failed',
            error: `${spec.command} is not installed`
          }
        }
        return null
      }

      sessions.value = {
        ...sessions.value,
        [spec.name]: { id: '', name: spec.name, status: 'starting' }
      }
      try {
        const started = await call<{ id: string; name: string }>('lsp_start', {
          req: {
            name: spec.name,
            command,
            args: spec.args,
            rootUri: pathToUri(workspace)
          }
        })
        sessions.value = {
          ...sessions.value,
          [spec.name]: { id: started.id, name: spec.name, status: 'ready' }
        }
        return started.id
      } catch (error) {
        sessions.value = {
          ...sessions.value,
          [spec.name]: {
            id: '',
            name: spec.name,
            status: 'failed',
            error: String(error)
          }
        }
        return null
      } finally {
        starting.delete(spec.name)
      }
    })()

    starting.set(spec.name, promise)
    return promise
  }

  async function openDocument(path: string, language: string, text: string): Promise<void> {
    const languageId = language === 'plaintext' ? languageFor(path) : language
    const id = await ensureServer(languageId)
    if (!id) return
    if (openedDocs.has(path)) {
      await changeDocument(path, text)
      return
    }
    const version = 1
    docVersion.set(path, version)
    openedDocs.set(path, version)
    try {
      await call('lsp_notify', {
        id,
        method: 'textDocument/didOpen',
        params: {
          textDocument: { uri: pathToUri(path), languageId, version, text }
        }
      })
    } catch {
      openedDocs.delete(path)
    }
  }

  async function changeDocument(path: string, text: string): Promise<void> {
    const languageId = languageFor(path)
    if (!openedDocs.has(path)) return openDocument(path, languageId, text)
    const id = sessionFor(languageId)?.id
    if (!id) return
    const version = (docVersion.get(path) ?? 1) + 1
    docVersion.set(path, version)
    try {
      await call('lsp_notify', {
        id,
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri: pathToUri(path), version },
          contentChanges: [{ text }]
        }
      })
    } catch {
      /* the server may be restarting */
    }
  }

  async function closeDocument(path: string): Promise<void> {
    const languageId = languageFor(path)
    if (!openedDocs.has(path)) return
    openedDocs.delete(path)
    docVersion.delete(path)
    const id = sessionFor(languageId)?.id
    if (!id) return
    try {
      await call('lsp_notify', {
        id,
        method: 'textDocument/didClose',
        params: { textDocument: { uri: pathToUri(path) } }
      })
    } catch {
      /* ignore */
    }
    if (diagnostics.value[path]) {
      const next = { ...diagnostics.value }
      delete next[path]
      diagnostics.value = next
    }
  }

  /** Track one editor view holding `path` open (two panes can show the same file). */
  async function acquireDocument(path: string, language: string, text: string): Promise<void> {
    docRefs.set(path, (docRefs.get(path) ?? 0) + 1)
    await openDocument(path, language, text)
  }

  /** Release a view; the server only receives didClose when the last one goes. */
  async function releaseDocument(path: string): Promise<void> {
    const refs = (docRefs.get(path) ?? 1) - 1
    if (refs > 0) {
      docRefs.set(path, refs)
      return
    }
    docRefs.delete(path)
    await closeDocument(path)
  }

  async function request<T>(path: string, method: string, line: number, column: number, text?: string) {
    const languageId = languageFor(path)
    const id = await ensureServer(languageId)
    if (!id) return null
    if (typeof text === 'string') await openDocument(path, languageId, text)
    try {
      return await call<T>('lsp_request', {
        id,
        method,
        params: {
          textDocument: { uri: pathToUri(path) },
          position: { line: Math.max(0, line), character: Math.max(0, column) }
        }
      })
    } catch {
      return null
    }
  }

  async function complete(
    path: string,
    line: number,
    column: number,
    explicit: boolean,
    trigger?: string,
    text?: string
  ): Promise<Completion[]> {
    const languageId = languageFor(path)
    const id = await ensureServer(languageId)
    if (!id) return []
    // The editor debounces document sync; a completion request must not race it,
    // otherwise the server answers for the text as it was before the keystroke.
    if (typeof text === 'string') await openDocument(path, languageId, text)
    try {
      const result = await call<any>('lsp_request', {
        id,
        method: 'textDocument/completion',
        params: {
          textDocument: { uri: pathToUri(path) },
          position: { line: Math.max(0, line), character: Math.max(0, column) },
          context: trigger
            ? { triggerKind: 2, triggerCharacter: trigger }
            : { triggerKind: explicit ? 1 : 2 }
        }
      })
      const items: any[] = Array.isArray(result) ? result : (result?.items ?? [])
      return items.slice(0, 300).map((item) => {
        const insert: string = item.textEdit?.newText ?? item.insertText ?? item.label ?? ''
        const label = String(item.label ?? insert)
        const info =
          typeof item.documentation === 'string'
            ? item.documentation
            : item.documentation?.value ?? item.detail ?? ''
        const type = KIND[item.kind as number] ?? 'text'
        if (item.insertTextFormat === 2) {
          const snippet = insert.replace(/\$0/g, '${}')
          return snippetCompletion(snippet, { label, detail: item.detail, type, info })
        }
        return { label, apply: insert, detail: item.detail, type, info }
      })
    } catch {
      return []
    }
  }

  async function hover(path: string, line: number, column: number, text?: string): Promise<string> {
    const result = await request<any>(path, 'textDocument/hover', line, column, text)
    return toMarkdown(result?.contents)
  }

  async function definition(
    path: string,
    line: number,
    column: number,
    text?: string
  ): Promise<{ path: string; line: number } | null> {
    const result = await request<any>(path, 'textDocument/definition', line, column, text)
    const first = Array.isArray(result) ? result[0] : result
    if (!first?.uri) return null
    return { path: uriToPath(String(first.uri)), line: (first.range?.start?.line ?? 0) + 1 }
  }

  /** Completion source bound to one file, used by the CodeMirror editor. */
  function completionSource(path: string) {
    return async (context: CompletionContext): Promise<CompletionResult | null> => {
      if (!isSupported(languageFor(path))) return null
      const word = context.matchBefore(/[\w$#@-]*/)
      if (!word) return null
      // Servers want an explicit request after a trigger character (`.` reads as
      // a member access, not a new word), and CodeMirror needs a reason to open
      // the popup when there is no prefix yet.
      const before = word.from > 0 ? context.state.sliceDoc(word.from - 1, word.from) : ''
      const trigger = /[.:@#/<>]/.test(before) ? before : ''
      if (!context.explicit && !trigger && word.from === word.to) return null
      const line = context.state.doc.lineAt(context.pos)
      const items = await complete(
        path,
        line.number - 1,
        context.pos - line.from,
        context.explicit,
        trigger || undefined,
        context.state.doc.toString()
      )
      if (!items.length) return null
      return { from: word.from, options: items, validFor: /^[\w$#@-]*$/ }
    }
  }

  return {
    catalog: CATALOG,
    specs,
    detected,
    disabled,
    sessions,
    diagnostics,
    diagnosticsFor,
    allDiagnostics,
    errorCount,
    warningCount,
    detect,
    toggle,
    reset,
    listen,
    isSupported,
    openDocument,
    changeDocument,
    closeDocument,
    acquireDocument,
    releaseDocument,
    complete,
    completionSource,
    hover,
    definition
  }
}
