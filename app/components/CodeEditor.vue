<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
  rectangularSelection
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
import { forceLinting, lintGutter, linter } from '@codemirror/lint'
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
import type { EditorTab } from '../lib/types'
import type { EditorGroupId } from '../composables/useIde'
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

/** Translate the stored LSP diagnostics into CodeMirror diagnostics. */
function cmDiagnostics(): CmDiagnostic[] {
  if (!view) return []
  const doc = view.state.doc
  return lsp.diagnosticsFor(props.tab.path).map((item) => {
    const from = offsetAt(doc, item.line, item.column)
    const to = Math.max(from + 1, offsetAt(doc, item.endLine, item.endColumn))
    return {
      from: Math.min(from, doc.length),
      to: Math.min(to, doc.length),
      severity: item.severity === 'hint' ? 'info' : item.severity,
      message: item.message,
      source: item.source || 'lsp'
    }
  })
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
  if (target?.path) await ide.openFile(target.path, target.line)
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
          }
          if (update.docChanged || update.selectionSet) reportCursor(update.state)
          if (update.focusChanged && update.view.hasFocus) reportCursor(update.state)
        }),
        languageFor(props.tab.language)
      ]
    })
  })

  view.scrollDOM.scrollTop = props.tab.scrollTop ?? 0
  reportCursor(view.state)
  syncBreakpointMarkers()
  syncTestMarkers()
  syncPausedLine()
  if (props.gotoLine) jumpTo(props.gotoLine)
  if (!props.groupId || ide.activeGroupId.value === props.groupId) view.focus()
  if (!props.tab.binary) {
    void lsp.acquireDocument(props.tab.path, props.tab.language, props.tab.content)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('kudo:editor-insert', onInsert)
  if (syncTimer) {
    clearTimeout(syncTimer)
    syncTimer = null
  }
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

// Language servers publish diagnostics asynchronously; re-run the linter so
// squiggles and the gutter update without waiting for the next edit.
watch(
  () => lsp.diagnostics.value[props.tab.path],
  () => {
    if (view) forceLinting(view)
  }
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
  <div v-else ref="host" class="code-host" />
</template>

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
