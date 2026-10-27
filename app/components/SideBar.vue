<script setup lang="ts">
import { defineAsyncComponent } from 'vue'

const ide = useIde()

const DatabasePane = defineAsyncComponent(() => import('./DatabasePane.vue'))
const SkillsPane = defineAsyncComponent(() => import('./SkillsPane.vue'))
const DockerPane = defineAsyncComponent(() => import('./DockerPane.vue'))
const McpPane = defineAsyncComponent(() => import('./McpPane.vue'))
</script>

<template>
  <aside class="sidebar" :class="{ collapsed: !ide.sidebarVisible.value }">
    <ExplorerPane v-if="ide.sidebarView.value === 'explorer'" />
    <SearchPane v-else-if="ide.sidebarView.value === 'search'" />
    <GitPane v-else-if="ide.sidebarView.value === 'git'" />
    <AgentPane v-else-if="ide.sidebarView.value === 'agent'" />
    <DatabasePane v-else-if="ide.sidebarView.value === 'database'" />
    <SkillsPane v-else-if="ide.sidebarView.value === 'skills'" />
    <DockerPane v-else-if="ide.sidebarView.value === 'docker'" />
    <McpPane v-else-if="ide.sidebarView.value === 'mcp'" />
  </aside>
</template>
