<script setup lang="ts">
import { Search, CaseSensitive, X, Loader2 } from 'lucide-vue-next'
import type { SearchHit } from '../lib/types'
import { call, relativeTo } from '../lib/api'

const ide = useIde()
const query = ref('')
const caseSensitive = ref(false)
const hits = ref<SearchHit[]>([])
const searching = ref(false)
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

async function run() {
  if (!query.value.trim() || !ide.workspace.value) {
    hits.value = []
    return
  }
  searching.value = true
  try {
    hits.value = await call<SearchHit[]>('search_in_files', {
      query: query.value,
      caseSensitive: caseSensitive.value,
      limit: 400
    })
  } catch (err) {
    ide.notify(String(err), 'error')
  } finally {
    searching.value = false
  }
}

watch([query, caseSensitive], () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(run, 220)
})

function highlight(text: string) {
  const q = query.value
  if (!q) return text
  const idx = caseSensitive.value ? text.indexOf(q) : text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return text
  return (
    text.slice(0, idx) +
    '\u0001' +
    text.slice(idx, idx + q.length) +
    '\u0002' +
    text.slice(idx + q.length)
  )
}

function parts(text: string) {
  const marked = highlight(text)
  const out: { t: string; m: boolean }[] = []
  let inMark = false
  let buf = ''
  for (const ch of marked) {
    if (ch === '\u0001') {
      if (buf) out.push({ t: buf, m: inMark })
      buf = ''
      inMark = true
    } else if (ch === '\u0002') {
      if (buf) out.push({ t: buf, m: inMark })
      buf = ''
      inMark = false
    } else {
      buf += ch
    }
  }
  if (buf) out.push({ t: buf, m: inMark })
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
          :style="caseSensitive ? 'color:var(--accent)' : ''"
          title="Match case"
          @click="caseSensitive = !caseSensitive"
        >
          <CaseSensitive :size="15" />
        </button>
      </div>
    </div>

    <div style="padding: 0 10px 8px">
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
      <div v-if="query" class="result-count">
        {{ hits.length }} result{{ hits.length === 1 ? '' : 's' }}
        <span v-if="hits.length">across {{ grouped.length }} files</span>
      </div>
    </div>

    <div class="sidebar-body" style="padding-top: 0">
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
      <div v-else-if="!searching && !hits.length" class="pane-empty">No matches.</div>
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
.result-count {
  padding: 7px 2px 0;
  font-size: 10.5px;
  color: var(--text-faint);
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
