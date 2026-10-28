<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Ban,
  Blocks,
  FolderOpen,
  Loader2,
  Palette,
  Power,
  RefreshCw,
  ScrollText,
  Trash2
} from 'lucide-vue-next'
import { pickExtensionFolder } from '../lib/api'
import type { ExtensionInfo } from '../lib/types'
import { normalizeSnippet, normalizeTheme } from '../lib/themes'

const ide = useIde()
const extensions = useExtensions()
const busy = ref<string | null>(null)

const sorted = computed(() => extensions.list.value)

function themeNames(extension: ExtensionInfo) {
  return extension.themes
    .map((raw) => normalizeTheme(raw, extension.folder)?.name ?? '')
    .filter(Boolean)
}

function snippetLabels(extension: ExtensionInfo) {
  return extension.snippets
    .map((raw) => normalizeSnippet(raw, extension.name)?.prefix ?? '')
    .filter(Boolean)
}

async function install() {
  const path = await pickExtensionFolder()
  if (!path) return
  busy.value = 'install'
  try {
    await extensions.install(path)
  } catch (err) {
    ide.notify(String(err), 'error')
  } finally {
    busy.value = null
  }
}

async function toggle(extension: ExtensionInfo) {
  busy.value = extension.folder
  try {
    await extensions.setEnabled(extension.folder, !extension.enabled)
  } catch (err) {
    ide.notify(String(err), 'error')
  } finally {
    busy.value = null
  }
}

async function remove(extension: ExtensionInfo) {
  if (!window.confirm(`Remove ${extension.name}? The folder is deleted from disk.`)) return
  busy.value = extension.folder
  try {
    await extensions.remove(extension.folder)
  } catch (err) {
    ide.notify(String(err), 'error')
  } finally {
    busy.value = null
  }
}

onMounted(() => {
  if (!extensions.list.value.length) extensions.load()
})
</script>

<template>
  <div class="pane">
    <div class="sidebar-header">
      <span class="sidebar-title">Extensions</span>
      <div class="sidebar-actions">
        <button class="icon-btn" title="Reload extensions" @click="extensions.load()">
          <RefreshCw :size="13" />
        </button>
        <button class="icon-btn" title="Install from folder" :disabled="busy === 'install'" @click="install">
          <Loader2 v-if="busy === 'install'" :size="13" class="spin" />
          <FolderOpen v-else :size="14" />
        </button>
      </div>
    </div>

    <div class="sidebar-body">
      <p v-if="extensions.error.value" class="ext-error">{{ extensions.error.value }}</p>

      <div v-if="!sorted.length && !extensions.loading.value" class="ext-empty">
        <Blocks :size="24" :stroke-width="1.4" style="opacity: 0.4" />
        <p>No extensions installed.</p>
        <span class="hint" style="text-align: center">
          Install a folder with an <code>extension.json</code> manifest to add colour themes and
          snippets. Extensions never run code.
        </span>
        <button class="btn sm" @click="install">
          <FolderOpen :size="12" /> Install from folder
        </button>
      </div>

      <div v-for="extension in sorted" :key="extension.folder" class="ext-card" :class="{ off: !extension.enabled }">
        <div class="ext-head">
          <div class="col">
            <span class="ext-name">{{ extension.name }}</span>
            <span class="ext-meta">
              <template v-if="extension.version">v{{ extension.version }}</template>
              <template v-if="extension.version && extension.author"> · </template>
              <template v-if="extension.author">{{ extension.author }}</template>
              <template v-if="!extension.version && !extension.author">{{ extension.folder }}</template>
            </span>
          </div>
          <button
            class="icon-btn"
            :title="extension.enabled ? 'Disable extension' : 'Enable extension'"
            :disabled="busy === extension.folder || !!extension.error"
            @click="toggle(extension)"
          >
            <Power :size="12" :style="extension.enabled ? 'color: var(--green)' : 'color: var(--text-faint)'" />
          </button>
          <button
            class="icon-btn"
            title="Remove extension"
            :disabled="busy === extension.folder"
            @click="remove(extension)"
          >
            <Trash2 :size="12" />
          </button>
        </div>

        <p v-if="extension.description" class="ext-desc">{{ extension.description }}</p>

        <p v-if="extension.error" class="ext-problem">
          <Ban :size="11" /> {{ extension.error }}
        </p>

        <div class="ext-tags">
          <span class="ext-tag">
            <Palette :size="10" />
            {{ themeNames(extension).length }}
            {{ themeNames(extension).length === 1 ? 'theme' : 'themes' }}
          </span>
          <span class="ext-tag">
            <ScrollText :size="10" />
            {{ snippetLabels(extension).length }}
            {{ snippetLabels(extension).length === 1 ? 'snippet' : 'snippets' }}
          </span>
          <span v-if="!extension.enabled" class="ext-tag off">disabled</span>
        </div>

        <ul v-if="themeNames(extension).length || snippetLabels(extension).length" class="ext-contrib">
          <li v-for="name in themeNames(extension)" :key="`t-${name}`">
            <Palette :size="10" /> {{ name }}
          </li>
          <li v-for="prefix in snippetLabels(extension)" :key="`s-${prefix}`">
            <ScrollText :size="10" /> {{ prefix }}
          </li>
        </ul>

        <span class="ext-path" :title="extension.path">{{ extension.path }}</span>
      </div>

      <p v-if="extensions.directory.value" class="ext-dir">
        Extensions live in <code>{{ extensions.directory.value }}</code>
      </p>
    </div>
  </div>
</template>

<style scoped>
.ext-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 26px 14px;
  color: var(--text-muted);
  font-size: 12px;
}
.ext-empty p {
  margin: 0;
}
.ext-error {
  margin: 0 0 8px;
  padding: 7px 9px;
  border: 1px solid var(--red);
  border-radius: 6px;
  color: var(--red);
  font-size: 11px;
}
.ext-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px;
  margin-bottom: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.ext-card.off {
  opacity: 0.62;
}
.ext-head {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}
.ext-head .col {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.ext-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ext-meta {
  font-size: 10px;
  color: var(--text-faint);
}
.ext-desc {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.45;
}
.ext-problem {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  font-size: 10.5px;
  color: var(--red);
}
.ext-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.ext-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--glass);
  color: var(--text-muted);
  font-size: 9.5px;
}
.ext-tag.off {
  color: var(--orange);
}
.ext-contrib {
  list-style: none;
  margin: 0;
  padding: 4px 0 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-top: 1px solid var(--border);
}
.ext-contrib li {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-dim);
}
.ext-contrib li svg {
  color: var(--accent);
  flex: 0 0 auto;
}
.ext-path {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ext-dir {
  margin: 12px 2px 0;
  font-size: 9.5px;
  color: var(--text-faint);
  line-height: 1.5;
  word-break: break-all;
}
.ext-dir code {
  font-family: var(--font-mono);
}
</style>
