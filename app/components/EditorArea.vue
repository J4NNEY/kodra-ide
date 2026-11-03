<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { FilePlus2, FolderOpen, History, Sparkles } from 'lucide-vue-next'

const EditorPane = defineAsyncComponent(() => import('./EditorPane.vue'))
const DebugToolbar = defineAsyncComponent(() => import('./DebugToolbar.vue'))
const TerminalPanel = defineAsyncComponent(() => import('./TerminalPanel.vue'))

const ide = useIde()
const panelHeight = useLayoutSize('panel-height', 220, 120, 620)
const splitRatio = useLayoutSize('split-ratio', 50, 15, 85)
const panesEl = ref<HTMLDivElement | null>(null)

const recents = computed(() => (ide.settings.value.recentWorkspaces ?? []).slice(0, 4))

const shortcuts = [
  { keys: 'Ctrl+P', label: 'Quick open a file' },
  { keys: 'Ctrl+Shift+P', label: 'Command palette' },
  { keys: 'Ctrl+Shift+A', label: 'Toggle the agent panel' },
  { keys: 'Ctrl+`', label: 'Toggle the terminal' },
  { keys: 'Ctrl+\\', label: 'Split the editor' }
]

function paneStyle(id: 'main' | 'side') {
  if (!ide.splitOpen.value) return undefined
  return id === 'main' ? { flex: `0 0 ${splitRatio.value}%` } : { flex: '1 1 0' }
}

function startDividerDrag(event: PointerEvent) {
  event.preventDefault()
  const host = panesEl.value
  if (!host) return
  const rect = host.getBoundingClientRect()
  const move = (e: PointerEvent) => {
    const raw = ((e.clientX - rect.left) / rect.width) * 100
    const minPx = Math.min(45, (240 / rect.width) * 100)
    const lo = Math.max(15, minPx)
    const hi = Math.min(85, 100 - minPx)
    splitRatio.value = Math.round(lo > hi ? 50 : Math.min(hi, Math.max(lo, raw)))
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
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
</script>

<template>
  <main class="editor-region" :style="{ '--panel-h': `${panelHeight}px` }">
    <DebugToolbar />
    <div v-if="!ide.tabs.value.length" class="editor-panes">
      <section class="editor-pane focused">
        <div class="editor-host">
          <div class="empty-state">
            <div class="empty-mark">K</div>
            <h2>{{ ide.workspace.value ? ide.workspace.value.name : 'Welcome to Kodra' }}</h2>
            <p v-if="!ide.workspace.value">
              A clean-room desktop IDE for code, terminals and AI agents. Open a folder to start
              editing, or reconnect an existing project from the list below.
            </p>
            <p v-else>
              Open a file from the explorer, jump with <kbd>Ctrl</kbd>+<kbd>P</kbd>, or ask the
              agent to make a change for you.
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
      </section>
    </div>

    <div
      v-else
      ref="panesEl"
      class="editor-panes"
      :class="{ split: ide.splitOpen.value }"
    >
      <EditorPane
        v-for="group in ide.groups.value"
        :key="group.id"
        :group-id="group.id"
        :style="paneStyle(group.id)"
      />
      <div
        v-if="ide.splitOpen.value"
        class="pane-divider"
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize panes"
        @pointerdown="startDividerDrag"
      />
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
