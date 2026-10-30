<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ChevronDown,
  ChevronRight,
  CircleStop,
  CornerDownRight,
  Pause,
  Play,
  Plus,
  RotateCcw,
  StepForward,
  Trash2,
  X
} from 'lucide-vue-next'
import { basename } from '../lib/api'
import type { Breakpoint, DebugFrame, DebugVariable } from '../composables/useDebug'

const ide = useIde()
const debug = useDebug()

const showConfig = ref(true)
const watchInput = ref('')
const editingCondition = ref<Breakpoint | null>(null)
const conditionDraft = ref('')

const spec = computed(() => debug.currentAdapter.value)
const detectedLabel = computed(() => {
  const path = debug.adapters.value[spec.value.command]
  return path ? basename(path) : null
})

const sortedBreakpoints = computed(() =>
  [...debug.breakpoints.value].sort((a, b) =>
    a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path)
  )
)

type FlatVariable = { variable: DebugVariable; depth: number }
const flatVariables = computed(() => {
  const out: FlatVariable[] = []
  const walk = (list: DebugVariable[], depth: number) => {
    for (const variable of list) {
      out.push({ variable, depth })
      if (variable.expanded && variable.children.length) walk(variable.children, depth + 1)
    }
  }
  walk(debug.variables.value, 0)
  return out
})

function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path
}

function run() {
  if (debug.active.value) void debug.continueExecution()
  else void debug.start()
}

function openBreakpoint(bp: Breakpoint) {
  void ide.openFile(bp.path, bp.line)
}

function openFrame(frame: DebugFrame) {
  if (frame.path) void ide.openFile(frame.path, frame.line)
}

function editCondition(bp: Breakpoint) {
  editingCondition.value = bp
  conditionDraft.value = bp.condition
}

function saveCondition() {
  const bp = editingCondition.value
  if (!bp) return
  void debug.setBreakpointCondition(bp, conditionDraft.value.trim())
  editingCondition.value = null
}

async function submitWatch() {
  const expression = watchInput.value.trim()
  if (!expression) return
  await debug.evaluate(expression)
  watchInput.value = ''
}

function persistConfig() {
  debug.persist()
}

async function pickAdapter() {
  debug.persist()
  await debug.detect()
}
</script>

