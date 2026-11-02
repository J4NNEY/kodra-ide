<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Compartment, EditorState, RangeSet, StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  GutterMarker,
  drawSelection,
  dropCursor,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  WidgetType
} from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab
} from '@codemirror/commands'
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap
} from '@codemirror/autocomplete'
import { lintGutter, linter, setDiagnostics } from '@codemirror/lint'
import type { Diagnostic as CmDiagnostic } from '@codemirror/lint'
import { hoverTooltip } from '@codemirror/view'
import type { Text } from '@codemirror/state'
import { renderMarkdown } from '../lib/markdown'
import { tags as t, type Tag } from '@lezer/highlight'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { StreamLanguage } from '@codemirror/language'
import { go } from '@codemirror/legacy-modes/mode/go'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { standardSQL } from '@codemirror/legacy-modes/mode/sql'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import {
  c,
  cpp,
  csharp,
  dart,
  java,
  kotlin
} from '@codemirror/legacy-modes/mode/clike'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { groovy } from '@codemirror/legacy-modes/mode/groovy'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf'
import { xml } from '@codemirror/legacy-modes/mode/xml'
import type { EditorTab } from '../lib/types'
import type { EditorGroupId } from '../composables/useIde'
import type { LspSignatureHelp } from '../composables/useLsp'
import type { SyntaxKey, Theme } from '../lib/themes'

const props = defineProps<{
  tab: EditorTab
  groupId?: EditorGroupId
  gotoLine?: number | null
}>()
const emit = defineEmits<{
  (e: 'change', value: string): void
  (e: 'save'): void
  (e: 'cursor', value: { line: number; column: number; selected: number }): void
}>()

const ide = useIde()
const lsp = useLsp()
const themes = useThemes()
const format = useFormat()
const host = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null
const wrapCompartment = new Compartment()
const tabCompartment = new Compartment()
const highlightCompartment = new Compartment()
let syncTimer: ReturnType<typeof setTimeout> | null = null

const debug = useDebug()
const tests = useTests()

/** A red dot rendered in the breakpoint gutter. */
class BreakpointMarker extends GutterMarker {
  override toDOM() {
    const dot = document.createElement('span')
    dot.className = 'cm-breakpoint-dot'
    return dot
  }
}

/** A small dot rendered in the test gutter, colored by test status. */
class TestMarker extends GutterMarker {
  constructor(public status: string) {
    super()
  }
  override toDOM() {
    const dot = document.createElement('span')
    dot.className = `cm-test-dot cm-test-${this.status}`
    dot.title = this.status
    return dot
  }
}

const breakpointMarker = new BreakpointMarker()
const testMarker = new TestMarker('idle')
const setTestLines = StateEffect.define<{ line: number; status: string }[]>()
const testField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    let next = value.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(setTestLines)) continue
      const marks = effect.value
        .filter((m) => m.line >= 1 && m.line <= tr.state.doc.lines)
        .sort((a, b) => a.line - b.line)
        .map((m) => new TestMarker(m.status).range(tr.state.doc.line(m.line).from))
      next = RangeSet.of(marks, true)
    }
    return next
  }
})

const testGutter = gutter({
  class: 'cm-test-gutter',
  markers: (editor) => editor.state.field(testField),
  initialSpacer: () => testMarker,
  domEventHandlers: {
    mousedown(editor, block) {
      const line = editor.state.doc.lineAt(block.from).number
      const file = tests.fileFor(props.tab.path)
      const name = file ? tests.testAt(file.rel, line) : null
      if (name && file) void tests.runTest(file, name)
      return true
    }
  }
})
const setPausedLine = StateEffect.define<number | null>()
const setBreakpointLines = StateEffect.define<number[]>()

const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    let next = value.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(setBreakpointLines)) continue
      const marks = [...new Set(effect.value)]
        .filter((line) => line >= 1 && line <= tr.state.doc.lines)
        .sort((a, b) => a - b)
        .map((line) => breakpointMarker.range(tr.state.doc.line(line).from))
      next = RangeSet.of(marks, true)
    }
    return next
  }
})

const pausedLineDecoration = Decoration.line({ class: 'cm-debug-line' })

const pausedLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(setPausedLine)) continue
      const line = effect.value
      next =
        line && line >= 1 && line <= tr.state.doc.lines
          ? Decoration.set([pausedLineDecoration.range(tr.state.doc.line(line).from)])
          : Decoration.none
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field)
})

/* ---------- symbol occurrences (documentHighlight) ---------- */

interface OccurrenceRange {
  from: number
  to: number
  kind: string
}

const setOccurrences = StateEffect.define<OccurrenceRange[]>()
const occurrenceMark = {
  text: Decoration.mark({ class: 'cm-kudo-occurrence-text' }),
  read: Decoration.mark({ class: 'cm-kudo-occurrence' }),
  write: Decoration.mark({ class: 'cm-kudo-occurrence-write' })
}
const occurrenceField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(setOccurrences)) continue
      const ranges = effect.value
        .filter((range) => range.from < range.to && range.to <= tr.state.doc.length)
        .sort((a, b) => a.from - b.from)
        .map((range) =>
          (occurrenceMark[range.kind as keyof typeof occurrenceMark] ?? occurrenceMark.read).range(
            range.from,
            range.to
          )
        )
      next = Decoration.set(ranges, true)
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field)
})

/* ---------- semantic tokens ---------- */

interface SemanticRange {
  from: number
  to: number
  type: string
}

const setSemanticTokens = StateEffect.define<SemanticRange[]>()
const semanticMarks = new Map<string, Decoration>()
function semanticMark(type: string): Decoration {
  const key = type.replace(/[^a-z0-9]/gi, '').toLowerCase()
  let mark = semanticMarks.get(key)
  if (!mark) {
    mark = Decoration.mark({ class: `cm-kudo-sem-${key}` })
    semanticMarks.set(key, mark)
  }
  return mark
}
const semanticField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(setSemanticTokens)) continue
      const ranges = effect.value
        .filter((range) => range.from < range.to && range.to <= tr.state.doc.length)
        .sort((a, b) => a.from - b.from)
        .map((range) => semanticMark(range.type).range(range.from, range.to))
      next = Decoration.set(ranges, true)
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field)
})

/* ---------- inlay hints ---------- */

class InlayWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly kind: string
  ) {
    super()
  }

  override eq(other: InlayWidget): boolean {
    return other.text === this.text && other.kind === this.kind
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = `cm-kudo-inlay cm-kudo-inlay-${this.kind}`
    span.textContent = this.text
    // Hints are decoration, not code: keep them out of the accessibility tree.
    span.setAttribute('aria-hidden', 'true')
    return span
  }

  override ignoreEvent(): boolean {
    return true
  }
}

interface InlayHintRange {
  pos: number
  text: string
  kind: string
}

const setInlayHints = StateEffect.define<InlayHintRange[]>()
const inlayField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(setInlayHints)) continue
      const widgets = effect.value
        .filter((hint) => hint.text && hint.pos >= 0 && hint.pos <= tr.state.doc.length)
        .sort((a, b) => a.pos - b.pos)
        .map((hint) =>
          Decoration.widget({
            widget: new InlayWidget(hint.text, hint.kind),
            side: 1
          }).range(hint.pos)
        )
      next = Decoration.set(widgets, true)
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field)
})

/* ---------- signature help ---------- */

const signature = ref<LspSignatureHelp | null>(null)
const signatureStyle = ref<Record<string, string>>({})
let signatureTimer: ReturnType<typeof setTimeout> | null = null
let signatureSeq = 0
let occurrenceTimer: ReturnType<typeof setTimeout> | null = null
let occurrenceSeq = 0
let semanticTimer: ReturnType<typeof setTimeout> | null = null
let semanticSeq = 0
let semanticRetries = 0
let inlayTimer: ReturnType<typeof setTimeout> | null = null
let inlaySeq = 0
let inlayRetries = 0

