<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { applyDesignOps } from './lib/designOps'
import { designBrief } from './lib/design'

const ide = useIde()
const git = useGit()
const chat = useChat()
const lsp = useLsp()
const debug = useDebug()
const tests = useTests()
const tasks = useTasks()
const format = useFormat()
const extensions = useExtensions()

// Overlays and heavy panes are split out of the entry bundle.
const CommandPalette = defineAsyncComponent(() => import('./components/CommandPalette.vue'))
const QuickOpen = defineAsyncComponent(() => import('./components/QuickOpen.vue'))
const RenameDialog = defineAsyncComponent(() => import('./components/RenameDialog.vue'))
const SymbolList = defineAsyncComponent(() => import('./components/SymbolList.vue'))
const CodeActionMenu = defineAsyncComponent(() => import('./components/CodeActionMenu.vue'))
const SettingsDialog = defineAsyncComponent(() => import('./components/SettingsDialog.vue'))
const BrowserOverlay = defineAsyncComponent(() => import('./components/BrowserOverlay.vue'))
const BoardOverlay = defineAsyncComponent(() => import('./components/BoardOverlay.vue'))
const DesignOverlay = defineAsyncComponent(() => import('./components/DesignOverlay.vue'))
const board = useBoard()
const design = useDesign()
const sidebarWidth = useLayoutSize('sidebar-width', 268, 200, 520)
const chatWidth = useLayoutSize('chat-width', 384, 300, 720)
const booting = ref(true)

// The design canvas and the whiteboard are both full-screen surfaces; keep at
// most one open so their keyboard handlers never fight.
watch(
  () => design.open.value,
  (open) => {
    if (open) board.hide()
  }
)
watch(
  () => board.open.value,
  (open) => {
    if (open) design.hide()
  }
)

useKeybindings()

// Dev-only bridge so E2E sessions can switch folders through the same code
// path as the File menu (the native picker cannot be driven from CDP).
if (import.meta.dev && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__kodraOpenFolder = (path: string) =>
    ide.openFolder(path)
  ;(window as unknown as Record<string, unknown>).__kodraDesign = {
    doc: design.doc,
    sync: design.sync,
    revision: design.revision,
    brief: () => designBrief(design.doc.value),
    spec: () => design.copySpec(),
    apply: (operations: unknown) => {
      design.checkpoint()
      design.markAgent()
      const result = applyDesignOps(design.doc.value, operations)
      if (result.changed) design.persistNow()
      return result
    }
  }
}

function dragWidth(event: PointerEvent, kind: 'sidebar' | 'chat') {
  event.preventDefault()
  const state = kind === 'sidebar' ? sidebarWidth : chatWidth
  const startX = event.clientX
  const startWidth = state.value
  const min = kind === 'sidebar' ? 200 : 300
  const max = kind === 'sidebar' ? 520 : 720

  const move = (e: PointerEvent) => {
    const delta = kind === 'sidebar' ? e.clientX - startX : startX - e.clientX
    state.value = Math.min(max, Math.max(min, startWidth + delta))
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
  }
  document.body.style.cursor = 'col-resize'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

onMounted(async () => {
  ide.applyTheme()
  await ide.init()
  design.init()
  await extensions.ensureLoaded()
  chat.load()
  void lsp.detect()
  void lsp.listen()
  void debug.init()
  void tests.init()
  void tasks.init()
  void format.detect()
  await git.refresh()
  booting.value = false
})

watch(
  () => ide.workspace.value?.path,
  async () => {
    lsp.reset()
    debug.reset()
    debug.loadWorkspaceState()
    debug.suggestConfig()
    tests.reset()
    if (ide.workspace.value) void tests.detect()
    tasks.reset()
    if (ide.workspace.value) void tasks.detect()
    format.reset()
    if (ide.workspace.value) void format.detect()
    chat.load()
    design.init()
    await git.refresh()
  }
)

useHead({ title: () => (ide.workspace.value ? `${ide.workspace.value.name} — Kodra` : 'Kodra') })
</script>

<template>
  <div
    class="app-shell"
    :style="{ '--sidebar-w': `${sidebarWidth}px`, '--chat-w': `${chatWidth}px` }"
  >
    <TitleBar />

    <div class="workspace-body">
      <ActivityBar />

      <SideBar />

      <div
        v-if="ide.sidebarVisible.value"
        class="resizer-v"
        title="Resize sidebar"
        @pointerdown="dragWidth($event, 'sidebar')"
      />

      <EditorArea />

      <div
        v-if="ide.chatOpen.value"
        class="resizer-v"
        title="Resize agent panel"
        @pointerdown="dragWidth($event, 'chat')"
      />

      <ChatPanel />
    </div>

    <StatusBar />
  </div>

  <CommandPalette />
  <QuickOpen />
  <RenameDialog />
  <SymbolList />
  <CodeActionMenu />
  <SettingsDialog />
  <BrowserOverlay />
  <BoardOverlay v-if="board.open.value" />
  <DesignOverlay v-if="design.open.value" />
  <ToastHost />

  <div v-if="booting" class="boot-splash">
    <div class="brand-mark" style="width: 34px; height: 34px; font-size: 16px">K</div>
    <span>Starting Kodra…</span>
  </div>
</template>

<style>
.boot-splash {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: color-mix(in srgb, var(--canvas) 88%, transparent);
  backdrop-filter: blur(18px);
  color: var(--text-faint);
  font-size: 12px;
  letter-spacing: 0.01em;
  z-index: 500;
  animation: boot-fade 0.25s ease-out;
}
@keyframes boot-fade {
  from {
    opacity: 0;
  }
}
</style>
