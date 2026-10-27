<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { FileCode2, Search } from 'lucide-vue-next'
import type { QuickFile } from '../lib/types'
import { call } from '../lib/api'

const ide = useIde()

const query = ref('')
const index = ref(0)
const results = ref<QuickFile[]>([])
const loading = ref(false)
const inputEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLDivElement | null>(null)

let timer: ReturnType<typeof setTimeout> | null = null
let seq = 0

const open = computed(() => ide.palette.value.mode === 'files')

async function search() {
  if (!open.value) return
  const q = query.value.trim()
  if (!q) {
    results.value = []
    return
  }
  const token = ++seq
  loading.value = true
  try {
    const hits = await call<QuickFile[]>('search_files', { query: q, limit: 60 })
    if (token === seq) results.value = hits ?? []
  } catch (err) {
    if (token === seq) ide.notify(String(err), 'error')
  } finally {
    if (token === seq) loading.value = false
  }
}

watch(query, () => {
  index.value = 0
  if (timer) clearTimeout(timer)
  timer = setTimeout(search, 140)
})

watch(open, async (visible) => {
  if (!visible) return
  query.value = ''
  results.value = []
  index.value = 0
  await nextTick()
  inputEl.value?.focus()
})

function close() {
  ide.palette.value = { mode: 'none' }
}

function pick(file: QuickFile) {
  close()
  ide.openFile(file.path)
}

function move(delta: number) {
  if (!results.value.length) return
  index.value = (index.value + delta + results.value.length) % results.value.length
  nextTick(() => {
    listEl.value
      ?.querySelector<HTMLElement>(`[data-index="${index.value}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  })
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const file = results.value[index.value]
    if (file) pick(file)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="close">
      <div class="palette">
        <div class="palette-input">
          <Search :size="15" style="color: var(--text-faint)" />
          <input
            ref="inputEl"
            v-model="query"
            placeholder="Search files by name…"
            spellcheck="false"
            autofocus
            @keydown="onKeydown"
          />
          <span v-if="loading" class="hint">searching…</span>
          <kbd>Esc</kbd>
        </div>
        <div ref="listEl" class="palette-list">
          <div
            v-for="(file, i) in results"
            :key="file.path"
            class="palette-item"
            :class="{ active: i === index }"
            :data-index="i"
            :title="file.path"
            @mouseenter="index = i"
            @click="pick(file)"
          >
            <FileCode2 :size="13" style="color: var(--text-faint); flex: 0 0 auto" />
            <span style="flex: 0 0 auto">{{ file.name }}</span>
            <span class="path">{{ file.rel }}</span>
          </div>
          <div v-if="!query.trim()" class="palette-empty">
            Start typing to search every file in the workspace.
          </div>
          <div v-else-if="!loading && !results.length" class="palette-empty">
            No files match “{{ query }}”.
          </div>
        </div>
        <div class="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.palette-foot {
  display: flex;
  gap: 16px;
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  font-size: 10.5px;
  color: var(--text-faint);
}
.palette-foot span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.palette-item .path {
  max-width: 62%;
}
</style>
