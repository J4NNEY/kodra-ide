<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Activity, RefreshCw, Trash2 } from 'lucide-vue-next'
import type { NetEntry } from '../lib/types'
import { call } from '../lib/api'

const ide = useIde()
const entries = ref<NetEntry[]>([])
const filter = ref<'all' | 'ai' | 'http' | 'update'>('all')
const loading = ref(false)
const paused = ref(false)

let timer: ReturnType<typeof setInterval> | null = null

const visible = computed(() =>
  filter.value === 'all' ? entries.value : entries.value.filter((e) => e.kind === filter.value)
)

const errorCount = computed(() => entries.value.filter((e) => e.error || (e.status ?? 0) >= 400).length)

async function load() {
  if (paused.value) return
  loading.value = true
  try {
    entries.value = await call<NetEntry[]>('netlog_list', { limit: 300 })
  } catch {
    /* logging is best-effort */
  } finally {
    loading.value = false
  }
}

async function clear() {
  try {
    await call('netlog_clear')
    entries.value = []
  } catch (err) {
    ide.notify(String(err), 'error')
  }
}

function stamp(seconds: number) {
  return new Date(seconds * 1000).toLocaleTimeString([], { hour12: false })
}

function size(bytes: number) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function shortUrl(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

function start() {
  stop()
  load()
  timer = setInterval(load, 2000)
}

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

watch(
  () => ide.panelVisible.value && ide.panelTab.value === 'network',
  (active) => (active ? start() : stop()),
  { immediate: true }
)

onBeforeUnmount(stop)
</script>

<template>
  <div class="panel-body network-body">
    <div class="out-head">
      <Activity :size="12" />
      <span>Network activity</span>
      <div class="chips-inline">
        <button
          v-for="kind in ['all', 'ai', 'http', 'update']"
          :key="kind"
          class="chip"
          :class="{ active: filter === kind }"
          @click="filter = kind as typeof filter"
        >
          {{ kind }}
        </button>
      </div>
      <span v-if="errorCount" class="err-count">{{ errorCount }} failed</span>
      <div style="flex: 1" />
      <button class="btn ghost sm" @click="paused = !paused">
        {{ paused ? 'Resume' : 'Pause' }}
      </button>
      <button class="btn ghost sm" @click="load">
        <RefreshCw :size="12" :class="{ spin: loading }" />
      </button>
      <button class="btn ghost sm" @click="clear">
        <Trash2 :size="12" /> Clear
      </button>
    </div>

    <div class="net-table">
      <div class="net-row head">
        <span>Time</span>
        <span>Kind</span>
        <span>Method</span>
        <span>Status</span>
        <span>Time</span>
        <span>Size</span>
        <span class="url">URL</span>
      </div>
      <div
        v-for="entry in visible"
        :key="entry.id"
        class="net-row"
        :class="{ failed: entry.error || (entry.status ?? 0) >= 400 }"
      >
        <span class="mono">{{ stamp(entry.at) }}</span>
        <span class="kind" :class="entry.kind">{{ entry.kind }}</span>
        <span class="mono">{{ entry.method }}</span>
        <span class="mono">{{ entry.status ?? '—' }}</span>
        <span class="mono">{{ entry.durationMs }} ms</span>
        <span class="mono">{{ size(entry.bytes) }}</span>
        <span class="url" :title="entry.url">{{ shortUrl(entry.url) }}</span>
      </div>
      <div v-if="!visible.length" class="panel-empty">
        No network activity yet. Agent calls, browser requests and update checks appear here.
      </div>
    </div>

    <div v-if="entries.length" class="net-foot">
      <span class="hint">
        {{ entries.length }} events · live tail {{ paused ? 'paused' : 'every 2s' }}
      </span>
      <div style="flex: 1" />
      <span v-if="entries.find((e) => e.error)" class="hint err-text">
        {{ entries.find((e) => e.error)?.error }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.network-body {
  padding: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.out-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-faint);
}
.chips-inline {
  display: flex;
  gap: 3px;
}
.chip {
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-faint);
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
}
.chip.active {
  border-color: var(--accent);
  color: var(--accent);
}
.err-count {
  color: var(--red);
  font-size: 10px;
}
.net-table {
  flex: 1;
  min-height: 0;
  overflow: auto;
  font-size: 10.5px;
}
.net-row {
  display: grid;
  grid-template-columns: 72px 52px 58px 48px 62px 62px minmax(200px, 1fr);
  gap: 8px;
  align-items: center;
  padding: 3px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text-dim);
}
.net-row.head {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--surface-2);
  color: var(--text-faint);
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.net-row:not(.head):hover {
  background: var(--glass);
}
.net-row.failed {
  color: color-mix(in srgb, var(--red) 75%, var(--text) 25%);
}
.mono {
  font-family: var(--font-mono);
}
.kind {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent);
}
.kind.http {
  color: var(--blue);
}
.kind.update {
  color: var(--purple);
}
.url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 10px;
}
.net-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 10px;
  border-top: 1px solid var(--border);
  font-size: 10px;
}
.err-text {
  color: var(--red);
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