const activeSignature = computed(() => {
  const help = signature.value
  if (!help) return null
  const sig = help.signatures[help.activeSignature] ?? help.signatures[0]
  if (!sig) return null
  const parameter = sig.parameters[sig.activeParameter]
  const parts =
    parameter && parameter.start >= 0 && parameter.end > parameter.start
      ? [
          { text: sig.label.slice(0, parameter.start), active: false },
          { text: sig.label.slice(parameter.start, parameter.end), active: true },
          { text: sig.label.slice(parameter.end), active: false }
        ].filter((part) => part.text.length > 0)
      : [{ text: sig.label, active: false }]
  return {
    parts,
    doc: parameter?.documentation || sig.documentation,
    index: help.activeSignature + 1,
    total: help.signatures.length
  }
})

function hideSignature() {
  signatureSeq++
  signature.value = null
}

function scheduleSignature(editor: EditorView, delay = 140) {
  if (!lsp.isSupported(props.tab.language)) return
  if (signatureTimer) clearTimeout(signatureTimer)
  signatureTimer = setTimeout(() => {
    signatureTimer = null
    void updateSignature(editor)
  }, delay)
}

async function updateSignature(editor: EditorView) {
  const selection = editor.state.selection.main
  if (!selection.empty) {
    hideSignature()
    return
  }
  const pos = selection.head
  const line = editor.state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  // Only ask when an argument list was just opened/extended or a hint is
  // already on screen (so the active parameter stays in sync).
  const typedArguments = /[,(]\s*$/.test(before)
  if (!typedArguments && !signature.value) return
  const seq = ++signatureSeq
  const help = await lsp.signatureHelp(
    props.tab.path,
    line.number - 1,
    pos - line.from,
    editor.state.doc.toString()
  )
  if (seq !== signatureSeq || !view || view !== editor) return
  if (!help) {
    signature.value = null
    return
  }
  signature.value = help
  await nextTick()
  positionSignature(editor, pos)
}

function positionSignature(editor: EditorView, pos: number) {
  if (!host.value) return
  const coords = editor.coordsAtPos(pos)
  if (!coords) {
    signature.value = null
    return
  }
  const rect = host.value.getBoundingClientRect()
  const width = Math.min(560, Math.max(300, rect.width - 24))
  const left = Math.max(8, Math.min(coords.left - rect.left, rect.width - width - 8))
  const above = rect.bottom - coords.bottom < 140
  signatureStyle.value = {
    left: `${left}px`,
    maxWidth: `${width}px`,
    ...(above
      ? { bottom: `${rect.bottom - coords.top + 6}px` }
      : { top: `${coords.bottom - rect.top + 6}px` })
  }
}

function onEditorScroll() {
  if (signature.value) signature.value = null
}

function scheduleOccurrences(editor: EditorView, delay = 220) {
  if (!lsp.isSupported(props.tab.language)) return
  if (occurrenceTimer) clearTimeout(occurrenceTimer)
  occurrenceTimer = setTimeout(() => {
    occurrenceTimer = null
    void updateOccurrences(editor)
  }, delay)
}

async function updateOccurrences(editor: EditorView) {
  const selection = editor.state.selection.main
  if (!selection.empty) {
    occurrenceSeq++
    editor.dispatch({ effects: setOccurrences.of([]) })
    return
  }
  const line = editor.state.doc.lineAt(selection.head)
  const at = selection.head - line.from
  // Skip whitespace and punctuation: the server has nothing to highlight there.
  if (!/[\w$#@]/.test(line.text[at] ?? line.text[at - 1] ?? '')) {
    occurrenceSeq++
    editor.dispatch({ effects: setOccurrences.of([]) })
    return
  }
  const seq = ++occurrenceSeq
  const highlights = await lsp.documentHighlights(
    props.tab.path,
    line.number - 1,
    at,
    editor.state.doc.toString()
  )
  if (seq !== occurrenceSeq || !view || view !== editor) return
  editor.dispatch({
    effects: setOccurrences.of(
      highlights.map((item) => ({
        from: offsetAt(editor.state.doc, item.line, item.column),
        to: offsetAt(editor.state.doc, item.endLine, item.endColumn),
        kind: item.kind
      }))
    )
  })
}

function scheduleSemantic(editor: EditorView, delay = 320) {
  if (!ide.settings.value.semanticHighlighting) return
  if (!lsp.isSupported(props.tab.language)) return
  if (semanticTimer) clearTimeout(semanticTimer)
  semanticTimer = setTimeout(() => {
    semanticTimer = null
    void updateSemantic(editor)
  }, delay)
}

async function updateSemantic(editor: EditorView) {
  const doc = editor.state.doc
  const seq = ++semanticSeq
  const tokens = await lsp.semanticTokens(props.tab.path, doc.toString())
  if (seq !== semanticSeq || !view || view !== editor) return
  // A server that is still indexing answers with no tokens; try again shortly.
  if (!tokens.length && semanticRetries < 3) {
    semanticRetries++
    scheduleSemantic(editor, 1200)
    return
  }
  semanticRetries = 0
  editor.dispatch({
    effects: setSemanticTokens.of(
      tokens.map((token) => ({
        from: offsetAt(doc, token.line, token.column),
        to: offsetAt(doc, token.line, token.column + token.length),
        type: token.type
      }))
    )
  })
}

function scheduleInlay(editor: EditorView, delay = 420) {
  if (!ide.settings.value.inlayHints) return
  if (!lsp.isSupported(props.tab.language)) return
  if (inlayTimer) clearTimeout(inlayTimer)
  inlayTimer = setTimeout(() => {
    inlayTimer = null
    void updateInlay(editor)
  }, delay)
}

async function updateInlay(editor: EditorView) {
  const doc = editor.state.doc
  const seq = ++inlaySeq
  const hints = await lsp.inlayHints(props.tab.path, doc.toString())
  if (seq !== inlaySeq || !view || view !== editor) return
  // Inferred types only show up once analysis settles; retry an empty answer.
  if (!hints.length && inlayRetries < 3) {
    inlayRetries++
    scheduleInlay(editor, 1500)
    return
  }
  inlayRetries = 0
  editor.dispatch({
    effects: setInlayHints.of(
      hints.map((hint) => ({
        pos: offsetAt(doc, hint.line, hint.column),
        text: hint.label,
        kind: hint.kind
      }))
    )
  })
}

function clearSemantic(editor: EditorView) {
  semanticSeq++
  editor.dispatch({ effects: setSemanticTokens.of([]) })
}

function clearInlay(editor: EditorView) {
  inlaySeq++
  editor.dispatch({ effects: setInlayHints.of([]) })
}

const breakpointGutter = gutter({
  class: 'cm-breakpoint-gutter',
  markers: (editor) => editor.state.field(breakpointField),
  initialSpacer: () => breakpointMarker,
  domEventHandlers: {
    mousedown(editor, block) {
      const line = editor.state.doc.lineAt(block.from).number
      void debug.toggleBreakpoint(props.tab.path, line)
      return true
    }
  }
})

function samePath(a: string, b: string) {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}

function breakpointLines() {
  return debug
    .breakpointsFor(props.tab.path)
    .filter((bp) => bp.enabled)
    .map((bp) => bp.line)
}

function pausedLineFor(): number | null {
  if (debug.status.value !== 'paused') return null
  const frame = debug.frames.value.find((item) => item.path && samePath(item.path, props.tab.path))
  return frame?.line ?? null
}

let lastPausedLine: number | null = null

function syncBreakpointMarkers() {
  if (!view) return
  view.dispatch({ effects: setBreakpointLines.of(breakpointLines()) })
}

function syncTestMarkers() {
  if (!view) return
  const file = tests.fileFor(props.tab.path)
  if (!file || file.tests.length === 0) {
    view.dispatch({ effects: setTestLines.of([]) })
    return
  }
  const marks = file.tests.map((t) => ({
    line: t.line,
    status: tests.statusOf(file, t.name)
  }))
  view.dispatch({ effects: setTestLines.of(marks) })
}

function syncPausedLine() {
  if (!view) return
  const line = pausedLineFor()
  view.dispatch({ effects: setPausedLine.of(line) })
  const focused = !props.groupId || ide.activeGroupId.value === props.groupId
  if (line && line !== lastPausedLine && focused) {
    const target = view.state.doc.line(Math.min(line, view.state.doc.lines))
    view.dispatch({ effects: EditorView.scrollIntoView(target.from, { y: 'center' }) })
  }
  lastPausedLine = line
}

const syntaxTags: Record<SyntaxKey, Tag[]> = {
  keyword: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.self],
  operator: [t.operator, t.punctuation, t.bracket, t.separator],
  string: [t.string, t.special(t.string), t.regexp, t.character, t.attributeValue],
  number: [t.number, t.bool, t.atom, t.null, t.integer, t.float],
  comment: [t.comment, t.lineComment, t.blockComment, t.docComment],
  variable: [t.variableName, t.propertyName, t.definition(t.variableName), t.local(t.variableName)],
  function: [t.function(t.variableName), t.function(t.propertyName), t.macroName],
  type: [t.typeName, t.className, t.namespace, t.standard(t.typeName)],
  tag: [t.tagName, t.angleBracket],
  attribute: [t.attributeName, t.labelName],
  heading: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6],
  link: [t.link, t.url],
  meta: [t.meta, t.annotation, t.processingInstruction, t.documentMeta],
  invalid: [t.invalid]
}

