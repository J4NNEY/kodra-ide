<script setup lang="ts">
import { FilePlus2, FolderPlus, RefreshCw, ChevronsDownUp, FolderOpen } from 'lucide-vue-next'
import { call } from '../lib/api'

const ide = useIde()
const treeVersion = useState<number>('kudo:tree-version', () => 0)
const collapsing = ref(false)

async function create(isDir: boolean) {
  if (!ide.workspace.value) return
  const name = window.prompt(isDir ? 'New folder name' : 'New file name')
  if (!name) return
  try {
    const path = `${ide.workspace.value.path}\\${name}`
    await call('create_path', { path, isDir })
    treeVersion.value++
    if (!isDir) await ide.openFile(path)
  } catch (err) {
    ide.notify(String(err), 'error')
  }
}

function refresh() {
  treeVersion.value++
  useGit().refresh()
}
</script>

<template>
  <div class="pane">
    <div class="sidebar-header">
      <span class="sidebar-title">Explorer</span>
      <div class="sidebar-actions">
        <button class="icon-btn" title="New file" @click="create(false)">
          <FilePlus2 :size="14" />
        </button>
        <button class="icon-btn" title="New folder" @click="create(true)">
          <FolderPlus :size="14" />
        </button>
        <button class="icon-btn" title="Refresh" @click="refresh">
          <RefreshCw :size="13" :class="{ spin: collapsing }" />
        </button>
      </div>
    </div>

    <div class="sidebar-body">
      <div v-if="!ide.workspace.value" class="pane-empty">
        <FolderOpen :size="22" />
        <p>No folder is open.</p>
        <button class="btn primary sm" @click="ide.openFolder()">Open Folder</button>
      </div>

      <template v-else>
        <button class="ws-head" @click="treeVersion++">
          <ChevronsDownUp :size="13" />
          <span>{{ ide.workspace.value.name }}</span>
        </button>
        <FileTree :path="ide.workspace.value.path" :depth="0" root />
      </template>
    </div>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.pane-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 28px 12px;
  color: var(--text-faint);
  text-align: center;
  font-size: 12px;
}
.pane-empty p {
  margin: 0;
}
.ws-head {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 5px 8px;
  margin-bottom: 2px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
}
.ws-head:hover {
  background: var(--glass);
  color: var(--text);
}
.spin {
  animation: spin 0.6s linear;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
