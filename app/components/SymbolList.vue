<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Boxes, FileCode2, ListTree, Search } from 'lucide-vue-next'

const ide = useIde()
const intel = useCodeIntel()

const query = ref('')
const index = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLDivElement | null>(null)

const filtered = computed(() => {
  const items = intel.list.value?.items ?? []
  const q = query.value.trim().toLowerCase()
  if (!q) return items
  return items.filter((item) =>
    `${item.label} ${item.detail} ${item.preview}`.toLowerCase().includes(q)
  )
})

watch(filtered, () => {
  index.value = 0
})

let searchTimer: ReturnType<typeof setTimeout> | null = null

// Workspace symbol queries are answered by the language server, so refine the
// list as the user types instead of relying on the initial (often empty) reply.
watch(query, (value) => {
  if (intel.list.value?.mode !== 'workspace-symbols') return
  if (!value.trim()) return
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchTimer = null
    void intel.searchWorkspaceSymbols(value)
  }, 220)
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

watch(
  () => intel.list.value?.mode,
  async (mode) => {
    if (!mode) return
    query.value = ''
    index.value = 0
    await nextTick()
    inputEl.value?.focus()
  }
)

function move(delta: number) {
  if (!filtered.value.length) return
  const next = (index.value + delta + filtered.value.length) % filtered.value.length
  index.value = next
  nextTick(() => {
    listEl.value
      ?.querySelector<HTMLElement>(`[data-index="${next}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  })
}

function pick(at?: number) {
  const item = filtered.value[at ?? index.value]
  if (!item) return
  intel.cancelList()
  void ide.openFile(item.path, item.line, false, true)
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
    pick()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    intel.cancelList()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="intel.list.value" class="overlay" @click.self="intel.cancelList()">
      <div class="palette">
        <div class="palette-input">
          <Search :size="15" style="color: var(--text-faint)" />
          <input
            ref="inputEl"
            v-model="query"
            :placeholder="intel.list.value.title"
            spellcheck="false"
            autocomplete="off"
            @keydown="onKeydown"
          />
          <span v-if="intel.list.value.loading" class="hint">loading…</span>
          <kbd>Esc</kbd>
        </div>
        <div ref="listEl" class="palette-list">
          <div
            v-for="(item, i) in filtered"
            :key="`${item.path}:${item.line}:${item.column}:${item.label}:${i}`"
            class="palette-item intel-row"
            :class="{ active: i === index }"
            :data-index="i"
            :title="item.preview || `${item.label} ${item.detail}`"
            @mouseenter="index = i"
            @click="pick(i)"
          >
            <Boxes
              v-if="intel.list.value.mode === 'workspace-symbols'"
              :size="13"
              style="color: var(--text-faint); flex: 0 0 auto"
            />
            <FileCode2
              v-else-if="intel.list.value.mode === 'references'"
              :size="13"
              style="color: var(--text-faint); flex: 0 0 auto"
            />
            <ListTree
              v-else
              :size="13"
              style="color: var(--text-faint); flex: 0 0 auto"
            />
            <span
              class="intel-label"
              :style="{ paddingLeft: `${(item.depth ?? 0) * 12}px` }"
            >
              {{ item.label }}
            </span>
            <span v-if="item.detail" class="intel-detail">{{ item.detail }}</span>
            <span v-if="item.preview" class="intel-preview">{{ item.preview }}</span>
          </div>
          <div v-if="!intel.list.value.loading && !filtered.length" class="palette-empty">
            {{
              intel.list.value.mode === 'workspace-symbols' && !query.trim()
                ? 'Type a name to search symbols in the workspace.'
                : intel.list.value.items.length
                  ? 'Nothing matches your filter.'
                  : 'Nothing found.'
            }}
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
.intel-row {
  gap: 8px;
}
.intel-label {
  flex: 0 1 auto;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.intel-detail {
  flex: 0 0 auto;
  font-size: 10.5px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.intel-preview {
  flex: 1 1 auto;
  min-width: 0;
  margin-left: auto;
  font-family: var(--font-mono, monospace);
  font-size: 10.5px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}
</style>
