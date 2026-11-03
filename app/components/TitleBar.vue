<script setup lang="ts">
import { Minus, Square, X, PanelLeft, PanelBottom, MessagesSquare } from 'lucide-vue-next'
import { isTauri } from '../lib/api'

const ide = useIde()
const chat = useChat()
const menu = ref<string | null>(null)

interface MenuItem {
  label: string
  hint?: string
  run: () => unknown
}

const menus: { label: string; items: MenuItem[] }[] = [
  {
    label: 'File',
    items: [
      { label: 'Open Folder…', hint: 'Ctrl+K O', run: () => ide.openFolder() },
      { label: 'Close Workspace', run: () => ide.closeWorkspace() },
      { label: 'Save', hint: 'Ctrl+S', run: () => ide.saveTab() },
      { label: 'Settings', hint: 'Ctrl+,', run: () => (ide.settingsOpen.value = true) }
    ]
  },
  {
    label: 'View',
    items: [
      { label: 'Toggle Sidebar', hint: 'Ctrl+B', run: () => ide.toggleSidebar() },
      { label: 'Toggle Terminal', hint: 'Ctrl+`', run: () => ide.togglePanel('terminal') },
      { label: 'Toggle Agent', hint: 'Ctrl+Shift+A', run: () => ide.toggleChat() },
      { label: 'Command Palette', hint: 'Ctrl+Shift+P', run: () => (ide.palette.value = { mode: 'commands' }) }
    ]
  },
  {
    label: 'Help',
    items: [
      { label: 'Documentation', run: () => window.open('https://tauri.app', '_blank') },
      { label: 'About Kodra', run: () => (ide.settingsOpen.value = true) }
    ]
  }
]

function toggleMenu(label: string) {
  menu.value = menu.value === label ? null : label
}

async function win(action: 'min' | 'max' | 'close') {
  if (!isTauri()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const w = getCurrentWindow()
  if (action === 'min') await w.minimize()
  else if (action === 'max') await w.toggleMaximize()
  else await w.close()
}

onMounted(() => {
  const close = () => (menu.value = null)
  window.addEventListener('click', close)
  onBeforeUnmount(() => window.removeEventListener('click', close))
})
</script>

<template>
  <header class="titlebar" data-tauri-drag-region>
    <div class="brand" data-tauri-drag-region>
      <div class="brand-mark">K</div>
      <span class="brand-name">Kodra</span>
    </div>

    <div class="tb-menu">
      <div v-for="m in menus" :key="m.label" style="position: relative">
        <button @click.stop="toggleMenu(m.label)">{{ m.label }}</button>
        <div v-if="menu === m.label" class="menu-pop" @click.stop>
          <button
            v-for="item in m.items"
            :key="item.label"
            class="menu-item"
            @click="
              item.run();
              menu = null
            "
          >
            <span>{{ item.label }}</span>
            <kbd v-if="item.hint">{{ item.hint }}</kbd>
          </button>
        </div>
      </div>
    </div>

    <div class="tb-center" data-tauri-drag-region>
      <div class="tb-title">{{ ide.workspace.value?.name ?? 'No folder opened' }}</div>
      <span v-if="ide.workspace.value?.isGit" class="tb-chip">
        <span class="dot-live" style="width: 5px; height: 5px" />
        {{ ide.workspace.value?.branch ?? 'detached' }}
      </span>
      <span v-if="chat.busy.value" class="tb-chip">agent working…</span>
    </div>

    <div class="tb-group">
      <button class="icon-btn" title="Toggle sidebar" @click="ide.toggleSidebar()">
        <PanelLeft :size="15" />
      </button>
      <button class="icon-btn" title="Toggle terminal" @click="ide.togglePanel('terminal')">
        <PanelBottom :size="15" />
      </button>
      <button
        class="icon-btn"
        :style="ide.chatOpen.value ? 'color:var(--accent);background:var(--accent-soft)' : ''"
        title="Toggle agent"
        @click="ide.toggleChat()"
      >
        <MessagesSquare :size="15" />
      </button>
    </div>

    <div class="win-controls">
      <button class="win-btn" title="Minimize" @click="win('min')"><Minus :size="14" /></button>
      <button class="win-btn" title="Maximize" @click="win('max')"><Square :size="12" /></button>
      <button class="win-btn close" title="Close" @click="win('close')"><X :size="14" /></button>
    </div>
  </header>
</template>

<style scoped>
.menu-pop {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  min-width: 234px;
  background-color: var(--layer-solid);
  background-image: var(--sheen-soft);
  backdrop-filter: blur(28px) saturate(165%);
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-md);
  padding: 5px;
  box-shadow: var(--rim-top), var(--shadow-pop);
  z-index: 60;
  animation: menu-in 140ms var(--ease-out);
}
@keyframes menu-in {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.985);
  }
}
.menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 7px 9px;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.menu-item:hover {
  background: var(--fill-2);
  color: var(--text);
}
</style>
