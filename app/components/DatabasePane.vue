<script setup lang="ts">
import {
  Database,
  FilePlus2,
  FolderOpen,
  RefreshCw,
  Table2,
  Terminal,
  Trash2
} from 'lucide-vue-next'

const db = useDatabase()

onMounted(async () => {
  await db.init()
})
</script>

<template>
  <div class="pane">
    <div class="sidebar-header">
      <span class="sidebar-title">Database</span>
      <div class="sidebar-actions">
        <button class="icon-btn" title="New SQLite database" @click="db.createDatabase()">
          <FilePlus2 :size="13" />
        </button>
        <button class="icon-btn" title="Open database" @click="db.openDatabase()">
          <FolderOpen :size="13" />
        </button>
        <button class="icon-btn" title="Refresh tables" @click="db.refreshTables()">
          <RefreshCw :size="13" :class="{ spin: db.busy.value }" />
        </button>
      </div>
    </div>

    <div class="sidebar-body">
      <div v-if="!db.connections.value.length" class="db-empty">
        <Database :size="24" :stroke-width="1.4" style="opacity: 0.4" />
        <p>No database connected.</p>
        <button class="btn primary sm" @click="db.openDatabase()">
          <FolderOpen :size="12" /> Open SQLite file
        </button>
        <button class="btn ghost sm" @click="db.createDatabase()">Create database</button>
        <span class="hint" style="text-align: center">
          SQLite files are opened read-write. Queries run in the Rust backend, not the
          webview.
        </span>
      </div>

      <template v-else>
        <div class="section-label">Connections</div>
        <button
          v-for="conn in db.connections.value"
          :key="conn.id"
          class="db-conn"
          :class="{ active: conn.id === db.activeId.value }"
          :title="conn.path"
          @click="db.select(conn.id)"
        >
          <Database :size="13" />
          <div class="col">
            <span class="name">{{ conn.name }}</span>
            <span class="path">{{ conn.path }}</span>
          </div>
          <span class="count">{{ conn.tables }}</span>
          <span class="icon-btn" title="Disconnect" @click.stop="db.disconnect(conn.id)">
            <Trash2 :size="11" />
          </span>
        </button>

        <div class="section-label" style="margin-top: 10px">
          Tables · {{ db.tables.value.length }}
        </div>
        <button
          v-for="table in db.tables.value"
          :key="table.name"
          class="db-table"
          :class="{ active: db.selectedTable.value === table.name }"
          @click="db.openTable(table.name)"
        >
          <Table2 :size="13" />
          <span class="name">{{ table.name }}</span>
          <span class="rows">{{ table.rows.toLocaleString() }}</span>
        </button>
        <div v-if="!db.tables.value.length" class="hint" style="padding: 8px">
          This database has no tables yet.
        </div>

        <button class="btn ghost sm" style="width: 100%; margin-top: 10px" @click="db.consoleOpen.value = true">
          <Terminal :size="12" /> SQL console
        </button>

        <div v-if="db.schema.value.length" class="schema">
          <div class="section-label" style="padding-left: 0">
            {{ db.selectedTable.value }} columns
          </div>
          <div class="schema-row">
            <span
              v-for="col in db.schema.value"
              :key="col.name"
              class="col-chip"
              :title="`${col.kind}${col.notNull ? ' · not null' : ''}${col.primaryKey ? ' · primary key' : ''}`"
            >
              {{ col.name }}
              <em>{{ col.kind }}</em>
            </span>
          </div>
        </div>
      </template>
    </div>

    <SqlConsole />
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.db-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 34px 14px;
  text-align: center;
  color: var(--text-faint);
  font-size: 12px;
}
.db-empty p {
  margin: 0 0 4px;
}
.db-conn {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim);
  font-size: 11.5px;
  cursor: pointer;
  text-align: left;
}
.db-conn:hover {
  background: var(--glass);
}
.db-conn.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.db-conn .col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.db-conn .path {
  font-size: 9.5px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.db-conn .count {
  font-size: 9.5px;
  color: var(--text-faint);
  padding: 0 5px;
  border-radius: 999px;
  background: var(--glass);
}
.db-conn .icon-btn {
  opacity: 0;
}
.db-conn:hover .icon-btn {
  opacity: 1;
}
.db-table {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 4px 9px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11.5px;
  cursor: pointer;
  text-align: left;
}
.db-table:hover {
  background: var(--glass);
  color: var(--text);
}
.db-table.active {
  color: var(--accent);
  background: var(--accent-soft);
}
.db-table .name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-table .rows {
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--text-faint);
}
.schema {
  margin-top: 12px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
.schema-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.col-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface-2);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-dim);
}
.col-chip em {
  font-style: normal;
  font-size: 8.5px;
  color: var(--text-faint);
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
