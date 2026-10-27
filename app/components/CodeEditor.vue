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
import { tags as t } from '@lezer/highlight'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import type { EditorTab } from '../lib/types'

const props = defineProps<{ tab: EditorTab; gotoLine?: number | null }>()
const emit = defineEmits<{
  (e: 'change', value: string): void
  (e: 'save'): void
  (e: 'cursor', value: { line: number; column: number; selected: number }): void
}>()

const ide = useIde()
const effectiveTheme = useEffectiveTheme()
const host = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null
const wrapCompartment = new Compartment()
const tabCompartment = new Compartment()
const highlightCompartment = new Compartment()

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
        autocompletion(),
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
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) emit('change', update.state.doc.toString())
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
})

onBeforeUnmount(() => {
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
