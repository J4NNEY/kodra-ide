<script setup lang="ts">
import { computed } from 'vue'
import {
  Circle,
  CircleCheck,
  CircleStop,
  CircleX,
  Hammer,
  Loader2,
  Play,
  RefreshCw
} from 'lucide-vue-next'
import type { TaskDef, TaskStatus } from '../composables/useTasks'
import { call } from '../lib/api'

const ide = useIde()
const tasks = useTasks()

const missingTools = computed(() => {
  const found = tasks.toolchain.value
  const missing: string[] = []
  if (tasks.tasks.value.some((task) => task.source === 'package') && !found.npm && !found.pnpm && !found.yarn && !found.bun) {
    missing.push('node package manager')
  }
  if (tasks.tasks.value.some((task) => task.source === 'make') && !found.make) {
    missing.push('make')
  }
  return missing
})

const defaults = computed(() => tasks.tasks.value.filter((task) => task.isDefault).length)

function iconFor(status: TaskStatus) {
  if (status === 'passed') return CircleCheck
  if (status === 'failed') return CircleX
  if (status === 'cancelled') return CircleStop
  if (status === 'running') return Loader2
  return Circle
}

function statusClass(status: TaskStatus) {
  return status === 'idle' ? '' : `is-${status}`
}

function taskTitle(task: TaskDef) {
  return task.cwd ? `${task.command} (in ${task.cwd})` : task.command
}

async function run(task: TaskDef) {
  ide.panelTab.value = 'tasks'
  ide.panelVisible.value = true
  await tasks.run(task)
}

async function runDefault() {
  ide.panelTab.value = 'tasks'
  ide.panelVisible.value = true
  const started = await tasks.runDefault()
  if (!started) ide.notify('No default build task. Mark one in .kodra/tasks.json.', 'info')
}

function stop() {
  void tasks.stop()
}

function refresh() {
  void tasks.detect()
}

async function createManifest() {
  const workspace = ide.workspace.value
  if (!workspace) return
  const template = {
    tasks: [
      {
        label: 'Build',
        command: 'echo "replace this command"',
        group: 'build',
        isDefault: true
      }
    ]
  }
  try {
    const path = `${workspace.path}\\.kodra\\tasks.json`
    await call('write_file', {
      path,
      text: `${JSON.stringify(template, null, 2)}\n`
    })
    ide.notify('Created .kodra/tasks.json', 'success')
    await ide.openFile(path)
    await tasks.detect()
  } catch (err) {
    ide.notify(String(err), 'error')
  }
}
</script>

<template>
  <div class="pane tasks-pane">
    <div class="sidebar-header">
      <span class="sidebar-title">Tasks</span>
      <div class="sidebar-actions">
        <button
          class="icon-btn tasks-run-default"
          title="Run build task"
          :disabled="!tasks.defaultTask.value"
          @click="runDefault"
        >
          <Play :size="13" />
        </button>
        <button
          v-if="tasks.active.value"
          class="icon-btn tasks-cancel"
          title="Stop task"
          @click="stop"
        >
          <CircleStop :size="13" />
        </button>
        <button
          class="icon-btn tasks-refresh"
          title="Refresh tasks"
          :disabled="tasks.loading.value"
          @click="refresh"
        >
          <RefreshCw :size="13" :class="{ 'is-spinning': tasks.loading.value }" />
        </button>
      </div>
    </div>

    <div class="sidebar-body">
      <div
        class="tests-summary tasks-summary"
        :class="tasks.runStatus.value === 'idle' ? '' : `is-${tasks.runStatus.value}`"
      >
        <Hammer :size="13" />
        <span class="tests-summary-text">{{ tasks.summary.value }}</span>
        <span v-if="tasks.active.value" class="tests-spinner">
          <Loader2 :size="12" class="is-spinning" />
        </span>
      </div>

      <div v-if="!ide.workspace.value" class="tests-empty">
        Open a folder to discover tasks.
      </div>
      <div v-else-if="tasks.loading.value && !tasks.hasTasks.value" class="tests-empty">
        Scanning for tasks…
      </div>
      <div v-else-if="!tasks.hasTasks.value" class="tests-empty">
        <p>No tasks found.</p>
        <p class="tests-hint">
          Kodra reads <span class="mono">.kodra/tasks.json</span>, <span class="mono">package.json</span>
          scripts and <span class="mono">Makefile</span> targets.
        </p>
        <div class="tasks-empty-actions">
          <button class="btn primary sm" @click="createManifest">Create tasks.json</button>
          <button class="btn sm" @click="refresh">Scan again</button>
        </div>
      </div>

      <template v-else>
        <div v-for="group in tasks.groups.value" :key="group.source" class="tests-group">
          <div class="tests-group-head">
            <span>{{ group.label }}</span>
            <span class="tests-group-count">{{ group.tasks.length }}</span>
          </div>

          <div
            v-for="task in group.tasks"
            :key="task.id"
            class="tests-row task-item"
            :class="{ 'is-active': tasks.statusOf(task) === 'running' }"
            :title="taskTitle(task)"
          >
            <component
              :is="iconFor(tasks.statusOf(task))"
              :size="12"
              class="tests-status task-status"
              :class="statusClass(tasks.statusOf(task))"
              :data-status="tasks.statusOf(task)"
            />
            <button class="tests-name task-label" @click="run(task)">
              {{ task.label }}
              <span v-if="task.isDefault" class="task-badge" title="Default build task">build</span>
              <span v-if="task.cwd" class="tests-folder">{{ task.cwd }}</span>
            </button>
            <span class="task-detail mono">{{ task.detail }}</span>
            <button
              class="icon-btn tasks-run-one"
              :title="`Run ${task.label}`"
              @click="run(task)"
            >
              <Play :size="11" />
            </button>
          </div>
        </div>

        <div v-if="defaults === 0" class="tests-warning task-hint-default">
          No default build task. Add <span class="mono">"isDefault": true</span> to a build task in
          <span class="mono">.kodra/tasks.json</span>.
        </div>
        <div v-if="missingTools.length" class="tests-warning">
          Tool not on PATH: <strong>{{ missingTools.join(', ') }}</strong>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tasks-empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.task-detail {
  flex: 0 1 auto;
  max-width: 42%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-faint);
  font-size: 10px;
  margin-right: 2px;
}
.task-badge {
  margin-left: 5px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--glass);
  color: var(--text-faint);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.task-hint-default {
  margin-top: 8px;
}
</style>
