<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Compartment, EditorState } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection
} from '@codemirror/view'
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
import { tags as t } from '@lezer/highlight'
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

const props = defineProps<{ tab: EditorTab; gotoLine?: number | null }>()
const emit = defineEmits<{
  (e: 'change', value: string): void
  (e: 'save'): void
  (e: 'cursor', value: { line: number; column: number; selected: number }): void
}>()

const ide = useIde()
const lsp = useLsp()
const effectiveTheme = useEffectiveTheme()
const host = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null
const wrapCompartment = new Compartment()
const tabCompartment = new Compartment()
const highlightCompartment = new Compartment()
let syncTimer: ReturnType<typeof setTimeout> | null = null

const darkHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#c792ea' },
  { tag: [t.operator, t.punctuation], color: '#89ddff' },
  { tag: [t.string], color: '#c3e88d' },
  { tag: [t.number, t.bool, t.atom], color: '#f78c6c' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#5c6773', fontStyle: 'italic' },
  { tag: [t.variableName, t.propertyName], color: '#d6deeb' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#82aaff' },
  { tag: [t.typeName, t.className, t.namespace], color: '#ffcb6b' },
  { tag: [t.tagName], color: '#f07178' },
  { tag: [t.attributeName], color: '#c792ea' },
  { tag: [t.heading], color: '#d4a73c', fontWeight: '600' },
  { tag: [t.link, t.url], color: '#6cb6ff' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.strong], fontWeight: '700' },
  { tag: [t.meta], color: '#8aa9c9' },
  { tag: [t.invalid], color: '#e4676b' }
])

const lightHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#a626a4' },
  { tag: [t.operator, t.punctuation], color: '#0550ae' },
  { tag: [t.string], color: '#0a7d33' },
  { tag: [t.number, t.bool, t.atom], color: '#b75501' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#8b949e', fontStyle: 'italic' },
  { tag: [t.variableName, t.propertyName], color: '#24292f' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#0550ae' },
  { tag: [t.typeName, t.className, t.namespace], color: '#953800' },
  { tag: [t.tagName], color: '#c41a16' },
  { tag: [t.attributeName], color: '#8250df' },
  { tag: [t.heading], color: '#9a6700', fontWeight: '600' },
  { tag: [t.link, t.url], color: '#0b5cad' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.strong], fontWeight: '700' },
  { tag: [t.meta], color: '#57606a' },
  { tag: [t.invalid], color: '#d1242f' }
])

const activeHighlight = () =>
  syntaxHighlighting(effectiveTheme.value === 'light' ? lightHighlight : darkHighlight)

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
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.tab.content,
      extensions: [
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
        }),
        languageFor(props.tab.language)
      ]
    })
  })

  view.scrollDOM.scrollTop = props.tab.scrollTop ?? 0
  reportCursor(view.state)
  if (props.gotoLine) jumpTo(props.gotoLine)
  view.focus()
  if (!props.tab.binary) {
    void lsp.openDocument(props.tab.path, props.tab.language, props.tab.content)
  }
})

onBeforeUnmount(() => {
  if (syncTimer) {
    clearTimeout(syncTimer)
    syncTimer = null
  }
  void lsp.closeDocument(props.tab.path)
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

watch(effectiveTheme, () => {
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
