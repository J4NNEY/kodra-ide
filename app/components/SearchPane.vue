<script setup lang="ts">
import {
  CaseSensitive,
  ChevronDown,
  Loader2,
  Regex,
  Replace,
  ReplaceAll,
  Search,
  WholeWord,
  X
} from 'lucide-vue-next'
import type { ReplaceOutcome, SearchHit } from '../lib/types'
import { call } from '../lib/api'

const ide = useIde()
const query = ref('')
const replacement = ref('')
const caseSensitive = ref(false)
const wholeWord = ref(false)
const isRegex = ref(false)
const showReplace = ref(false)
const hits = ref<SearchHit[]>([])
const searching = ref(false)
const applying = ref(false)
const preview = ref<ReplaceOutcome | null>(null)
const error = ref('')
let timer: ReturnType<typeof setTimeout> | null = null

const grouped = computed(() => {
  const map = new Map<string, SearchHit[]>()
  for (const hit of hits.value) {
    const arr = map.get(hit.rel) ?? []
    arr.push(hit)
    map.set(hit.rel, arr)
  }
  return [...map.entries()]
})

function errorText(err: unknown) {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error:\s*/, '')
}

async function run() {
  if (!query.value.trim() || !ide.workspace.value) {
    hits.value = []
    error.value = ''
    return
  }
  searching.value = true
  try {
    hits.value = await call<SearchHit[]>('search_in_files', {
      query: query.value,
      caseSensitive: caseSensitive.value,
      wholeWord: wholeWord.value,
      isRegex: isRegex.value,
      limit: 400
    })
    error.value = ''
  } catch (err) {
    hits.value = []
    error.value = errorText(err)
  } finally {
    searching.value = false
  }
}

watch([query, caseSensitive, wholeWord, isRegex], () => {
  preview.value = null
  if (timer) clearTimeout(timer)
  timer = setTimeout(run, 220)
})

watch([replacement, showReplace], () => {
  preview.value = null
})

watch(
  () => ide.workspace.value?.path,
  () => {
    hits.value = []
    preview.value = null
    void run()
  }
)

/** Preview the replacement before anything touches the disk. */
async function previewReplace() {
  if (!query.value.trim() || !ide.workspace.value || applying.value) return
  error.value = ''
  try {
    const outcome = await call<ReplaceOutcome>('replace_in_files', {
      query: query.value,
      replacement: replacement.value,
      caseSensitive: caseSensitive.value,
      wholeWord: wholeWord.value,
      isRegex: isRegex.value,
      dryRun: true
    })
    if (!outcome.matches) {
      preview.value = null
      ide.notify('No matches to replace', 'info')
      return
    }
    const dirty = outcome.changes
      .filter((change) => ide.tabs.value.some((tab) => tab.path === change.path && tab.dirty))
      .map((change) => change.rel)
    if (dirty.length) {
      preview.value = null
      const more = dirty.length > 3 ? ` +${dirty.length - 3} more` : ''
      error.value = `Save or discard unsaved changes first: ${dirty.slice(0, 3).join(', ')}${more}`
      return
    }
    preview.value = outcome
  } catch (err) {
    preview.value = null
    error.value = errorText(err)
  }
}

async function confirmReplace() {
  if (!preview.value || applying.value) return
  applying.value = true
  try {
    const outcome = await call<ReplaceOutcome>('replace_in_files', {
      query: query.value,
      replacement: replacement.value,
      caseSensitive: caseSensitive.value,
      wholeWord: wholeWord.value,
      isRegex: isRegex.value,
      dryRun: false
    })
    const changed = new Set(outcome.changes.map((change) => change.path))
    // Keep open editors in sync; only clean tabs are reloaded (dirty tabs are
    // blocked in the preview step, so this loop cannot discard user edits).
    for (const tab of ide.tabs.value) {
      if (changed.has(tab.path) && !tab.dirty) await ide.reloadTab(tab.path)
    }
    preview.value = null
    ide.notify(
      `Replaced ${outcome.matches} match${outcome.matches === 1 ? '' : 'es'} in ${outcome.files} file${
        outcome.files === 1 ? '' : 's'
      }`,
      'success'
    )
    await run()
  } catch (err) {
    error.value = errorText(err)
  } finally {
    applying.value = false
  }
}

