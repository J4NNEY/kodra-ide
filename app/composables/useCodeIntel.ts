import type { LspCodeAction, LspHierarchyKind } from './useLsp'
import { call } from '../lib/api'

export interface RenameState {
  path: string
  line: number
  column: number
  value: string
  placeholder: string
  busy: boolean
  error: string
}

/** One row of the references list or the symbol picker. */
export interface CodeIntelItem {
  label: string
  detail: string
  preview: string
  path: string
  line: number
  column: number
  depth: number
  kind?: string
}

export interface CodeIntelListState {
  mode: 'references' | 'symbols' | 'workspace-symbols' | 'hierarchy'
  title: string
  items: CodeIntelItem[]
  loading: boolean
}

export interface CodeActionState {
  path: string
  line: number
  column: number
  endLine: number
  endColumn: number
  items: LspCodeAction[]
  loading: boolean
}

interface CursorTarget {
  path: string
  language: string
  line: number
  column: number
  text: string
}

/**
 * Cursor-driven code intelligence UI: rename, references, outline and quick
 * fixes. Requests live in `useLsp`; this composable owns the overlays and
 * turns server positions into editor navigation.
 */
export function useCodeIntel() {
  const ide = useIde()
  const lsp = useLsp()
  const cursor = useState('kudo:cursor', () => ({ line: 1, column: 1, selected: 0 }))

  const rename = useState<RenameState | null>('kudo:codeintel-rename', () => null)
  const list = useState<CodeIntelListState | null>('kudo:codeintel-list', () => null)
  const actions = useState<CodeActionState | null>('kudo:codeintel-actions', () => null)
  /** Guards workspace-symbol answers against slower earlier requests. */
  const workspaceSeq = useState<number>('kudo:codeintel-ws-seq', () => 0)

  const anyOpen = computed(() => !!rename.value || !!list.value || !!actions.value)

  /** 0-based LSP position for the focused editor. */
  function target(): CursorTarget | null {
    const tab = ide.activeTab.value
    if (!tab || tab.binary) return null
    return {
      path: tab.path,
      language: tab.language,
      line: Math.max(0, cursor.value.line - 1),
      column: Math.max(0, cursor.value.column - 1),
      text: tab.content
    }
  }

  function relative(path: string): string {
    const root = ide.workspace.value?.path ?? ''
    if (root && path.toLowerCase().startsWith(root.toLowerCase())) {
      return path.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
    }
    return path.split(/[\\/]/).pop() ?? path
  }

  function wordAt(text: string, line: number, column: number) {
    const source = text.split(/\r?\n/)[line] ?? ''
    const pattern = /[A-Za-z_$][\w$]*/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source))) {
      const start = match.index
      const end = start + match[0].length
      if (column >= start && column <= end) return match[0]
    }
    return ''
  }

  async function openRename(): Promise<void> {
    const target_ = target()
    if (!target_) {
      ide.notify('Open a text file to rename a symbol', 'info')
      return
    }
    if (!lsp.isSupported(target_.language)) {
      ide.notify(`No language server is available for ${target_.language}`, 'info')
      return
    }
    const prepared = await lsp.prepareRename(
      target_.path,
      target_.line,
      target_.column,
      target_.text
    )
    const fallback = wordAt(target_.text, target_.line, target_.column)
    const placeholder = prepared?.placeholder || fallback
    if (!placeholder) {
      ide.notify('Nothing to rename at the cursor', 'info')
      return
    }
    rename.value = {
      path: target_.path,
      line: target_.line,
      column: target_.column,
      value: placeholder,
      placeholder,
      busy: false,
      error: ''
    }
  }

  async function submitRename(name: string): Promise<void> {
    const state = rename.value
    if (!state || state.busy) return
    if (name === state.placeholder) {
      rename.value = null
      return
    }
    state.busy = true
    state.error = ''
    const tab = ide.tabs.value.find((item) => item.path === state.path)
    const edit = await lsp.rename(
      state.path,
      state.line,
      state.column,
      name,
      tab?.content
    )
    if (!edit) {
      state.busy = false
      state.error = 'The language server could not rename this symbol.'
      return
    }
    const summary = await lsp.applyWorkspaceEdit(edit)
    if (!summary.edits) {
      state.busy = false
      state.error = 'The language server returned no edits.'
      return
    }
    rename.value = null
    const files = summary.files.length
    ide.notify(
      `Renamed “${state.placeholder}” to “${name}” in ${files} file${files === 1 ? '' : 's'}`,
      'success'
    )
    if (summary.skipped) {
      ide.notify(`${summary.skipped} edit${summary.skipped === 1 ? '' : 's'} could not be applied`, 'error')
    }
  }

  function cancelRename(): void {
    if (rename.value?.busy) return
    rename.value = null
  }

  async function readPreviews(paths: string[]): Promise<Map<string, string[]>> {
    const cache = new Map<string, string[]>()
    for (const path of [...new Set(paths)]) {
      let text = ide.tabs.value.find((tab) => tab.path === path)?.content
      if (typeof text !== 'string') {
        try {
          const file = await call<{ text: string }>('read_file', { path, allowOutside: true })
          text = file.text
        } catch {
          text = ''
        }
      }
      cache.set(path, text.split(/\r?\n/))
    }
    return cache
  }

  async function openReferences(): Promise<void> {
    const target_ = target()
    if (!target_) {
      ide.notify('Open a text file to find references', 'info')
      return
    }
    if (!lsp.isSupported(target_.language)) {
      ide.notify(`No language server is available for ${target_.language}`, 'info')
      return
    }
    list.value = {
      mode: 'references',
      title: 'Finding references…',
      items: [],
      loading: true
    }
    const locations = await lsp.references(
      target_.path,
      target_.line,
      target_.column,
      target_.text
    )
    if (!list.value) return
    if (!locations.length) {
      list.value = null
      ide.notify('No references found', 'info')
      return
    }
    const previews = await readPreviews(locations.map((location) => location.path))
    if (!list.value) return
    const items: CodeIntelItem[] = locations.slice(0, 500).map((location) => ({
      label: relative(location.path),
      detail: `Ln ${location.line}, Col ${location.column}`,
      preview: (previews.get(location.path)?.[location.line - 1] ?? '').trim().slice(0, 160),
      path: location.path,
      line: location.line,
      column: location.column,
      depth: 0
    }))
    list.value = {
      mode: 'references',
      title: `${locations.length} reference${locations.length === 1 ? '' : 's'}`,
      items,
      loading: false
    }
  }

  async function openSymbols(): Promise<void> {
    const target_ = target()
    if (!target_) {
      ide.notify('Open a text file to list its symbols', 'info')
      return
    }
    if (!lsp.isSupported(target_.language)) {
      ide.notify(`No language server is available for ${target_.language}`, 'info')
      return
    }
    const tab = ide.activeTab.value
    list.value = {
      mode: 'symbols',
      title: 'Loading symbols…',
      items: [],
      loading: true
    }
    const symbols = await lsp.documentSymbols(target_.path, target_.text)
    if (!list.value) return
    if (!symbols.length) {
      list.value = null
      ide.notify('The language server returned no symbols for this file', 'info')
      return
    }
    list.value = {
      mode: 'symbols',
      title: `Symbols — ${tab?.name ?? 'file'}`,
      items: symbols.map((symbol) => ({
        label: symbol.name,
        detail: symbol.detail || symbol.kind,
        preview: '',
        path: target_.path,
        line: symbol.line,
        column: symbol.column,
        depth: symbol.depth
      })),
      loading: false
    }
  }

  async function openWorkspaceSymbols(): Promise<void> {
    const tab = ide.activeTab.value
    const language = tab && !tab.binary && lsp.isSupported(tab.language) ? tab.language : ''
    const ready = Object.values(lsp.sessions.value).some((session) => session.status === 'ready')
    if (!language && !ready) {
      ide.notify('Open a supported file to search workspace symbols', 'info')
      return
    }
    list.value = {
      mode: 'workspace-symbols',
      title: 'Workspace symbols',
      items: [],
      loading: true
    }
    // Some servers answer an empty query with everything; others (Dart) only
    // answer real queries, so the list also re-queries while the user types.
    await searchWorkspaceSymbols('')
  }

  /** Replace the workspace-symbol list with the server's answer for `query`. */
  async function searchWorkspaceSymbols(query: string): Promise<void> {
    const state = list.value
    if (!state || state.mode !== 'workspace-symbols') return
    const tab = ide.activeTab.value
    const language = tab && !tab.binary && lsp.isSupported(tab.language) ? tab.language : ''
    const seq = ++workspaceSeq.value
    state.loading = true
    const symbols = await lsp.workspaceSymbols(query, language)
    if (seq !== workspaceSeq.value) return
    const current = list.value
    if (!current || current.mode !== 'workspace-symbols') return
    const kept = symbols.slice(0, 1000)
    current.loading = false
    current.items = kept.map((symbol) => ({
      label: symbol.name,
      detail: symbol.detail || symbol.kind,
      preview: relative(symbol.path),
      path: symbol.path,
      line: symbol.line,
      column: symbol.column,
      depth: 0,
      kind: symbol.kind
    }))
    const term = query.trim()
    current.title = term
      ? kept.length
        ? `${kept.length} symbol${kept.length === 1 ? '' : 's'} for “${term}”`
        : `No symbols for “${term}”`
      : kept.length
        ? `${kept.length} workspace symbol${kept.length === 1 ? '' : 's'}`
        : 'Workspace symbols'
  }

  /**
   * One level of the call or type hierarchy around the symbol at the cursor.
   * The overlay rows navigate like reference rows.
   */
  async function openHierarchy(kind: LspHierarchyKind): Promise<void> {
    const target_ = target()
    if (!target_) {
      ide.notify('Open a text file to inspect its hierarchy', 'info')
      return
    }
    if (!lsp.isSupported(target_.language)) {
      ide.notify(`No language server is available for ${target_.language}`, 'info')
      return
    }
    const isCall = kind === 'callers' || kind === 'callees'
    const prepared = await lsp.prepareHierarchy(
      target_.path,
      target_.line,
      target_.column,
      isCall ? 'call' : 'type',
      target_.text
    )
    if (!prepared.length) {
      ide.notify(isCall ? 'Nothing callable at the cursor' : 'No type at the cursor', 'info')
      return
    }
    const root = prepared[0]!
    const name = root.name || target_.language
    const titles: Record<LspHierarchyKind, string> = {
      callers: `Callers of “${name}”`,
      callees: `Calls made by “${name}”`,
      supertypes: `Supertypes of “${name}”`,
      subtypes: `Subtypes of “${name}”`
    }
    list.value = {
      mode: 'hierarchy',
      title: titles[kind],
      items: [],
      loading: true
    }
    const related = await lsp.hierarchy(kind, root)
    const current = list.value
    if (!current || current.mode !== 'hierarchy') return
    current.loading = false
    current.items = related.map((entry) => ({
      label: entry.name,
      detail: entry.detail || entry.kind,
      preview: relative(entry.path),
      path: entry.path,
      line: entry.line,
      column: entry.column,
      depth: 0,
      kind: entry.kind
    }))
    current.title = related.length
      ? `${titles[kind]} · ${related.length}`
      : `${titles[kind]} · none`
  }

  async function openActions(): Promise<void> {    const target_ = target()
    if (!target_) {
      ide.notify('Open a text file to run a code action', 'info')
      return
    }
    if (!lsp.isSupported(target_.language)) {
      ide.notify(`No language server is available for ${target_.language}`, 'info')
      return
    }
    actions.value = {
      path: target_.path,
      line: target_.line,
      column: target_.column,
      endLine: target_.line,
      endColumn: target_.column,
      items: [],
      loading: true
    }
    const items = await lsp.codeActions(
      target_.path,
      target_.line,
      target_.column,
      target_.line,
      target_.column,
      target_.text
    )
    if (!actions.value) return
    if (!items.length) {
      actions.value = null
      ide.notify('No code actions at this position', 'info')
      return
    }
    actions.value = { ...actions.value, items, loading: false }
  }

  async function runAction(action: LspCodeAction): Promise<void> {
    const state = actions.value
    if (!state) return
    const text = ide.tabs.value.find((tab) => tab.path === state.path)?.content
    const resolved = await lsp.resolveCodeAction(state.path, action, text)
    let summary = null
    if (resolved.edit) summary = await lsp.applyWorkspaceEdit(resolved.edit)
    if (!summary?.edits && resolved.command) {
      const result = await lsp.executeCommand(state.path, resolved.command, text)
      if (result && typeof result === 'object' && (result.changes || result.documentChanges)) {
        summary = await lsp.applyWorkspaceEdit(result)
      }
    }
    actions.value = null
    if (summary?.edits) {
      const files = summary.files.length
      ide.notify(
        `${action.title} · ${files} file${files === 1 ? '' : 's'} changed`,
        'success'
      )
      if (summary.skipped) {
        ide.notify(`${summary.skipped} edit${summary.skipped === 1 ? '' : 's'} could not be applied`, 'error')
      }
    } else if (resolved.command) {
      ide.notify(`${action.title} executed`, 'success')
    } else {
      ide.notify('The code action produced no changes', 'info')
    }
  }

  function cancelList(): void {
    list.value = null
  }

  function cancelActions(): void {
    actions.value = null
  }

  /** Escape handling for the global keymap: closes the topmost overlay. */
  function dismiss(): boolean {
    if (actions.value) {
      actions.value = null
      return true
    }
    if (list.value) {
      list.value = null
      return true
    }
    if (rename.value) {
      cancelRename()
      return true
    }
    return false
  }

  return {
    rename,
    list,
    actions,
    anyOpen,
    openRename,
    submitRename,
    cancelRename,
    openReferences,
    openSymbols,
    openWorkspaceSymbols,
    searchWorkspaceSymbols,
    openHierarchy,
    openActions,
    runAction,
    cancelList,
    cancelActions,
    dismiss
  }
}
