<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Box,
  Container,
  Play,
  RefreshCw,
  ScrollText,
  Square,
  Trash2,
  X
} from 'lucide-vue-next'
import type { DockerContainer, DockerInfo } from '../lib/types'
import { call } from '../lib/api'

const ide = useIde()

const info = ref<DockerInfo | null>(null)
const containers = ref<DockerContainer[]>([])
const images = ref<Record<string, unknown>[]>([])
const tab = ref<'containers' | 'images'>('containers')
const loading = ref(false)
const error = ref('')
const logs = ref<{ name: string; text: string } | null>(null)
const busyId = ref('')

const running = computed(
  () => containers.value.filter((c) => String(c.State).toLowerCase() === 'running').length
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    info.value = await call<DockerInfo>('docker_info')
    if (!info.value.available) {
      containers.value = []
      images.value = []
      return
    }
    containers.value = await call<DockerContainer[]>('docker_containers', { all: true })
    images.value = await call<Record<string, unknown>[]>('docker_images')
  } catch (err) {
    error.value = String(err)
  } finally {
    loading.value = false
  }
}

async function action(id: string, verb: 'start' | 'stop' | 'restart' | 'rm') {
  busyId.value = id
  try {
    await call('docker_action', { id, action: verb })
    await load()
  } catch (err) {
    ide.notify(String(err), 'error')
  } finally {
    busyId.value = ''
  }
}

async function showLogs(container: DockerContainer) {
  try {
    const result = await call<{ id: string; text: string }>('docker_logs', {
      id: container.ID,
      tail: 500
    })
    logs.value = { name: String(container.Names ?? container.ID), text: result.text || '(no output)' }
  } catch (err) {
    ide.notify(String(err), 'error')
  }
}

async function runImage(image: Record<string, unknown>) {
  const name = window.prompt(
    `Container name for ${image.Repository}:${image.Tag}`,
    `${image.Repository}-dev`
  )
  if (name === null) return
  const ports = window.prompt('Port mapping (host:container), blank for none', '') ?? ''
  try {
    await call('docker_run_image', {
      image: `${image.Repository}:${image.Tag}`,
      name,
      ports: ports ? [ports] : []
    })
    ide.notify('Container started', 'success')
    await load()
  } catch (err) {
    ide.notify(String(err), 'error')
  }
}

onMounted(load)
</script>

