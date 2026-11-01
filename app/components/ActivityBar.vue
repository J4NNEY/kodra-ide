<script setup lang="ts">
import {
  Files,
  Search,
  GitBranch,
  Bug,
  FlaskConical,
  ListChecks,
  Bot,
  Database,
  Settings2,
  Sparkles,
  Container,
  Globe,
  Blocks,
  Puzzle
} from 'lucide-vue-next'
import type { SidebarView } from '../lib/types'

const ide = useIde()
const browser = useBrowser()
const gitCount = useState<number>('kudo:git-count', () => 0)

const items: { id: SidebarView; icon: any; label: string; badge?: boolean }[] = [
  { id: 'explorer', icon: Files, label: 'Explorer' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'git', icon: GitBranch, label: 'Source Control', badge: true },
  { id: 'debug', icon: Bug, label: 'Run and Debug' },
  { id: 'tests', icon: FlaskConical, label: 'Tests' },
  { id: 'tasks', icon: ListChecks, label: 'Tasks' },
  { id: 'agent', icon: Bot, label: 'Agent' }
]

const tools: { id: SidebarView; icon: any; label: string }[] = [
  { id: 'database', icon: Database, label: 'Database' },
  { id: 'skills', icon: Sparkles, label: 'Skills' },
  { id: 'mcp', icon: Blocks, label: 'MCP servers' },
  { id: 'extensions', icon: Puzzle, label: 'Extensions' },
  { id: 'docker', icon: Container, label: 'Docker' }
]

function select(id: SidebarView) {
  if (id === 'agent') {
    ide.sidebarView.value = 'agent'
    ide.sidebarVisible.value = true
    return
  }
  ide.toggleSidebar(id)
}
</script>

<template>
  <nav class="activitybar">
    <button
      v-for="item in items"
      :key="item.id"
      class="act-btn"
      :class="{ active: ide.sidebarVisible.value && ide.sidebarView.value === item.id }"
      :title="item.label"
      @click="select(item.id)"
    >
      <component :is="item.icon" :size="19" :stroke-width="1.7" />
      <span v-if="item.badge && gitCount > 0" class="act-badge">{{ gitCount }}</span>
    </button>

    <div class="act-sep" />

    <button
      v-for="tool in tools"
      :key="tool.id"
      class="act-btn"
      :class="{ active: ide.sidebarVisible.value && ide.sidebarView.value === tool.id }"
      :title="tool.label"
      @click="select(tool.id)"
    >
      <component :is="tool.icon" :size="19" :stroke-width="1.7" />
    </button>

    <button class="act-btn" title="Browser preview" @click="browser.show()">
      <Globe :size="19" :stroke-width="1.7" />
    </button>

    <div class="act-spacer" />

    <button class="act-btn" title="Settings" @click="ide.settingsOpen.value = true">
      <Settings2 :size="19" :stroke-width="1.7" />
    </button>
  </nav>
</template>

<style scoped>
.act-sep {
  height: 1px;
  margin: 6px 10px;
  background: var(--border);
}
</style>
