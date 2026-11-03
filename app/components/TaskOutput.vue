<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { CircleCheck, CircleStop, CircleX, Play, Trash2 } from 'lucide-vue-next'

const ide = useIde()
const tasks = useTasks()
const scroller = ref<HTMLElement | null>(null)

watch(
  () => tasks.output.value.length,
  async () => {
    await nextTick()
    const el = scroller.value
    if (el) el.scrollTop = el.scrollHeight
  }
)

function clear() {
  tasks.clearOutput()
}

function stop() {
  void tasks.stop()
}

async function runDefault() {
  const started = await tasks.runDefault()
  if (!started) ide.notify('No default build task. Mark one in .kodra/tasks.json.', 'info')
}

async function runLast() {
  const started = await tasks.runLast()
  if (!started) ide.notify('No task to run yet.', 'info')
}
</script>

<template>
  <div class="panel-body test-output task-output">
    <div class="out-head test-output-head">
      <span v-if="tasks.runLabel.value" class="test-command" :title="tasks.runLabel.value">
        {{ tasks.runLabel.value }}
      </span>
      <span v-else class="test-command muted">Tasks</span>
      <span v-if="tasks.runCwd.value" class="test-cwd" :title="tasks.runCwd.value">
        {{ tasks.runCwd.value }}
      </span>
      <div style="flex: 1" />
      <span
        v-if="tasks.runStatus.value !== 'idle'"
        class="test-run-chip task-run-chip"
        :class="`is-${tasks.runStatus.value}`"
        :data-status="tasks.runStatus.value"
      >
        <CircleCheck v-if="tasks.runStatus.value === 'passed'" :size="12" />
        <CircleX v-else-if="tasks.runStatus.value === 'failed'" :size="12" />
        <CircleStop v-else-if="tasks.runStatus.value === 'cancelled'" :size="12" />
        <span>{{ tasks.summary.value }}</span>
        <span v-if="tasks.durationText()" class="test-duration">{{ tasks.durationText() }}</span>
      </span>
      <button
        v-if="tasks.active.value"
        class="btn ghost sm task-stop"
        title="Stop task"
        @click="stop"
      >
        <CircleStop :size="12" /> Stop
      </button>
      <button class="btn ghost sm" title="Clear output" @click="clear">
        <Trash2 :size="12" /> Clear
      </button>
    </div>

    <div ref="scroller" class="test-output-log">
      <div
        v-for="(line, index) in tasks.output.value"
        :key="index"
        class="test-line task-line"
        :class="`stream-${line.stream}`"
      >{{ line.text.replace(/\n$/, '') }}</div>
      <div v-if="!tasks.output.value.length" class="test-output-empty">
        <p>No task output yet.</p>
        <button
          class="btn primary sm"
          :disabled="!tasks.defaultTask.value || tasks.active.value"
          @click="runDefault"
        >
          <Play :size="12" /> Run build task
        </button>
        <button v-if="tasks.lastTaskId.value" class="btn sm" @click="runLast">
          <Play :size="12" /> Run last task
        </button>
        <p class="test-hint">
          Pick any task in the Tasks view. Output streams here while it runs.
        </p>
      </div>
      <div v-else-if="tasks.active.value" class="test-line stream-info test-running">
        Running…
      </div>
    </div>
  </div>
</template>

<style scoped>
.task-output {
  display: flex;
  flex-direction: column;
  padding-top: 0;
  overflow: hidden;
}
.test-output-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-top: 4px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
  color: var(--text-faint);
  font-size: 10.5px;
}
.test-command {
  font-family: var(--font-mono);
  color: var(--text-dim);
  max-width: 46%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.test-command.muted {
  color: var(--text-faint);
}
.test-cwd {
  color: var(--text-faint);
  max-width: 30%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.test-run-chip {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 5px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--glass);
  color: var(--text-muted);
  font-size: 10.5px;
  white-space: nowrap;
}
.test-run-chip.is-passed {
  color: var(--success, #4ec9b0);
}
.test-run-chip.is-failed {
  color: var(--danger, #f87171);
}
.test-run-chip.is-running {
  color: var(--warning, #d4a73c);
}
.test-run-chip.is-cancelled {
  color: var(--text-faint);
}
.test-duration {
  color: var(--text-faint);
}
.test-output-log {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-bottom: 8px;
}
.test-line {
  white-space: pre-wrap;
  word-break: break-word;
}
.test-line.stream-stderr {
  color: var(--danger, #f87171);
}
.test-line.stream-info {
  color: var(--accent);
}
.test-line.stream-error {
  color: var(--danger, #f87171);
}
.test-running {
  opacity: 0.7;
  font-style: italic;
}
.test-output-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 2px;
  color: var(--text-faint);
}
.test-output-empty p {
  margin: 0;
}
.test-hint {
  max-width: 420px;
  line-height: 1.5;
  color: var(--text-faint);
  font-size: 10.5px;
}
</style>