function highlightFor(theme: Theme) {
  const rules = (Object.keys(theme.syntax) as SyntaxKey[])
    .map((key) => {
      const style = theme.syntax[key]
      if (!style?.color) return null
      return {
        tag: syntaxTags[key],
        color: style.color,
        ...(style.italic ? { fontStyle: 'italic' as const } : {}),
        ...(style.bold ? { fontWeight: '600' as const } : {})
      }
    })
    .filter((rule) => rule !== null)
  return HighlightStyle.define(rules)
}

const activeHighlight = () => syntaxHighlighting(highlightFor(themes.active.value))

/** Snippets from extensions are inserted by the command palette. */
function onInsert(event: Event) {
  const text = (event as CustomEvent<string>).detail
  if (!view || typeof text !== 'string') return
  const focusedPane = !props.groupId || ide.activeGroupId.value === props.groupId
  if (!focusedPane || ide.activePath.value !== props.tab.path) return
  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true
  })
  view.focus()
}

function languageFor(language: string) {
  switch (language) {
    case 'typescript':
      return javascript({ typescript: true, jsx: props.tab.path.endsWith('.tsx') })
    case 'javascript':
      return javascript({ jsx: props.tab.path.endsWith('.jsx') })
    case 'json':
      return json()
    case 'css':
      return css()
    case 'html':
      return html()
    case 'markdown':
      return markdown()
    case 'python':
      return python()
    case 'rust':
      return rust()
    case 'go':
      return StreamLanguage.define(go)
    case 'dart':
      return StreamLanguage.define(dart)
    case 'kotlin':
      return StreamLanguage.define(kotlin)
    case 'java':
      return StreamLanguage.define(java)
    case 'swift':
      return StreamLanguage.define(swift)
    case 'c':
      return StreamLanguage.define(c)
    case 'cpp':
      return StreamLanguage.define(cpp)
    case 'csharp':
      return StreamLanguage.define(csharp)
    case 'groovy':
      return StreamLanguage.define(groovy)
    case 'properties':
      return StreamLanguage.define(properties)
    case 'ruby':
      return StreamLanguage.define(ruby)
    case 'lua':
      return StreamLanguage.define(lua)
    case 'protobuf':
      return StreamLanguage.define(protobuf)
    case 'xml':
      return StreamLanguage.define(xml)
    case 'yaml':
      return StreamLanguage.define(yaml)
    case 'toml':
      return StreamLanguage.define(toml)
    case 'sql':
      return StreamLanguage.define(standardSQL)
    case 'shell':
      return StreamLanguage.define(shell)
    case 'dockerfile':
      return StreamLanguage.define(dockerFile)
    default:
      return []
  }
}

