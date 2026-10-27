<script setup lang="ts">
import { computed } from 'vue'
import { CircleAlert, Info, TriangleAlert } from 'lucide-vue-next'
import { relativeTo } from '../lib/api'

const ide = useIde()
const lsp = useLsp()

const groups = computed(() => {
  const byPath = new Map<string, typeof lsp.allDiagnostics.value>()
  for (const item of lsp.allDiagnostics.value) {
    const list = byPath.get(item.path) ?? []
    list.push(item)
    byPath.set(item.path, list)
  }
  return [...byPath.entries()].map(([path, items]) => ({
    path,
    label: ide.workspace.value ? relativeTo(ide.workspace.value.path, path) : path,
    items,
    errors: items.filter((i) => i.severity === 'error').length,
    warnings: items.filter((i) => i.severity === 'warning').length
  }))
})

function iconFor(severity: string) {
  if (severity === 'error') return CircleAlert
  if (severity === 'warning') return TriangleAlert
  return Info
}

function open(path: string, line: number) {
  void ide.openFile(path, line)
}
</script>

<template>
  <div class="problems-panel">
    <div v-if="!groups.length" class="problems-empty">
      <span>No problems have been detected in the workspace.</span>
      <span class="hint">
        Diagnostics appear here once a language server is connected (Rust, Go, TypeScript, Python and
        others).
      </span>
    </div>

    <div v-for="group in groups" :key="group.path" class="problem-group">
      <button class="problem-file" @click="open(group.path, group.items[0].line)">
        <span class="file-label">{{ group.label }}</span>
        <span class="file-counts">
          <span v-if="group.errors" class="count error">{{ group.errors }}</span>
          <span v-if="group.warnings" class="count warning">{{ group.warnings }}</span>
        </span>
      </button>
      <button
        v-for="(item, index) in group.items"
        :key="`${group.path}:${item.line}:${item.column}:${index}`"
        class="problem-row"
        :class="item.severity"
        @click="open(item.path, item.line)"
      >
        <component :is="iconFor(item.severity)" :size="13" class="problem-icon" />
        <span class="problem-message">{{ item.message }}</span>
        <span class="problem-source">{{ item.source }}</span>
        <span class="problem-loc">{{ item.line }}:{{ item.column }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.problems-panel {
  height: 100%;
  overflow: auto;
  padding: 6px 8px 12px;
  font-size: 12px;
}
.problems-empty {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 4px;
  color: var(--text-faint);
  font-size: 11.5px;
}
.problems-empty .hint {
  color: var(--text-faint);
  opacity: 0.75;
}
.problem-group + .problem-group {
  margin-top: 6px;
}
.problem-file {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 4px 6px;
  background: transparent;
  border: 0;
  border-radius: 5px;
  color: var(--text);
  font-size: 11.5px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.problem-file:hover {
  background: var(--glass);
}
.file-counts {
  display: flex;
  gap: 6px;
}
.count {
  font-size: 10px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--glass);
}
.count.error {
  color: var(--red);
}
.count.warning {
  color: var(--yellow, #d7ba7d);
}
.problem-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  padding: 3px 6px 3px 16px;
  background: transparent;
  border: 0;
  border-radius: 5px;
  color: var(--text-muted);
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
  font-family: var(--font-mono);
}
.problem-row:hover {
  background: var(--glass);
  color: var(--text);
}
.problem-icon {
  flex: 0 0 auto;
  transform: translateY(2px);
}
.problem-row.error .problem-icon {
  color: var(--red);
}
.problem-row.warning .problem-icon {
  color: var(--yellow, #d7ba7d);
}
.problem-row.info .problem-icon,
.problem-row.hint .problem-icon {
  color: var(--blue, #6cb6ff);
}
.problem-message {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.problem-source,
.problem-loc {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-size: 10.5px;
}
</style>