/** First match in a line, for the inline highlight. */
function matchRange(text: string): [number, number] | null {
  const q = query.value
  if (!q) return null
  if (isRegex.value) {
    try {
      const source = wholeWord.value ? `\\b(?:${q})\\b` : q
      const found = new RegExp(source, caseSensitive.value ? '' : 'i').exec(text)
      return found ? [found.index, found.index + found[0].length] : null
    } catch {
      return null
    }
  }
  const idx = caseSensitive.value
    ? text.indexOf(q)
    : text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return null
  return [idx, idx + q.length]
}

function parts(text: string) {
  const range = matchRange(text)
  if (!range) return [{ t: text, m: false }]
  const [start, end] = range
  const out: { t: string; m: boolean }[] = []
  if (start > 0) out.push({ t: text.slice(0, start), m: false })
  if (end > start) out.push({ t: text.slice(start, end), m: true })
  if (end < text.length) out.push({ t: text.slice(end), m: false })
  return out
}

function open(hit: SearchHit) {
  ide.openFile(hit.path, hit.line)
}
</script>

<template>
  <div class="pane">
    <div class="sidebar-header">
      <span class="sidebar-title">Search</span>
      <div class="sidebar-actions">
        <button
          class="icon-btn"
          :style="showReplace ? 'color:var(--accent)' : ''"
          title="Toggle replace"
          @click="showReplace = !showReplace"
        >
          <ChevronDown :size="15" :style="showReplace ? '' : 'transform:rotate(-90deg)'" />
        </button>
      </div>
    </div>

    <div class="search-area">
      <div class="search-box">
        <Search :size="13" />
        <input
          v-model="query"
          placeholder="Search in workspace"
          spellcheck="false"
          @keydown.enter="run"
        />
        <Loader2 v-if="searching" :size="13" class="spin" />
        <button v-else-if="query" class="icon-btn" style="width: 18px; height: 18px" @click="query = ''">
          <X :size="12" />
        </button>
      </div>

      <div v-if="showReplace" class="search-box replace-box">
        <Replace :size="13" />
        <input
          v-model="replacement"
          placeholder="Replace with"
          spellcheck="false"
          @keydown.enter="previewReplace"
        />
        <button
          class="icon-btn"
          :disabled="!query.trim() || applying"
          title="Replace all"
          @click="previewReplace"
        >
          <ReplaceAll :size="14" />
        </button>
      </div>

      <div class="search-toggles">
        <button
          class="toggle"
          :class="{ on: caseSensitive }"
          :aria-pressed="caseSensitive"
          title="Match case"
          @click="caseSensitive = !caseSensitive"
        >
          <CaseSensitive :size="14" />
        </button>
        <button
          class="toggle"
          :class="{ on: wholeWord }"
          :aria-pressed="wholeWord"
          title="Match whole word"
          @click="wholeWord = !wholeWord"
        >
          <WholeWord :size="14" />
        </button>
        <button
          class="toggle"
          :class="{ on: isRegex }"
          :aria-pressed="isRegex"
          title="Use regular expression"
          @click="isRegex = !isRegex"
        >
          <Regex :size="14" />
        </button>
        <span v-if="query" class="result-count">
          {{ hits.length }} result{{ hits.length === 1 ? '' : 's' }}
          <template v-if="hits.length">across {{ grouped.length }} files</template>
        </span>
      </div>

      <div v-if="error" class="search-error">{{ error }}</div>
    </div>

    <div class="sidebar-body" style="padding-top: 0">
      <div v-if="preview" class="replace-preview">
        <div class="replace-preview-head">
          Replace {{ preview.matches }} match{{ preview.matches === 1 ? '' : 'es' }} in
          {{ preview.files }} file{{ preview.files === 1 ? '' : 's' }}?
        </div>
        <div class="replace-preview-files">
          <div v-for="change in preview.changes.slice(0, 8)" :key="change.path" class="replace-file">
            <span class="name">{{ change.rel }}</span>
            <span class="count">{{ change.matches }}</span>
          </div>
          <div v-if="preview.changes.length > 8" class="replace-more">
            +{{ preview.changes.length - 8 }} more file{{ preview.changes.length - 8 === 1 ? '' : 's' }}
          </div>
        </div>
        <div class="replace-preview-actions">
          <button class="btn sm primary" :disabled="applying" @click="confirmReplace">
            <Loader2 v-if="applying" :size="12" class="spin" />
            Replace all
          </button>
          <button class="btn sm" :disabled="applying" @click="preview = null">Cancel</button>
        </div>
      </div>

      <div v-for="[file, fileHits] in grouped" :key="file" class="file-group">
        <div class="file-head" @click="open(fileHits[0])">
          <span class="name">{{ file }}</span>
          <span class="count">{{ fileHits.length }}</span>
        </div>
        <div
          v-for="hit in fileHits.slice(0, 40)"
          :key="`${hit.path}:${hit.line}`"
          class="search-hit"
          @click="open(hit)"
        >
          <span class="loc">{{ hit.line }}:{{ hit.column }}</span>
          <span class="snippet">
            <template v-for="(part, i) in parts(hit.text)" :key="i">
              <mark v-if="part.m">{{ part.t }}</mark>
              <span v-else>{{ part.t }}</span>
            </template>
          </span>
        </div>
      </div>

      <div v-if="!query" class="pane-empty">Type to search across every text file.</div>
      <div v-else-if="!searching && !hits.length && !error" class="pane-empty">No matches.</div>
    </div>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.search-area {
  padding: 0 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.search-box {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 9px;
  border-radius: 7px;
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text-muted);
}
.search-box:focus-within {
  border-color: var(--accent);
}
.search-box input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 12px;
  user-select: text;
}
.replace-box input::placeholder {
  color: var(--text-faint);
}
.search-toggles {
  display: flex;
  align-items: center;
  gap: 3px;
  min-height: 20px;
}
.toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 20px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.toggle:hover {
  background: var(--glass);
  color: var(--text);
}
.toggle.on {
  color: var(--accent);
  border-color: var(--border-strong);
  background: var(--glass);
}
.result-count {
  font-size: 10.5px;
  color: var(--text-faint);
  display: flex;
  gap: 5px;
  margin-left: auto;
  overflow: hidden;
  white-space: nowrap;
}
.search-error {
  padding: 6px 8px;
  border: 1px solid var(--red);
  border-radius: 6px;
  background: color-mix(in srgb, var(--red) 12%, transparent);
  color: var(--red);
  font-size: 10.5px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.replace-preview {
  margin: 0 2px 10px;
  padding: 8px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--glass);
}
.replace-preview-head {
  font-size: 11.5px;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.replace-preview-files {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
  max-height: 140px;
  overflow: auto;
}
.replace-file {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10.5px;
  color: var(--text-muted);
}
.replace-file .name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.replace-file .count {
  color: var(--text-faint);
}
.replace-more {
  font-size: 10px;
  color: var(--text-faint);
}
.replace-preview-actions {
  display: flex;
  gap: 6px;
}
.file-group {
  margin-bottom: 6px;
}
.file-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 11.5px;
  color: var(--text-dim);
}
.file-head:hover {
  background: var(--glass);
}
.file-head .name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.file-head .count {
  font-size: 10px;
  color: var(--text-faint);
  background: var(--glass);
  padding: 1px 6px;
  border-radius: 999px;
}
.pane-empty {
  padding: 26px 12px;
  text-align: center;
  color: var(--text-faint);
  font-size: 12px;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