const theme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: 'var(--text)', height: '100%' },
    '.cm-content': { padding: '8px 0 40vh', caretColor: 'var(--accent)' },
    '.cm-line': { padding: '0 12px' },
    '.cm-scroller': { overflow: 'auto' },
    '&.cm-focused': { outline: 'none' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px', minWidth: '44px' },
    '.cm-foldGutter .cm-gutterElement': { padding: '0 4px' },
    '.cm-breakpoint-gutter': { width: '18px', cursor: 'pointer' },
    '.cm-breakpoint-gutter .cm-gutterElement': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 2px'
    },
    '.cm-breakpoint-dot': {
      width: '9px',
      height: '9px',
      borderRadius: '50%',
      background: 'var(--danger, #f87171)',
      boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.25)'
    },
    '.cm-test-gutter': { cursor: 'pointer' },
    '.cm-test-gutter .cm-gutterElement': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 2px'
    },
    '.cm-test-dot': {
      width: '7px',
      height: '7px',
      borderRadius: '50%',
      border: '1px solid var(--text-faint)',
      background: 'transparent',
      opacity: 0.7
    },
    '.cm-test-dot.cm-test-passed': {
      background: 'var(--success, #4ec9b0)',
      borderColor: 'var(--success, #4ec9b0)',
      opacity: 1
    },
    '.cm-test-dot.cm-test-failed': {
      background: 'var(--danger, #f87171)',
      borderColor: 'var(--danger, #f87171)',
      opacity: 1
    },
    '.cm-test-dot.cm-test-running': {
      background: 'var(--warning, #d4a73c)',
      borderColor: 'var(--warning, #d4a73c)',
      opacity: 1
    },
    '.cm-debug-line': {
      backgroundColor: 'rgba(212, 167, 60, 0.14)',
      boxShadow: 'inset 2px 0 0 var(--warning, #d4a73c)'
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--surface-2)',
      border: '1px solid var(--border-strong)',
      borderRadius: '8px',
      color: 'var(--text)'
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'var(--accent-soft)',
      color: 'var(--text)'
    }
  },
  { dark: true }
)

