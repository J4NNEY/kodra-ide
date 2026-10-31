<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { CircleCheck, CircleStop, CircleX, Play, Trash2 } from 'lucide-vue-next'

const ide = useIde()
const tests = useTests()
const scroller = ref<HTMLElement | null>(null)

watch(
  () => tests.output.value.length,
  async () => {
    await nextTick()
    const el = scroller.value
    if (el) el.scrollTop = el.scrollHeight
  }
)

function clear() {
  tests.clearOutput()
}

function cancel() {
  void tests.cancel()
}

function runAll() {
  void tests.runAll()
}
</script>

<template>
  <div class="panel-body test-output">
    <div class="out-head test-output-head">
      <span v-if="tests.runLabel.value" class="test-command" :title="tests.runLabel.value">
        {{ tests.runLabel.value }}
      </span>
      <span v-else class="test-command muted">Tests</span>
      <span v-if="tests.runCwd.value" class="test-cwd" :title="tests.runCwd.value">
        {{ tests.runCwd.value }}
      </span>
      <div style="flex: 1" />
      <span
        v-if="tests.runStatus.value !== 'idle'"
        class="test-run-chip"
        :class="`is-${tests.runStatus.value}`"
        :data-status="tests.runStatus.value"
      >
        <CircleCheck v-if="tests.runStatus.value === 'passed'" :size="12" />
        <CircleX v-else-if="tests.runStatus.value === 'failed'" :size="12" />
        <CircleStop v-else-if="tests.runStatus.value === 'cancelled'" :size="12" />
        <span>{{ tests.summary.value }}</span>
        <span v-if="tests.durationText()" class="test-duration">{{ tests.durationText() }}</span>
      </span>
      <button
        v-if="tests.active.value"
        class="btn ghost sm tests-cancel"
        title="Cancel run"
        @click="cancel"
      >
        <CircleStop :size="12" /> Cancel
      </button>
      <button class="btn ghost sm" title="Clear output" @click="clear">
        <Trash2 :size="12" /> Clear
      </button>
    </div>

    <div ref="scroller" class="test-output-log">
      <div
        v-for="(line, index) in tests.output.value"
        :key="index"
        class="test-line"
        :class="`stream-${line.stream}`"
      >{{ line.text.replace(/\n$/, '') }}</div>
      <div v-if="!tests.output.value.length" class="test-output-empty">
        <p>No test output yet.</p>
        <button
          class="btn primary sm"
          :disabled="!tests.hasTests.value || tests.active.value"
          @click="runAll"
        >
          <Play :size="12" /> Run all tests
        </button>
        <p class="test-hint">
          Output streams here while tests run. Use the Tests view to pick a single test.
        </p>
      </div>
      <div v-else-if="tests.active.value" class="test-line stream-info test-running">
        Running…
      </div>
    </div>
  </div>
</template>

<style scoped>
.test-output {
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
  font-size: 10.5px;
}
</style>
