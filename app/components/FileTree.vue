<script setup lang="ts">
import {
  ChevronRight,
  File,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Image,
  MoreHorizontal
} from 'lucide-vue-next'
import type { Entry } from '../lib/types'
import { call, basename, dirname, relativeTo } from '../lib/api'

const props = defineProps<{ path: string; depth: number; root?: boolean }>()

const ide = useIde()
const git = useGit()
const treeVersion = useState<number>('kudo:tree-version', () => 0)
const entries = ref<Entry[]>([])
const open = ref<Record<string, boolean>>({})
const loading = ref(false)
const menu = ref<{ x: number; y: number; entry: Entry | null } | null>(null)

const selectedPath = computed(() => ide.activePath.value)

async function load() {
  loading.value = true
  try {
    entries.value = await call<Entry[]>('list_dir', { path: props.path })
  } catch (err) {
    ide.notify(String(err), 'error')
  } finally {
    loading.value = false
  }
}

function toggle(entry: Entry) {
  if (!entry.isDir) {
    ide.openFile(entry.path)
    return
  }
  open.value[entry.path] = !open.value[entry.path]
}

function relOf(entry: Entry) {
  return ide.workspace.value ? relativeTo(ide.workspace.value.path, entry.path) : entry.name
}

function iconFor(entry: Entry) {
  if (entry.isDir) return open.value[entry.path] ? FolderOpen : Folder
  const ext = entry.ext
  if (['ts', 'tsx', 'js', 'jsx', 'vue', 'rs', 'py', 'go', 'c', 'cpp', 'css', 'html', 'sh'].includes(ext))
    return FileCode2
  if (['json', 'yml', 'yaml', 'toml'].includes(ext)) return FileJson
  if (['md', 'txt', 'mdx'].includes(ext)) return FileText
  if (['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'ico'].includes(ext)) return Image
  return File
}

function openMenu(event: Event, entry: Entry) {
  event.preventDefault()
  const mouse = event as MouseEvent
  menu.value = { x: mouse.clientX, y: mouse.clientY, entry }
}

async function newFile(entry: Entry, isDir: boolean) {
  const base = entry.isDir ? entry.path : dirname(entry.path)
  const name = window.prompt(isDir ? 'New folder name' : 'New file name')
  if (!name) return
  try {
    await call('create_path', { path: `${base}\\${name}`, isDir })
    treeVersion.value++
    if (entry.isDir) open.value[entry.path] = true
    if (!isDir) await ide.openFile(`${base}\\${name}`)
  } catch (err) {
    ide.notify(String(err), 'error')
  }
  menu.value = null
}

async function rename(entry: Entry) {
  const name = window.prompt('Rename to', entry.name)
  if (!name || name === entry.name) return
  try {
    await call('rename_path', { from: entry.path, to: `${dirname(entry.path)}\\${name}` })
    treeVersion.value++
  } catch (err) {
    ide.notify(String(err), 'error')
  }
  menu.value = null
}

async function remove(entry: Entry) {
  menu.value = null
  if (!window.confirm(`Delete ${entry.name}? This cannot be undone.`)) return
  try {
    await call('delete_path', { path: entry.path })
    treeVersion.value++
    if (ide.activePath.value?.startsWith(entry.path)) ide.closeTab(entry.path)
  } catch (err) {
    ide.notify(String(err), 'error')
  }
}

async function reveal(entry: Entry) {
  menu.value = null
  await call('reveal_in_file_manager', { path: entry.path }).catch(() => {})
}

watch(treeVersion, load)
watch(() => props.path, load)
onMounted(load)
</script>

<template>
  <div>
    <div v-if="loading && !entries.length" class="tree-loading">loading…</div>
    <template v-for="entry in entries" :key="entry.path">
      <div
        class="tree-row"
        :class="{ selected: selectedPath === entry.path }"
        :style="{ paddingLeft: `${8 + depth * 12}px` }"
        @click="toggle(entry)"
        @contextmenu="openMenu($event, entry)"
      >
        <ChevronRight
          v-if="entry.isDir"
          class="chev"
          :class="{ open: open[entry.path] }"
          :size="12"
        />
        <span v-else style="width: 12px; flex: 0 0 12px" />
        <component
          :is="iconFor(entry)"
          class="file-icon"
          :class="entry.isDir ? 'folder' : entry.ext"
          :size="14"
          :stroke-width="1.7"
        />
        <span class="label">{{ entry.name }}</span>
        <span v-if="entry.isDir && entry.hidden" aria-hidden="true" />
        <span class="spacer" />
        <span
          v-if="git.markFor(relOf(entry))"
          class="git-mark"
          :class="`git-${git.markFor(relOf(entry))!.kind}`"
          :title="git.markFor(relOf(entry))!.kind"
        >
          {{ git.markFor(relOf(entry))!.letter }}
        </span>
        <button class="icon-btn" style="width: 18px; height: 18px" @click.stop="openMenu($event, entry)">
          <MoreHorizontal :size="13" />
        </button>
      </div>

      <FileTree
        v-if="entry.isDir && open[entry.path]"
        :path="entry.path"
        :depth="depth + 1"
      />
    </template>
    <div v-if="!loading && !entries.length && root" class="tree-empty">
      This folder is empty.
    </div>

    <Teleport to="body">
      <div
        v-if="menu"
        class="ctx"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @click.stop
      >
        <button v-if="menu.entry?.isDir" @click="newFile(menu.entry!, false)">New File</button>
        <button v-if="menu.entry?.isDir" @click="newFile(menu.entry!, true)">New Folder</button>
        <button @click="rename(menu.entry!)">Rename</button>
        <button @click="reveal(menu.entry!)">Reveal in Explorer</button>
        <div class="sep" />
        <button class="danger" @click="remove(menu.entry!)">Delete</button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.tree-row .icon-btn {
  opacity: 0;
}
.tree-row:hover .icon-btn {
  opacity: 1;
}
.tree-loading,
.tree-empty {
  padding: 6px 10px 6px 26px;
  color: var(--text-faint);
  font-size: 11.5px;
}
.ctx {
  position: fixed;
  z-index: 300;
  min-width: 190px;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  padding: 5px;
  box-shadow: var(--shadow-lg);
}
.ctx button {
  width: 100%;
  text-align: left;
  padding: 6px 9px;
  border: 0;
  background: transparent;
  color: var(--text-dim);
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}
.ctx button:hover {
  background: var(--glass-strong);
  color: var(--text);
}
.ctx .danger {
  color: #ff9b9e;
}
.ctx .sep {
  height: 1px;
  background: var(--border);
  margin: 4px 2px;
}
</style>