function reportCursor(state: EditorState) {
  const pos = state.selection.main.head
  const line = state.doc.lineAt(pos)
  emit('cursor', {
    line: line.number,
    column: pos - line.from + 1,
    selected: state.selection.ranges.reduce((sum, r) => sum + (r.to - r.from), 0)
  })
}

function jumpTo(line?: number | null) {
  if (!view || !line) return
  const safe = Math.min(Math.max(1, line), view.state.doc.lines)
  const target = view.state.doc.line(safe)
  view.dispatch({
    selection: { anchor: target.from },
    effects: EditorView.scrollIntoView(target.from, { y: 'center' })
  })
  view.focus()
}

function offsetAt(doc: Text, line: number, column: number) {
  const number = Math.min(Math.max(1, line), doc.lines)
  const target = doc.line(number)
  return Math.min(target.to, target.from + Math.max(0, column - 1))
}

/** Translate the stored LSP and linter diagnostics into CodeMirror ones. */
function cmDiagnostics(): CmDiagnostic[] {
  if (!view) return []
  const doc = view.state.doc
  const toCm = (item: {
    line: number
    column: number
    endLine: number
    endColumn: number
    severity: string
    message: string
    source: string
  }) => {
    const from = offsetAt(doc, item.line, item.column)
    const to = Math.max(from + 1, offsetAt(doc, item.endLine, item.endColumn))
    return {
      from: Math.min(from, doc.length),
      to: Math.min(to, doc.length),
      severity: (item.severity === 'hint' ? 'info' : item.severity) as CmDiagnostic['severity'],
      message: item.message,
      source: item.source || 'lsp'
    }
  }
  return [
    ...lsp.diagnosticsFor(props.tab.path).map(toCm),
    ...format.issuesFor(props.tab.path).map(toCm)
  ]
}

/**
 * Push the stored diagnostics into the lint state. `forceLinting` only
 * reschedules a lint that is already pending, so it does nothing once the
 * initial run has finished — external diagnostics (language server pushes and
 * lint-on-save results) have to be applied with `setDiagnostics` instead.
 */
function refreshDiagnostics() {
  if (!view) return
  view.dispatch(setDiagnostics(view.state, cmDiagnostics()))
}

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = null
    if (!view) return
    void lsp.changeDocument(props.tab.path, view.state.doc.toString())
  }, 250)
}

async function goToDefinition(pos?: number) {
  if (!view) return
  const at = pos ?? view.state.selection.main.head
  const line = view.state.doc.lineAt(at)
  const target = await lsp.definition(
    props.tab.path,
    line.number - 1,
    at - line.from,
    view.state.doc.toString()
  )
  if (target?.path) await ide.openFile(target.path, target.line, false, true)
}

