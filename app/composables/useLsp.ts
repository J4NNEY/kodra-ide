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

/** A location in a file, normalised to 1-based line/column. */
export interface LspLocation {
  path: string
  line: number
  column: number
  endLine: number
  endColumn: number
}

/** One entry of the document outline (flattened, with nesting depth). */
export interface LspSymbol {
  name: string
  detail: string
  kind: string
  line: number
  column: number
  depth: number
}

export interface LspRenameTarget {
  line: number
  column: number
  endLine: number
  endColumn: number
  placeholder: string
}

export interface LspCodeAction {
  title: string
  kind: string
  preferred: boolean
  edit: any | null
  command: any | null
  data: any | null
  raw: any
}

export interface AppliedEditSummary {
  files: string[]
  edits: number
  skipped: number
  written: number
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
    name: 'dart',
    languages: ['dart'],
    command: 'dart',
    args: ['language-server'],
    install: 'install the Dart SDK (https://dart.dev/get-dart) or Flutter'
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
  1: 'file',
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
  25: 'variable',
  26: 'type'
}

const SEVERITY_CODE: Record<LspDiagnostic['severity'], number> = {
  error: 1,
  warning: 2,
  info: 3,
  hint: 4
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

function rangeToLocation(path: string, range: any): LspLocation {
  return {
    path,
    line: (range?.start?.line ?? 0) + 1,
    column: (range?.start?.character ?? 0) + 1,
    endLine: (range?.end?.line ?? range?.start?.line ?? 0) + 1,
    endColumn: (range?.end?.character ?? range?.start?.character ?? 0) + 1
  }
}

/** Accept both `Location` and `LocationLink` shapes. */
function locationFrom(item: any): LspLocation | null {
  if (!item) return null
  const uri = item.uri ?? item.targetUri
  const range = item.range ?? item.targetSelectionRange ?? item.targetRange
  if (!uri || !range) return null
  return rangeToLocation(uriToPath(String(uri)), range)
}

function collectSymbols(items: unknown, depth: number, out: LspSymbol[]): void {
  if (!Array.isArray(items)) return
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, any>
    if (record.location) {
      // `SymbolInformation` (flat, with a location instead of a range).
      const location = locationFrom(record)
      if (!location) continue
      out.push({
        name: String(record.name ?? ''),
        detail: String(record.containerName ?? ''),
        kind: KIND[record.kind as number] ?? 'symbol',
        line: location.line,
        column: location.column,
        depth
      })
      continue
    }
    const range = record.selectionRange ?? record.range
    out.push({
      name: String(record.name ?? ''),
      detail: String(record.detail ?? ''),
      kind: KIND[record.kind as number] ?? 'symbol',
      line: (range?.start?.line ?? 0) + 1,
      column: (range?.start?.character ?? 0) + 1,
      depth
    })
    if (record.children) collectSymbols(record.children, depth + 1, out)
  }
}

/** LSP positions are UTF-16 code units, exactly like JavaScript string indices. */
function offsetAtText(text: string, line: number, character: number): number {
  let index = 0
  let current = 0
  while (current < line) {
    const next = text.indexOf('\n', index)
    if (next < 0) return text.length
    index = next + 1
    current++
  }
  const end = text.indexOf('\n', index)
  const limit = end < 0 ? text.length : end
  return Math.min(limit, index + Math.max(0, character))
}

