<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  Check,
  ChevronDown,
  Clock,
  Database,
  Download,
  Play,
  X
} from 'lucide-vue-next'
import { call, pickSaveFile } from '../lib/api'

const ide = useIde()
const db = useDatabase()

const ta = ref<HTMLTextAreaElement | null>(null)
const showHistory = ref(false)
const showStructure = ref(false)
const copied = ref(false)

const result = computed(() => db.result.value)
const columns = computed(() => result.value?.columns ?? [])
const rows = computed(() => result.value?.rows ?? [])
const grammar = computed(() => db.lastSql.value.trim().split(/\s+/)[0]?.toUpperCase() ?? '')

function close() {
  db.consoleOpen.value = false
}

async function run() {
  if (db.busy.value) return
  await db.run()
  await nextTick()
}

function pickHistory(sql: string) {
  db.lastSql.value = sql
  showHistory.value = false
  run()
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function isNull(value: unknown) {
  return value === null || value === undefined
}

async function exportCsv() {
  if (!result.value?.columns.length) return
  const esc = (value: unknown) => {
    const text = formatValue(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const csv = [
    result.value.columns.map(esc).join(','),
    ...result.value.rows.map((row) => row.map(esc).join(','))
  ].join('\n')
  const path = await pickSaveFile('query-result.csv', [
    { name: 'CSV', extensions: ['csv'] }
  ])
  if (!path) return
  try {
    await call('export_text', { path, text: csv })
    ide.notify('Results exported', 'success')
  } catch (err) {
    ide.notify(String(err), 'error')
  }
}

function insertSnippet(text: string) {
  db.lastSql.value = text
  ta.value?.focus()
}

async function copyResult() {
  if (!result.value) return
  const text = [
    result.value.columns.join('\t'),
    ...result.value.rows.map((row) => row.map(formatValue).join('\t'))
  ].join('\n')
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => (copied.value = false), 1200)
  } catch {
    /* clipboard may be blocked */
  }
}

watch(
  () => db.consoleOpen.value,
  async (open) => {
    if (open) {
      await nextTick()
      ta.value?.focus()
    }
  }
)

function onKey(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    run()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="db.consoleOpen.value" class="overlay" @click.self="close">
      <div class="modal sql-modal">
        <div class="modal-head">
          <Database :size="15" />
          <h2>SQL Console</h2>
          <span v-if="db.active.value" class="hint">{{ db.active.value.name }}</span>
          <span v-if="db.active.value" class="badge">SQLite</span>
          <div style="flex: 1" />
          <button class="icon-btn" title="Close" @click="close"><X :size="15" /></button>
        </div>

        <div class="sql-toolbar">
          <button class="btn primary sm" :disabled="db.busy.value || !db.active.value" @click="run">
            <Play :size="12" /> Run
            <kbd>Ctrl+↵</kbd>
          </button>

          <div class="history-wrap">
            <button class="btn ghost sm" @click="showHistory = !showHistory">
              <Clock :size="12" /> History
              <ChevronDown :size="11" />
            </button>
            <div v-if="showHistory" class="history-menu">
              <button
                v-for="sql in db.history.value"
                :key="sql"
                class="history-item"
                @click="pickHistory(sql)"
              >
                {{ sql.replace(/\s+/g, ' ').slice(0, 90) }}
              </button>
              <div v-if="!db.history.value.length" class="palette-empty">No queries yet.</div>
            </div>
          </div>

          <button class="btn ghost sm" @click="showStructure = !showStructure">
            <Database :size="12" /> Structure
          </button>
          <button class="btn ghost sm" @click="insertSnippet('select * from users limit 200')">
            Sample
          </button>

          <div style="flex: 1" />

          <span v-if="db.busy.value" class="hint">Running…</span>
          <button class="btn ghost sm" :disabled="!result" @click="exportCsv">
            <Download :size="12" /> CSV
          </button>
          <button class="btn ghost sm" :disabled="!result" @click="copyResult">
            <Check v-if="copied" :size="12" />
            {{ copied ? 'Copied' : 'Copy' }}
          </button>
        </div>

        <div class="sql-body">
          <textarea
            ref="ta"
            v-model="db.lastSql.value"
            class="sql-editor"
            spellcheck="false"
            placeholder="select * from sqlite_master where type = 'table';"
            @keydown="onKey"
          />

          <div v-if="db.error.value" class="sql-error">{{ db.error.value }}</div>

          <div class="result-head">
            <span v-if="result && columns.length" class="stat">
              <strong>{{ rows.length.toLocaleString() }}</strong> rows
              <span v-if="result.truncated" class="hint">(truncated)</span>
              · <strong>{{ result.durationMs }}</strong> ms
            </span>
            <span v-else-if="result" class="stat">
              Statement OK · <strong>{{ result.affected }}</strong> affected ·
              <strong>{{ result.durationMs }}</strong> ms
            </span>
            <span v-else class="stat hint">Results appear here after you run a query.</span>
            <div style="flex: 1" />
            <span v-if="grammar" class="badge">{{ grammar }}</span>
          </div>

          <div v-if="columns.length" class="grid-wrap">
            <table class="grid">
              <thead>
                <tr>
                  <th class="rownum">#</th>
                  <th v-for="col in columns" :key="col">{{ col }}</th>
                  <th class="filler" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in rows" :key="i">
                  <td class="rownum">{{ i + 1 }}</td>
                  <td
                    v-for="(value, j) in row"
                    :key="j"
                    :class="{ null: isNull(value), number: typeof value === 'number' }"
                  >
                    {{ formatValue(value) }}
                  </td>
                  <td class="filler" aria-hidden="true" />
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-if="showStructure" class="structure">
          <div v-for="col in db.schema.value" :key="col.name" class="struct-col">
            <span class="struct-name">{{ col.name }}</span>
            <span class="struct-type">{{ col.kind || 'ANY' }}</span>
            <span v-if="col.primaryKey" class="pk">PK</span>
            <span v-if="col.notNull" class="nn">NOT NULL</span>
            <span v-if="col.defaultValue !== null" class="hint">default {{ col.defaultValue }}</span>
          </div>
          <div v-if="!db.schema.value.length" class="hint" style="padding: 8px">
            Select a table to inspect its columns.
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sql-modal {
  width: min(1120px, 96vw);
  height: min(760px, 92vh);
  max-height: 92vh;
}
.badge {
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--text-faint);
  text-transform: uppercase;
}
.sql-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.sql-toolbar kbd {
  margin-left: 4px;
  opacity: 0.6;
  font-size: 9px;
}
.history-wrap {
  position: relative;
}
.history-menu {
  position: absolute;
  top: 32px;
  left: 0;
  width: 380px;
  max-height: 300px;
  overflow-y: auto;
  padding: 4px;
  z-index: 40;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--surface-1);
  box-shadow: var(--shadow-lg);
}
.history-item {
  display: block;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 10.5px;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.history-item:hover {
  background: var(--glass);
  color: var(--text);
}
.sql-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.sql-editor {
  flex: 0 0 auto;
  height: 118px;
  resize: none;
  padding: 12px 14px;
  border: 0;
  border-bottom: 1px solid var(--border);
  outline: none;
  background: var(--surface-2);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.6;
  tab-size: 2;
}
.sql-error {
  margin: 8px 12px 0;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--red) 40%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--red) 10%, transparent);
  color: var(--red);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: pre-wrap;
}
.result-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-faint);
}
.stat strong {
  color: var(--text-dim);
  font-weight: 500;
}
.grid-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.grid {
  border-collapse: separate;
  border-spacing: 0;
  width: max-content;
  min-width: 100%;
  font-family: var(--font-mono);
  font-size: 11px;
}
.grid th {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 6px 10px;
  background: var(--surface-3);
  border-bottom: 1px solid var(--border-strong);
  border-right: 1px solid var(--border);
  color: var(--text-muted);
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}
.grid td {
  padding: 5px 10px;
  border-bottom: 1px solid var(--border);
  border-right: 1px solid var(--border);
  color: var(--text-dim);
  white-space: pre;
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.grid tbody tr:hover td {
  background: var(--glass);
}
.grid td.number {
  color: var(--blue);
  text-align: right;
}
.grid td.null {
  color: var(--text-faint);
  font-style: italic;
}
.rownum {
  width: 44px;
  min-width: 44px;
  color: var(--text-faint) !important;
  text-align: right !important;
  background: var(--surface-1);
  position: sticky;
  left: 0;
  z-index: 1;
}
.grid th.filler,
.grid td.filler {
  width: 100%;
  max-width: none;
  padding: 0;
  border-right: 0;
  background: transparent;
}
.grid tbody tr:hover td.filler {
  background: transparent;
}
.grid th.rownum {
  z-index: 3;
}
.structure {
  flex: 0 0 auto;
  max-height: 132px;
  overflow-y: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  background: var(--surface-1);
}
.struct-col {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 7px;
  border: 1px solid var(--border);
  border-radius: 5px;
  font-family: var(--font-mono);
  font-size: 10px;
}
.struct-name {
  color: var(--text-dim);
}
.struct-type {
  color: var(--accent);
  font-size: 9px;
}
.pk {
  font-size: 8px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--accent-soft);
  color: var(--accent);
}
.nn {
  font-size: 8px;
  color: var(--text-faint);
}
</style>