function lspExtensions() {
  if (!lsp.isSupported(props.tab.language)) return []
  return [
    autocompletion({
      override: [lsp.completionSource(props.tab.path)],
      activateOnTyping: true
    }),
    hoverTooltip(
      async (editor, pos) => {
        const line = editor.state.doc.lineAt(pos)
        const markdown = await lsp.hover(
          props.tab.path,
          line.number - 1,
          pos - line.from,
          editor.state.doc.toString()
        )
        if (!markdown.trim()) return null
        return {
          pos,
          end: Math.min(line.to, pos + 1),
          create() {
            const dom = document.createElement('div')
            dom.className = 'cm-kudo-hover'
            dom.innerHTML = renderMarkdown(markdown)
            return { dom }
          }
        }
      },
      { hoverTime: 280 }
    ),
    linter(cmDiagnostics, { delay: 250 }),
    lintGutter(),
    EditorView.domEventHandlers({
      click(event, editor) {
        if (!event.ctrlKey && !event.metaKey) return false
        const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos == null) return false
        event.preventDefault()
        void goToDefinition(pos)
        return true
      }
    })
  ]
}

onMounted(() => {
  if (!host.value) return
  window.addEventListener('kudo:editor-insert', onInsert)
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.tab.content,
      extensions: [
        breakpointField,
        pausedLineField,
        occurrenceField,
        semanticField,
        inlayField,
        breakpointGutter,
        testField,
        testGutter,
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        ...(lsp.isSupported(props.tab.language) ? lspExtensions() : [autocompletion()]),
        highlightSelectionMatches(),
        highlightActiveLine(),
        highlightCompartment.of(activeHighlight()),
        theme,
        wrapCompartment.of(ide.settings.value.wordWrap ? EditorView.lineWrapping : []),
        tabCompartment.of(EditorState.tabSize.of(ide.settings.value.tabSize)),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              emit('save')
              return true
            }
          },
          {
            key: 'F12',
            preventDefault: true,
            run: () => {
              void goToDefinition()
              return true
            }
          },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            emit('change', update.state.doc.toString())
            scheduleSync()
            semanticRetries = 0
            inlayRetries = 0
            scheduleSemantic(update.view)
            scheduleInlay(update.view)
          }
          if (update.docChanged || update.selectionSet) {
            reportCursor(update.state)
            scheduleSignature(update.view)
            scheduleOccurrences(update.view)
          }
          if (update.focusChanged) {
            if (update.view.hasFocus) reportCursor(update.state)
            else hideSignature()
          }
        }),
        languageFor(props.tab.language)
      ]
    })
  })

  view.scrollDOM.scrollTop = props.tab.scrollTop ?? 0
  view.scrollDOM.addEventListener('scroll', onEditorScroll, { passive: true })
  reportCursor(view.state)
  syncBreakpointMarkers()
  syncTestMarkers()
  syncPausedLine()
  if (props.gotoLine) jumpTo(props.gotoLine)
  if (!props.groupId || ide.activeGroupId.value === props.groupId) view.focus()
  if (!props.tab.binary) {
    void lsp.acquireDocument(props.tab.path, props.tab.language, props.tab.content)
    // Language servers answer these only after the document is open, so give
    // the first sync a head start.
    scheduleSemantic(view, 700)
    scheduleInlay(view, 950)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('kudo:editor-insert', onInsert)
  if (syncTimer) {
    clearTimeout(syncTimer)
    syncTimer = null
  }
  if (signatureTimer) {
    clearTimeout(signatureTimer)
    signatureTimer = null
  }
  if (occurrenceTimer) {
    clearTimeout(occurrenceTimer)
    occurrenceTimer = null
  }
  if (semanticTimer) {
    clearTimeout(semanticTimer)
    semanticTimer = null
  }
  if (inlayTimer) {
    clearTimeout(inlayTimer)
    inlayTimer = null
  }
  semanticSeq++
  inlaySeq++
  hideSignature()
  view?.scrollDOM.removeEventListener('scroll', onEditorScroll)
  void lsp.releaseDocument(props.tab.path)
  if (view && props.tab) props.tab.scrollTop = view.scrollDOM.scrollTop
  view?.destroy()
  view = null
})

