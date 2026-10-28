<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref, watch } from 'vue'

const ide = useIde()
const git = useGit()
const chat = useChat()
const lsp = useLsp()
const extensions = useExtensions()

// Overlays and heavy panes are split out of the entry bundle.
const CommandPalette = defineAsyncComponent(() => import('./components/CommandPalette.vue'))
const QuickOpen = defineAsyncComponent(() => import('./components/QuickOpen.vue'))
const SettingsDialog = defineAsyncComponent(() => import('./components/SettingsDialog.vue'))
const BrowserOverlay = defineAsyncComponent(() => import('./components/BrowserOverlay.vue'))
const sidebarWidth = useLayoutSize('sidebar-width', 268, 200, 520)
const chatWidth = useLayoutSize('chat-width', 384, 300, 720)
const booting = ref(true)

useKeybindings()

// Dev-only bridge so E2E sessions can switch folders through the same code
// path as the File menu (the native picker cannot be driven from CDP).
if (import.meta.dev && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__kudoOpenFolder = (path: string) =>
    ide.openFolder(path)
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
  await extensions.ensureLoaded()
  chat.load()
  void lsp.detect()
  void lsp.listen()
  await git.refresh()
  booting.value = false
})

watch(
  () => ide.workspace.value?.path,
  async () => {
    lsp.reset()
    chat.load()
    await git.refresh()
  }
)

useHead({ title: () => (ide.workspace.value ? `${ide.workspace.value.name} — Kudo` : 'Kudo') })
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
  <SettingsDialog />
  <BrowserOverlay />
  <ToastHost />

  <div v-if="booting" class="boot-splash">
    <div class="brand-mark" style="width: 34px; height: 34px; font-size: 16px">K</div>
    <span>Starting Kudo…</span>
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
  background: var(--canvas);
  color: var(--text-faint);
  font-size: 12px;
  z-index: 500;
  animation: boot-fade 0.25s ease-out;
}
@keyframes boot-fade {
  from {
    opacity: 0;
  }
}
</style>
