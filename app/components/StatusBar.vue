<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  AlertCircle,
  Bot,
  CircleCheck,
  GitBranch,
  Lock,
  RefreshCw,
  TerminalSquare
} from 'lucide-vue-next'
import { call, isTauri } from '../lib/api'

const ide = useIde()
const git = useGit()
const lsp = useLsp()
const cursor = useState('kudo:cursor', () => ({ line: 1, column: 1, selected: 0 }))
const info = useState<{ name: string; version: string; platform: string } | null>(
  'kudo:app-info',
  () => null
)
const syncing = ref(false)

const language = computed(() => {
  const tab = ide.activeTab.value
  if (!tab) return 'Plain Text'
  const map: Record<string, string> = {
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    json: 'JSON',
    markdown: 'Markdown',
    css: 'CSS',
    html: 'HTML',
    python: 'Python',
    rust: 'Rust',
    toml: 'TOML',
    yaml: 'YAML',
    shell: 'Shell',
    powershell: 'PowerShell',
    sql: 'SQL',
    plaintext: 'Plain Text'
  }
  return map[tab.language] ?? tab.language
})

const dirtyCount = computed(() => ide.tabs.value.filter((t) => t.dirty).length)

async function sync() {
  if (!ide.workspace.value?.isGit || syncing.value) return
  syncing.value = true
  try {
    await git.fetch()
    ide.notify('Fetched from remote', 'success')
  } catch (err) {
    ide.notify(String(err), 'error')
  } finally {
    syncing.value = false
  }
}

onMounted(async () => {
  try {
    info.value = await call('app_info')
  } catch {
    info.value = { name: 'Kudo', version: '0.3.0', platform: 'browser' }
  }
})
</script>

<template>
  <footer class="statusbar">
    <button
      v-if="ide.workspace.value?.isGit"
      class="status-item clickable"
      title="Source control"
      @click="ide.sidebarView.value = 'git'; ide.sidebarVisible.value = true"
    >
      <GitBranch :size="12" />
      {{ git.status.value?.branch ?? ide.workspace.value?.branch ?? 'HEAD' }}
      <span v-if="git.status.value?.upstream" class="sync">
        ↑{{ git.status.value?.ahead }} ↓{{ git.status.value?.behind }}
      </span>
    </button>

    <button
      v-if="ide.workspace.value?.isGit"
      class="status-item clickable"
      title="Fetch"
      @click="sync"
    >
      <RefreshCw :size="11" :class="{ spin: syncing }" />
    </button>

    <span v-if="dirtyCount" class="status-item" title="Unsaved editors">
      <span class="dirty-dot" /> {{ dirtyCount }} unsaved
    </span>

    <span class="spacer" />

    <button class="status-item clickable" title="Problems" @click="ide.togglePanel('problems')">
      <CircleCheck :size="12" style="color: var(--green)" />
      {{ lsp.errorCount.value }}
      <AlertCircle :size="12" style="color: var(--text-faint); margin-left: 4px" />
      {{ lsp.warningCount.value }}
    </button>

    <span v-if="git.status.value?.files.length" class="status-item" title="Changed files">
      {{ git.status.value.files.length }} changes
    </span>

    <span v-if="ide.activeTab.value" class="status-item" title="Cursor position">
      Ln {{ cursor.line }}, Col {{ cursor.column }}
      <span v-if="cursor.selected" class="sel">({{ cursor.selected }} sel)</span>
    </span>

    <span v-if="ide.activeTab.value" class="status-item">{{ language }}</span>
    <span class="status-item">UTF-8</span>
    <span v-if="ide.activeTab.value" class="status-item">LF</span>

    <button class="status-item clickable" title="Terminal" @click="ide.togglePanel('terminal')">
      <TerminalSquare :size="12" />
    </button>

    <button
      class="status-item clickable"
      title="Agent settings"
      @click="ide.chatOpen.value = true"
    >
      <Bot :size="12" style="color: var(--accent)" />
      {{ ide.settings.value.ai.model }}
      <Lock v-if="!isTauri()" :size="10" style="opacity: 0.6" />
    </button>

    <span class="status-item" :title="isTauri() ? info?.platform : 'browser mock'">
      <span class="dot-live" :style="isTauri() ? '' : 'background: var(--orange); box-shadow: none'" />
      {{ info?.name ?? 'Kudo' }} {{ info?.version ?? '0.3.0' }}
    </span>
  </footer>
</template>

<style scoped>
.sync {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-faint);
}
.sel {
  color: var(--text-faint);
}
.dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
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
