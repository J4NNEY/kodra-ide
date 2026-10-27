<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import { FileCode2, FolderOpen, History, Sparkles, X, FilePlus2 } from 'lucide-vue-next'
import type { EditorTab } from '../lib/types'
import { relativeTo } from '../lib/api'

const CodeEditor = defineAsyncComponent(() => import('./CodeEditor.vue'))
const TerminalPanel = defineAsyncComponent(() => import('./TerminalPanel.vue'))

const ide = useIde()
const panelHeight = useLayoutSize('panel-height', 220, 120, 620)
const cursor = useState('kudo:cursor', () => ({ line: 1, column: 1, selected: 0 }))

const activeTab = computed(() => ide.activeTab.value)
const gotoLine = computed(() => {
  const pending = ide.pendingLine.value
  if (!pending || !activeTab.value) return null
  return pending.path === activeTab.value.path ? pending.line : null
})

const crumbs = computed(() => {
  const tab = activeTab.value
  if (!tab) return [] as string[]
  const root = ide.workspace.value?.path
  const rel = root ? relativeTo(root, tab.path) : tab.name
  return rel.split(/[\\/]/).filter(Boolean)
})

const recents = computed(() => (ide.settings.value.recentWorkspaces ?? []).slice(0, 4))

const shortcuts = [
  { keys: 'Ctrl+P', label: 'Quick open a file' },
  { keys: 'Ctrl+Shift+P', label: 'Command palette' },
  { keys: 'Ctrl+Shift+A', label: 'Toggle the agent panel' },
  { keys: 'Ctrl+`', label: 'Toggle the terminal' }
]

function onChange(value: string) {
  if (activeTab.value) ide.updateContent(activeTab.value.path, value)
}

function onCursor(value: { line: number; column: number; selected: number }) {
  cursor.value = value
}

function select(tab: EditorTab) {
  ide.activePath.value = tab.path
  ide.persistSession()
}

function close(tab: EditorTab, event?: MouseEvent) {
  event?.stopPropagation()
  ide.closeTab(tab.path)
}

function startPanelDrag(event: PointerEvent) {
  event.preventDefault()
  const startY = event.clientY
  const startHeight = panelHeight.value
  const move = (e: PointerEvent) => {
    const max = Math.max(160, window.innerHeight - 320)
    panelHeight.value = Math.min(max, Math.max(120, startHeight - (e.clientY - startY)))
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

watch(gotoLine, async (line) => {
  if (!line) return
  await nextTick()
  setTimeout(() => {
    if (ide.pendingLine.value?.line === line) ide.pendingLine.value = null
  }, 700)
})
</script>

<template>
  <main class="editor-region" :style="{ '--panel-h': `${panelHeight}px` }">
    <div v-if="ide.tabs.value.length" class="tabbar">
      <div
        v-for="tab in ide.tabs.value"
        :key="tab.path"
        class="tab"
        :class="{ active: tab.path === ide.activePath.value }"
        :title="tab.path"
        @click="select(tab)"
        @mousedown.middle.prevent="close(tab)"
      >
        <span v-if="tab.dirty" class="dot" />
        <FileCode2 v-else :size="13" style="opacity: 0.55" />
        <span class="name">{{ tab.name }}</span>
        <button class="close" title="Close" @click="close(tab, $event)">
          <X :size="12" />
        </button>
      </div>
      <div style="flex: 1" />
    </div>

    <div v-if="activeTab" class="breadcrumbs">
      <template v-for="(crumb, i) in crumbs" :key="`${crumb}-${i}`">
        <span v-if="i" class="sep">›</span>
        <span :class="{ last: i === crumbs.length - 1 }">{{ crumb }}</span>
      </template>
      <div style="flex: 1" />
      <span class="hint">{{ activeTab.language }}</span>
    </div>

    <div class="editor-host">
      <CodeEditor
        v-if="activeTab"
        :key="activeTab.path"
        :tab="activeTab"
        :goto-line="gotoLine"
        @change="onChange"
        @save="ide.saveTab()"
        @cursor="onCursor"
      />

      <div v-else class="empty-state">
        <div class="empty-mark">K</div>
        <h2>{{ ide.workspace.value ? ide.workspace.value.name : 'Welcome to Kudo' }}</h2>
        <p v-if="!ide.workspace.value">
          A clean-room desktop IDE for code, terminals and AI agents. Open a folder to start
          editing, or reconnect an existing project from the list below.
        </p>
        <p v-else>
          Open a file from the explorer, jump with <kbd>Ctrl</kbd>+<kbd>P</kbd>, or ask the agent
          to make a change for you.
        </p>

        <div class="welcome-actions">
          <button class="btn primary" @click="ide.openFolder()">
            <FolderOpen :size="15" /> Open Folder
          </button>
          <button class="btn" @click="ide.palette.value = { mode: 'files' }">
            <FilePlus2 :size="15" /> Go to File
          </button>
          <button class="btn" @click="ide.toggleChat()">
            <Sparkles :size="15" /> Ask the Agent
          </button>
        </div>

        <div v-if="!ide.workspace.value && recents.length" class="recent-list">
          <div class="section-label" style="padding-left: 2px">Recent workspaces</div>
          <button
            v-for="recent in recents"
            :key="recent.path"
            class="recent-item"
            @click="ide.openFolder(recent.path)"
          >
            <History :size="14" style="color: var(--text-faint)" />
            <div class="col">
              <span class="name">{{ recent.name }}</span>
              <span class="path">{{ recent.path }}</span>
            </div>
          </button>
        </div>

        <div class="shortcut-grid">
          <div v-for="item in shortcuts" :key="item.keys" class="shortcut">
            <kbd>{{ item.keys }}</kbd>
            <span>{{ item.label }}</span>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="ide.panelVisible.value"
      class="resizer-h"
      title="Resize panel"
      @pointerdown="startPanelDrag"
    />
    <TerminalPanel />
  </main>
</template>

<style scoped>
.welcome-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 4px;
}
.shortcut-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(160px, auto));
  gap: 8px 26px;
  margin-top: 18px;
  text-align: left;
}
.shortcut {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11.5px;
  color: var(--text-faint);
}
.shortcut kbd {
  min-width: 84px;
  text-align: center;
}
.empty-state .recent-list {
  margin-top: 14px;
}
</style>