watch(
  () => props.tab.content,
  (next) => {
    if (!view) return
    if (next === view.state.doc.toString()) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next }
    })
  }
)

watch(
  () => ide.settings.value.wordWrap,
  (wrap) => {
    view?.dispatch({
      effects: wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : [])
    })
  }
)

watch(
  () => ide.settings.value.tabSize,
  (size) => {
    view?.dispatch({ effects: tabCompartment.reconfigure(EditorState.tabSize.of(size)) })
  }
)

watch(themes.active, () => {
  view?.dispatch({ effects: highlightCompartment.reconfigure(activeHighlight()) })
})

watch(
  () => ide.settings.value.semanticHighlighting,
  (enabled) => {
    if (!view) return
    if (enabled) {
      semanticRetries = 0
      scheduleSemantic(view, 0)
    } else clearSemantic(view)
  }
)

watch(
  () => ide.settings.value.inlayHints,
  (enabled) => {
    if (!view) return
    if (enabled) {
      inlayRetries = 0
      scheduleInlay(view, 0)
    } else clearInlay(view)
  }
)

// Language servers publish diagnostics asynchronously and lint-on-save fills
// the linter store after the fact; push both straight into the lint state so
// squiggles and the gutter update without waiting for the next edit.
watch(
  () => lsp.diagnostics.value[props.tab.path],
  () => refreshDiagnostics()
)

watch(
  () => format.issues.value[props.tab.path],
  () => refreshDiagnostics(),
  { deep: true }
)

watch(
  () => props.gotoLine,
  (line) => jumpTo(line)
)

watch(() => debug.breakpoints.value, syncBreakpointMarkers)
watch(tests.results, syncTestMarkers)
watch(tests.files, syncTestMarkers)
watch([debug.status, debug.frames], syncPausedLine)

defineExpose({ focus: () => view?.focus() })
</script>

<template>
  <div v-if="tab.binary" class="binary-state">
    <p>This file looks binary and can't be edited as text.</p>
    <span class="hint">{{ tab.path }}</span>
  </div>
  <div v-else class="code-shell">
    <div ref="host" class="code-host" />
    <div v-if="signature && activeSignature" class="cm-kudo-signature" :style="signatureStyle">
      <div class="sig-head">
        <span class="sig-label"
          ><span
            v-for="(part, i) in activeSignature.parts"
            :key="i"
            :class="{ 'sig-active': part.active }"
            >{{ part.text }}</span
          ></span
        >
        <span v-if="activeSignature.total > 1" class="sig-count"
          >{{ activeSignature.index }}/{{ activeSignature.total }}</span
        >
      </div>
      <div
        v-if="activeSignature.doc"
        class="sig-doc"
        v-html="renderMarkdown(activeSignature.doc)"
      />
    </div>
  </div>
</template>

<style scoped>
.code-shell {
  position: relative;
  height: 100%;
  min-height: 0;
}
.cm-kudo-signature {
  position: absolute;
  z-index: 30;
  pointer-events: none;
  padding: 6px 9px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-dim);
  box-shadow: 0 12px 32px #00000066;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.5;
}
.sig-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.sig-label {
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.sig-active {
  color: var(--accent-strong, var(--accent));
  font-weight: 600;
}
.sig-count {
  margin-left: auto;
  color: var(--text-faint);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.sig-doc {
  margin-top: 3px;
  color: var(--text-faint);
}
.sig-doc :deep(p) {
  margin: 0 0 4px;
}
.sig-doc :deep(p:last-child) {
  margin-bottom: 0;
}
.sig-doc :deep(pre) {
  margin: 4px 0;
  padding: 5px 7px;
  border-radius: 5px;
  background: #0000004d;
  overflow-x: auto;
}
.sig-doc :deep(code) {
  font-family: var(--font-mono);
  font-size: 11px;
}
</style>
<style scoped>
.code-host {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.binary-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12.5px;
  padding: 24px;
  text-align: center;
}
</style>