<template>
  <div class="pane debug-pane">
    <div class="sidebar-header">
      <span class="sidebar-title">Run and Debug</span>
      <div class="sidebar-actions">
        <button class="icon-btn" title="Toggle configuration" @click="showConfig = !showConfig">
          <ChevronDown v-if="showConfig" :size="13" />
          <ChevronRight v-else :size="13" />
        </button>
        <button
          class="icon-btn"
          title="Clear all breakpoints"
          :disabled="!debug.breakpoints.value.length"
          @click="debug.clearBreakpoints()"
        >
          <Trash2 :size="13" />
        </button>
      </div>
    </div>

    <div class="sidebar-body">
      <div class="debug-actions">
        <button class="btn primary" :disabled="!ide.workspace.value" @click="run">
          <Play v-if="!debug.active.value" :size="13" />
          <Play v-else :size="13" />
          {{ debug.active.value ? 'Continue' : 'Start Debugging' }}
        </button>
        <button class="icon-btn" title="Pause" :disabled="debug.status.value !== 'running'" @click="debug.pause()">
          <Pause :size="13" />
        </button>
        <button class="icon-btn" title="Restart" :disabled="!debug.active.value" @click="debug.restart()">
          <RotateCcw :size="13" />
        </button>
        <button class="icon-btn" title="Stop (Shift+F5)" :disabled="!debug.active.value" @click="debug.stop()">
          <CircleStop :size="13" />
        </button>
      </div>

      <div v-if="debug.active.value" class="debug-status" :style="{ color: debug.statusColor.value }">
        <span class="debug-dot" :style="{ background: debug.statusColor.value }" />
        {{ debug.summary.value }}
      </div>

      <div v-if="showConfig" class="debug-config">
        <label class="debug-field">
          <span>Adapter</span>
          <select v-model="debug.config.value.adapter" class="select" @change="pickAdapter">
            <option v-for="adapter in debug.adapterSpecs.value" :key="adapter.id" :value="adapter.id">
              {{ adapter.label }}{{ adapter.available ? '' : ' (not found)' }}
            </option>
          </select>
        </label>

        <label v-if="spec.id !== 'custom'" class="debug-field">
          <span>Request</span>
          <select v-model="debug.config.value.request" class="select" @change="persistConfig">
            <option value="launch">Launch</option>
            <option value="attach">Attach</option>
          </select>
        </label>

        <label v-if="spec.id !== 'custom'" class="debug-field">
          <span>{{ debug.config.value.request === 'attach' ? 'Process ID' : 'Program' }}</span>
          <input
            v-model="debug.config.value.program"
            class="input"
            spellcheck="false"
            :placeholder="
              debug.config.value.request === 'attach'
                ? 'PID of a running process'
                : 'Folder or binary to debug'
            "
            @change="persistConfig"
          />
        </label>
        <label
          v-if="spec.id !== 'custom' && debug.config.value.request !== 'attach'"
          class="debug-field"
        >
          <span>Arguments</span>
          <input
            v-model="debug.config.value.args"
            class="input"
            spellcheck="false"
            placeholder="--flag value"
            @change="persistConfig"
          />
        </label>
        <label class="debug-field">
          <span>Working directory</span>
          <input
            v-model="debug.config.value.cwd"
            class="input"
            spellcheck="false"
            @change="persistConfig"
          />
        </label>
        <label class="debug-field">
          <span>Adapter command</span>
          <input
            v-model="debug.config.value.command"
            class="input"
            spellcheck="false"
            :placeholder="detectedLabel ?? spec.command ?? 'path to adapter'"
            @change="persistConfig"
          />
        </label>
        <textarea
          v-if="spec.id === 'custom'"
          v-model="debug.config.value.launchJson"
          class="input"
          rows="5"
          spellcheck="false"
          placeholder='{ "program": "", "args": [] }'
          @change="persistConfig"
        />
        <label v-if="debug.config.value.request !== 'attach'" class="debug-check">
          <input v-model="debug.config.value.stopOnEntry" type="checkbox" @change="persistConfig" />
          <span>Stop on entry</span>
        </label>
        <p v-else-if="spec.id !== 'custom'" class="debug-hint">
          Attaches to an already running process; breakpoints are set once the adapter is up.
        </p>
        <p v-if="!debug.adapterSpecs.value.some((a) => a.id === spec.id && a.available)" class="debug-hint">
          Adapter not detected. {{ spec.install }}
        </p>
      </div>

      <div class="section-label">Breakpoints — {{ debug.breakpoints.value.length }}</div>
      <div v-if="!sortedBreakpoints.length" class="debug-empty">
        Click the gutter next to a line, or press F9, to add a breakpoint.
      </div>
      <div v-for="bp in sortedBreakpoints" :key="`${bp.path}:${bp.line}`" class="bp-row">
        <input
          type="checkbox"
          :checked="bp.enabled"
          :title="bp.enabled ? 'Disable breakpoint' : 'Enable breakpoint'"
          @change="debug.setBreakpointEnabled(bp, ($event.target as HTMLInputElement).checked)"
        />
        <span class="bp-dot" :class="{ off: !bp.enabled, unverified: bp.enabled && !bp.verified }" />
        <button class="bp-label" :title="bp.path" @click="openBreakpoint(bp)">
          {{ fileName(bp.path) }}<span class="dim">:{{ bp.line }}</span>
        </button>
        <button
          class="icon-btn tiny"
          title="Conditional breakpoint"
          @click="editCondition(bp)"
        >
          <Plus :size="11" />
        </button>
        <button class="icon-btn tiny" title="Remove" @click="debug.removeBreakpoint(bp)">
          <X :size="11" />
        </button>
        <div v-if="editingCondition === bp" class="bp-condition">
          <input
            v-model="conditionDraft"
            class="input"
            spellcheck="false"
            placeholder="condition, e.g. i == 3"
            @keydown.enter="saveCondition"
            @keydown.esc="editingCondition = null"
          />
          <button class="btn" @click="saveCondition">Set</button>
        </div>
        <div v-else-if="bp.condition" class="bp-condition-text">if {{ bp.condition }}</div>
      </div>

      <template v-if="debug.paused.value">
        <div class="section-label">Call Stack</div>
        <button
          v-for="(frame, index) in debug.frames.value"
          :key="frame.id"
          class="frame-row"
          :class="{ active: index === 0 }"
          @click="openFrame(frame)"
        >
          <CornerDownRight :size="12" class="dim" />
          <span class="frame-name">{{ frame.name }}</span>
          <span class="dim frame-where">
            {{ frame.path ? `${fileName(frame.path)}:${frame.line}` : `line ${frame.line}` }}
          </span>
        </button>

        <div class="section-label">Variables</div>
        <div v-if="!flatVariables.length" class="debug-empty">No variables in this frame.</div>
        <div
          v-for="row in flatVariables"
          :key="`${row.depth}-${row.variable.name}`"
          class="var-row"
          :style="{ paddingLeft: `${8 + row.depth * 12}px` }"
          @click="debug.expandVariable(row.variable)"
        >
          <ChevronDown v-if="row.variable.expanded" :size="11" class="dim" />
          <ChevronRight v-else-if="row.variable.variablesReference" :size="11" class="dim" />
          <span v-else class="var-spacer" />
          <span class="var-name">{{ row.variable.name }}</span>
          <span class="var-value">{{ row.variable.value }}</span>
        </div>

        <div class="section-label">Watch</div>
        <div class="watch-input">
          <input
            v-model="watchInput"
            class="input"
            spellcheck="false"
            placeholder="Evaluate expression"
            @keydown.enter="submitWatch"
          />
          <button class="icon-btn" title="Evaluate" @click="submitWatch">
            <StepForward :size="13" />
          </button>
        </div>
        <div v-for="entry in debug.watchResults.value" :key="entry.expression" class="watch-row">
          <span class="var-name">{{ entry.expression }}</span>
          <span class="var-value" :class="{ error: !!entry.error }">
            {{ entry.error || entry.result }}
          </span>
        </div>
      </template>

      <div class="section-label">Debug Console</div>
      <div class="debug-console">
        <div v-if="!debug.output.value.length" class="debug-empty">Adapter output appears here.</div>
        <div
          v-for="(line, index) in debug.output.value"
          :key="index"
          class="console-line"
          :class="line.category"
        >
          {{ line.text }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.debug-pane {
  min-width: 0;
}
.debug-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 4px 8px;
}
.debug-actions .btn {
  flex: 1;
  justify-content: center;
}
.debug-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 8px;
  font-size: 11.5px;
}
.debug-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.debug-config {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 6px 6px 10px;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.debug-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10.5px;
  color: var(--text-faint);
}
.debug-check {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  color: var(--text-dim);
}
.debug-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-faint);
}
.debug-empty {
  padding: 4px 10px 10px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-faint);
}
.bp-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  flex-wrap: wrap;
}
.bp-row:hover {
  background: var(--glass);
}
.bp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger, #f87171);
  flex: 0 0 auto;
}
.bp-dot.unverified {
  background: transparent;
  border: 1px solid var(--danger, #f87171);
}
.bp-dot.off {
  background: var(--text-faint);
}
.bp-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  background: none;
  border: 0;
  padding: 0;
  font-size: 12px;
  color: var(--text-dim);
  cursor: pointer;
}
.bp-label:hover {
  color: var(--text);
}
.bp-condition,
.bp-condition-text {
  flex: 0 0 100%;
  display: flex;
  gap: 6px;
  padding-left: 26px;
}
.bp-condition-text {
  font-size: 11px;
  color: var(--text-faint);
}
.frame-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 9px;
  border: 0;
  background: none;
  color: var(--text-dim);
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
}
.frame-row:hover {
  background: var(--glass);
}
.frame-row.active {
  background: var(--glass-strong);
  color: var(--text);
}
.frame-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.frame-where {
  font-size: 10.5px;
  flex: 0 0 auto;
}
.var-row {
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 3px 8px;
  font-size: 11.5px;
  cursor: pointer;
}
.var-row:hover {
  background: var(--glass);
}
.var-spacer {
  width: 11px;
  flex: 0 0 auto;
}
.var-name {
  color: var(--text-dim);
  flex: 0 0 auto;
}
.var-value {
  color: var(--text);
  opacity: 0.85;
  font-family: var(--mono, monospace);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.var-value.error {
  color: var(--danger, #f87171);
}
.watch-input {
  display: flex;
  gap: 4px;
  padding: 0 6px 6px;
}
.watch-row {
  display: flex;
  gap: 8px;
  padding: 3px 10px;
  font-size: 11.5px;
}
.console-line {
  padding: 1px 10px;
  font-family: var(--mono, monospace);
  font-size: 11px;
  color: var(--text-dim);
  white-space: pre-wrap;
  word-break: break-word;
}
.console-line.stderr {
  color: var(--danger, #f87171);
}
.console-line.console {
  color: var(--text-faint);
}
.dim {
  color: var(--text-faint);
}
.icon-btn.tiny {
  width: 18px;
  height: 18px;
}
</style>
