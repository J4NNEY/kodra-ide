<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import { Columns2, FileCode2, FilePlus2, X } from 'lucide-vue-next'
import type { EditorTab } from '../lib/types'
import type { EditorGroupId } from '../composables/useIde'
import { relativeTo } from '../lib/api'

const CodeEditor = defineAsyncComponent(() => import('./CodeEditor.vue'))

const props = defineProps<{ groupId: EditorGroupId }>()

const ide = useIde()
const cursor = useState('kudo:cursor', () => ({ line: 1, column: 1, selected: 0 }))
const dragPath = ref<string | null>(null)

const group = computed(() => ide.groups.value.find((item) => item.id === props.groupId) ?? null)
const paneTabs = computed(() => ide.groupTabs(props.groupId))
const activeTab = computed(() => {
  const active = group.value?.active
  if (!active) return null
  return ide.tabs.value.find((tab) => tab.path === active) ?? null
})

const gotoLine = computed(() => {
  const pending = ide.pendingLine.value
  const tab = activeTab.value
  if (!pending || !tab) return null
  return pending.path === tab.path ? pending.line : null
})

const crumbs = computed(() => {
  const tab = activeTab.value
  if (!tab) return [] as string[]
  const root = ide.workspace.value?.path
  const rel = root ? relativeTo(root, tab.path) : tab.name
  return rel.split(/[\\/]/).filter(Boolean)
})

function onChange(value: string) {
  if (activeTab.value) ide.updateContent(activeTab.value.path, value)
}

function onCursor(value: { line: number; column: number; selected: number }) {
  if (ide.activeGroupId.value !== props.groupId) return
  cursor.value = value
}

function select(tab: EditorTab) {
  ide.activateTab(props.groupId, tab.path)
}

function close(tab: EditorTab, event?: MouseEvent) {
  event?.stopPropagation()
  ide.closeTab(tab.path, props.groupId)
}

function onDragStart(event: DragEvent, tab: EditorTab) {
  dragPath.value = tab.path
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(
    'application/x-kudo-tab',
    JSON.stringify({ path: tab.path, groupId: props.groupId })
  )
  event.dataTransfer.setData('text/plain', tab.path)
}

function onDragOver(event: DragEvent) {
  if (!event.dataTransfer) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
}

function onDrop(event: DragEvent) {
  dragPath.value = null
  const raw = event.dataTransfer?.getData('application/x-kudo-tab')
  if (!raw) return
  try {
    const payload = JSON.parse(raw) as { path?: string; groupId?: EditorGroupId }
    if (!payload.path) return
    const from = payload.groupId === 'side' ? 'side' : 'main'
    ide.moveTab(payload.path, from, props.groupId)
  } catch {
    /* ignore malformed drags */
  }
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
  <section
    class="editor-pane"
    :class="{ focused: ide.activeGroupId.value === groupId }"
    @pointerdown.capture="ide.focusGroup(groupId)"
    @dragover="onDragOver"
    @drop.prevent="onDrop"
  >
    <div v-if="paneTabs.length" class="tabbar pane-tabbar">
      <div class="tab-scroll">
        <div
          v-for="tab in paneTabs"
          :key="tab.path"
          class="tab"
          :class="{ active: tab.path === activeTab?.path, dragging: dragPath === tab.path }"
          :title="tab.path"
          draggable="true"
          @click="select(tab)"
          @mousedown.middle.prevent="close(tab)"
          @dragstart="onDragStart($event, tab)"
          @dragend="dragPath = null"
        >
          <span v-if="tab.dirty" class="dot" />
          <FileCode2 v-else :size="13" style="opacity: 0.55" />
          <span class="name">{{ tab.name }}</span>
          <button class="close" title="Close" @click="close(tab, $event)">
            <X :size="12" />
          </button>
        </div>
      </div>
      <button
        class="pane-btn"
        :class="{ on: ide.splitOpen.value }"
        :title="ide.splitOpen.value ? 'Close split (Ctrl+\\)' : 'Split editor (Ctrl+\\)'"
        @click.stop="ide.toggleSplit()"
      >
        <Columns2 :size="14" />
      </button>
    </div>

    <template v-if="activeTab">
      <div class="breadcrumbs">
        <template v-for="(crumb, i) in crumbs" :key="`${crumb}-${i}`">
          <span v-if="i" class="sep">›</span>
          <span :class="{ last: i === crumbs.length - 1 }">{{ crumb }}</span>
        </template>
        <div style="flex: 1" />
        <span class="hint">{{ activeTab.language }}</span>
      </div>

      <div class="editor-host">
        <CodeEditor
          :key="activeTab.path"
          :tab="activeTab"
          :group-id="groupId"
          :goto-line="gotoLine"
          @change="onChange"
          @save="ide.saveTab()"
          @cursor="onCursor"
        />
      </div>
    </template>

    <div v-else class="pane-empty">
      <p>No file open in this pane.</p>
      <div class="pane-empty-actions">
        <button class="btn" @click="ide.palette.value = { mode: 'files' }">
          <FilePlus2 :size="14" /> Go to File
        </button>
        <button v-if="ide.splitOpen.value" class="btn" @click="ide.closeSplit()">
          Close split
        </button>
        <button v-else class="btn" @click="ide.splitEditor()">Split editor</button>
      </div>
    </div>
  </section>
</template>