<template>
  <div class="pane">
    <div class="sidebar-header">
      <span class="sidebar-title">Docker</span>
      <div class="sidebar-actions">
        <button class="icon-btn" title="Refresh" @click="load">
          <RefreshCw :size="13" :class="{ spin: loading }" />
        </button>
      </div>
    </div>

    <div class="sidebar-body">
      <div v-if="error" class="docker-error">{{ error }}</div>

      <div v-else-if="info && !info.available" class="docker-empty">
        <Container :size="24" :stroke-width="1.4" style="opacity: 0.4" />
        <p>Docker isn’t reachable.</p>
        <span class="hint" style="text-align: center">
          Install Docker Desktop or make sure the daemon is running, then refresh.
        </span>
        <code class="hint">{{ info.error }}</code>
      </div>

      <template v-else>
        <div class="docker-tabs">
          <button :class="{ active: tab === 'containers' }" @click="tab = 'containers'">
            Containers <span class="count">{{ containers.length }}</span>
          </button>
          <button :class="{ active: tab === 'images' }" @click="tab = 'images'">
            Images <span class="count">{{ images.length }}</span>
          </button>
        </div>

        <div v-if="tab === 'containers'">
          <div v-if="!containers.length" class="hint" style="padding: 12px 8px">
            No containers. Run an image from the Images tab.
          </div>
          <div v-for="container in containers" :key="String(container.ID)" class="container-row">
            <div class="c-head">
              <span
                class="state-dot"
                :class="String(container.State).toLowerCase() === 'running' ? 'on' : 'off'"
              />
              <span class="c-name">{{ container.Names }}</span>
              <span class="c-state">{{ container.State }}</span>
            </div>
            <div class="c-meta">
              <span class="c-image">{{ container.Image }}</span>
              <span v-if="container.Ports" class="c-ports">{{ container.Ports }}</span>
            </div>
            <div class="c-status">{{ container.Status }}</div>
            <div class="c-actions">
              <button
                v-if="String(container.State).toLowerCase() === 'running'"
                class="icon-btn"
                title="Stop"
                :disabled="busyId === String(container.ID)"
                @click="action(String(container.ID), 'stop')"
              >
                <Square :size="11" />
              </button>
              <button
                v-else
                class="icon-btn"
                title="Start"
                :disabled="busyId === String(container.ID)"
                @click="action(String(container.ID), 'start')"
              >
                <Play :size="11" />
              </button>
              <button class="icon-btn" title="Logs" @click="showLogs(container)">
                <ScrollText :size="11" />
              </button>
              <button
                class="icon-btn"
                title="Remove"
                :disabled="busyId === String(container.ID)"
                @click="action(String(container.ID), 'rm')"
              >
                <Trash2 :size="11" />
              </button>
            </div>
          </div>
          <div v-if="containers.length" class="hint" style="padding: 8px">
            {{ running }} of {{ containers.length }} running · engine {{ info?.version }}
          </div>
        </div>

        <div v-else>
          <div v-for="image in images" :key="`${image.Repository}:${image.Tag}`" class="image-row">
            <Box :size="13" style="color: var(--text-faint)" />
            <div class="col">
              <span class="name">{{ image.Repository }}:{{ image.Tag }}</span>
              <span class="meta">{{ image.ID }} · {{ image.Size }}</span>
            </div>
            <button class="icon-btn" title="Run container" @click="runImage(image)">
              <Play :size="11" />
            </button>
          </div>
          <div v-if="!images.length" class="hint" style="padding: 12px 8px">No local images.</div>
        </div>
      </template>
    </div>

    <Teleport to="body">
      <div v-if="logs" class="overlay" @click.self="logs = null">
        <div class="modal" style="width: min(840px, 94vw); max-height: 84vh">
          <div class="modal-head">
            <ScrollText :size="15" />
            <h2>{{ logs.name }}</h2>
            <span class="hint">last 500 lines</span>
            <div style="flex: 1" />
            <button class="icon-btn" @click="logs = null"><X :size="15" /></button>
          </div>
          <pre class="logs">{{ logs.text }}</pre>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.docker-tabs {
  display: flex;
  gap: 3px;
  padding: 3px;
  margin: 2px 0 6px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-2);
}
.docker-tabs button {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 25px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font-size: 10.5px;
  cursor: pointer;
}
.docker-tabs button.active {
  background: var(--glass-strong);
  color: var(--text);
}
.count {
  font-size: 9px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--glass);
  color: var(--text-faint);
}
.docker-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 34px 14px;
  color: var(--text-faint);
  font-size: 12px;
  text-align: center;
}
.docker-empty p {
  margin: 0;
}
.docker-error {
  padding: 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--red) 10%, transparent);
  color: var(--red);
  font-size: 10.5px;
}
.container-row {
  padding: 7px 8px;
  border-bottom: 1px solid var(--border);
}
.c-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.state-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--text-faint);
}
.state-dot.on {
  background: var(--green);
  box-shadow: 0 0 6px color-mix(in srgb, var(--green) 60%, transparent);
}
.c-name {
  flex: 1;
  font-size: 11.5px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.c-state {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-faint);
}
.c-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-left: 12px;
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-faint);
}
.c-ports {
  color: var(--accent);
  opacity: 0.8;
}
.c-status {
  padding-left: 12px;
  font-size: 9px;
  color: var(--text-faint);
  margin-top: 2px;
}
.c-actions {
  display: flex;
  gap: 2px;
  padding-left: 8px;
  margin-top: 3px;
}
.image-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
.image-row .col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.image-row .name {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-dim);
}
.image-row .meta {
  font-size: 9px;
  color: var(--text-faint);
}
.logs {
  flex: 1;
  margin: 0;
  padding: 12px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 10.5px;
  line-height: 1.55;
  color: var(--text-dim);
  white-space: pre-wrap;
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