function textEditOffsets(edit: any, text: string): [number, number] {
  if (!edit?.range) {
    const at = edit?.position
      ? offsetAtText(text, edit.position.line ?? 0, edit.position.character ?? 0)
      : 0
    return [at, at]
  }
  return [
    offsetAtText(text, edit.range.start?.line ?? 0, edit.range.start?.character ?? 0),
    offsetAtText(text, edit.range.end?.line ?? 0, edit.range.end?.character ?? 0)
  ]
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
    // `workspace/applyEdit` is a request *from* the server (assists, organize
    // imports, some rename flows). Apply it to the buffers and answer so the
    // server never waits forever.
    await listenEvent<{ sessionId: string; requestId: number; params: any }>(
      'lsp:apply-edit',
      async (payload) => {
        let applied = false
        let reason = ''
        try {
          const summary = await applyWorkspaceEdit(payload.params?.edit)
          applied = summary.edits > 0
          if (!applied) reason = 'The edit did not change any file'
        } catch (error) {
          reason = String(error)
        }
        try {
          await call('lsp_respond', {
            id: payload.sessionId,
            requestId: payload.requestId,
            result: applied ? { applied: true } : { applied: false, failureReason: reason }
          })
        } catch {
          /* session already gone */
        }
      }
    )
  }

  /**
   * Apply a `WorkspaceEdit` to open buffers (marking them dirty) or to disk for
   * files that are not open. Returns a small summary for the status toast.
   *
   * File operations (create/rename/delete) are counted as skipped: none of the
   * built-in actions need them, and doing them blindly would be destructive.
   */
  async function applyWorkspaceEdit(edit: any): Promise<AppliedEditSummary> {
    const summary: AppliedEditSummary = { files: [], edits: 0, skipped: 0, written: 0 }
    if (!edit) return summary

    const grouped = new Map<string, any[]>()
    const add = (uri: unknown, edits: unknown) => {
      if (!uri || !Array.isArray(edits)) return
      const path = uriToPath(String(uri))
      grouped.set(path, [...(grouped.get(path) ?? []), ...edits])
    }

    if (edit.changes && typeof edit.changes === 'object') {
      for (const [uri, edits] of Object.entries(edit.changes)) add(uri, edits)
    }
    if (Array.isArray(edit.documentChanges)) {
      for (const change of edit.documentChanges) {
        if (change?.textDocument?.uri && Array.isArray(change.edits)) {
          add(change.textDocument.uri, change.edits)
        } else {
          summary.skipped++
        }
      }
    }

    for (const [path, edits] of grouped) {
      if (!edits.length) continue
      const tab = ide.tabs.value.find((item) => item.path === path)
      let text = tab?.content
      if (typeof text !== 'string') {
        try {
          const file = await call<{ text: string }>('read_file', { path })
          text = file.text
        } catch {
          summary.skipped++
          continue
        }
      }

      // Applying from the end keeps every earlier offset valid.
      const ordered = edits
        .map((item) => {
          const [from, to] = textEditOffsets(item, text as string)
          return { from, to, newText: String(item?.newText ?? '') }
        })
        .filter((item) => item.from <= item.to)
        .sort((a, b) => b.from - a.from || b.to - a.to)

      let next = text
      for (const item of ordered) {
        next = next.slice(0, item.from) + item.newText + next.slice(item.to)
      }
      if (next === text) continue

      if (tab) {
        ide.updateContent(path, next)
      } else {
        try {
          await call('write_file', { path, text: next })
          summary.written++
        } catch {
          summary.skipped++
          continue
        }
      }
      summary.files.push(path)
      summary.edits += ordered.length
    }

    return summary
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

  /** Ensure the server and document are ready, then send one JSON-RPC request. */
  async function send<T>(
    path: string,
    method: string,
    params: any,
    text?: string
  ): Promise<T | null> {
    const languageId = languageFor(path)
    const id = await ensureServer(languageId)
    if (!id) return null
    if (typeof text === 'string') await openDocument(path, languageId, text)
    try {
      return await call<T>('lsp_request', { id, method, params })
    } catch {
      return null
    }
  }

  async function request<T>(path: string, method: string, line: number, column: number, text?: string) {
    return send<T>(
      path,
      method,
      {
        textDocument: { uri: pathToUri(path) },
        position: { line: Math.max(0, line), character: Math.max(0, column) }
      },
      text
    )
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
    const location = locationFrom(first)
    return location ? { path: location.path, line: location.line } : null
  }

  /** Every reference to the symbol at a position, including its declaration. */
  async function references(
    path: string,
    line: number,
    column: number,
    text?: string
  ): Promise<LspLocation[]> {
    const result = await send<any[]>(
      path,
      'textDocument/references',
      {
        textDocument: { uri: pathToUri(path) },
        position: { line: Math.max(0, line), character: Math.max(0, column) },
        context: { includeDeclaration: true }
      },
      text
    )
    const out: LspLocation[] = []
    const seen = new Set<string>()
    for (const item of Array.isArray(result) ? result : []) {
      const location = locationFrom(item)
      if (!location) continue
      const key = `${location.path}:${location.line}:${location.column}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(location)
    }
    return out
  }

  /** Outline of the file. `DocumentSymbol[]` and `SymbolInformation[]` both work. */
  async function documentSymbols(path: string, text?: string): Promise<LspSymbol[]> {
    const result = await send<any>(path, 'textDocument/documentSymbol', {
      textDocument: { uri: pathToUri(path) }
    }, text)
    const out: LspSymbol[] = []
    collectSymbols(result, 0, out)
    return out
  }

  /** The range the server would rename at a position, plus its suggested name. */
  async function prepareRename(
    path: string,
    line: number,
    column: number,
    text?: string
  ): Promise<LspRenameTarget | null> {
    const result = await send<any>(
      path,
      'textDocument/prepareRename',
      {
        textDocument: { uri: pathToUri(path) },
        position: { line: Math.max(0, line), character: Math.max(0, column) }
      },
      text
    )
    if (!result) return null
    const range = result.range ?? result
    if (!range?.start) return null
    const location = rangeToLocation(path, range)
    return {
      line: location.line,
      column: location.column,
      endLine: location.endLine,
      endColumn: location.endColumn,
      placeholder: typeof result.placeholder === 'string' ? result.placeholder : ''
    }
  }

  async function rename(
    path: string,
    line: number,
    column: number,
    newName: string,
    text?: string
  ): Promise<any | null> {
    return send<any>(
      path,
      'textDocument/rename',
      {
        textDocument: { uri: pathToUri(path) },
        position: { line: Math.max(0, line), character: Math.max(0, column) },
        newName
      },
      text
    )
  }

  function normaliseAction(item: any): LspCodeAction {
    return {
      title: String(item?.title ?? 'Code action'),
      kind: String(item?.kind ?? ''),
      preferred: !!item?.preferred,
      edit: item?.edit ?? null,
      command: item?.command ?? null,
      data: item?.data ?? null,
      raw: item
    }
  }

  /** Quick fixes / refactors for a 0-based range. */
  async function codeActions(
    path: string,
    line: number,
    column: number,
    endLine: number,
    endColumn: number,
    text?: string
  ): Promise<LspCodeAction[]> {
    const onLine = (item: LspDiagnostic) =>
      item.line - 1 <= endLine && item.endLine - 1 >= line
    const contextDiagnostics = diagnosticsFor(path)
      .filter(onLine)
      .map((item) => ({
        range: {
          start: { line: item.line - 1, character: item.column - 1 },
          end: {
            line: item.endLine - 1,
            character: Math.max(item.column, item.endColumn) - 1
          }
        },
        severity: SEVERITY_CODE[item.severity],
        message: item.message,
        source: item.source || undefined
      }))
    const result = await send<any[]>(
      path,
      'textDocument/codeAction',
      {
        textDocument: { uri: pathToUri(path) },
        range: {
          start: { line: Math.max(0, line), character: Math.max(0, column) },
          end: { line: Math.max(line, endLine), character: Math.max(0, endColumn) }
        },
        context: { diagnostics: contextDiagnostics }
      },
      text
    )
    return (Array.isArray(result) ? result : []).map(normaliseAction)
  }

  /** Some servers defer the edit until the action is resolved. */
  async function resolveCodeAction(
    path: string,
    action: LspCodeAction,
    text?: string
  ): Promise<LspCodeAction> {
    if (action.edit || action.data === null || action.data === undefined) return action
    const resolved = await send<any>(path, 'codeAction/resolve', action.raw, text)
    return resolved ? normaliseAction({ ...action.raw, ...resolved }) : action
  }

  async function executeCommand(path: string, command: any, text?: string): Promise<any | null> {
    if (!command) return null
    return send<any>(path, 'workspace/executeCommand', command, text)
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
    definition,
    references,
    documentSymbols,
    prepareRename,
    rename,
    codeActions,
    resolveCodeAction,
    executeCommand,
    applyWorkspaceEdit
  }
}
