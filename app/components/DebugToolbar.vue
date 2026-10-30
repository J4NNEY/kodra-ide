<script setup lang="ts">
import { CircleStop, CornerDownRight, CornerUpRight, Pause, Play, RotateCcw, StepForward } from 'lucide-vue-next'

const debug = useDebug()

function toggleRun() {
  if (debug.status.value === 'paused') void debug.continueExecution()
  else if (debug.status.value === 'running') void debug.pause()
}
</script>

<template>
  <div v-if="debug.active.value" class="debug-toolbar">
    <span class="debug-toolbar-dot" :style="{ background: debug.statusColor.value }" />
    <span class="debug-toolbar-text">{{ debug.summary.value }}</span>
    <span class="debug-toolbar-sep" />
    <button
      class="dbg-btn"
      :title="debug.status.value === 'paused' ? 'Continue (F5)' : 'Pause'"
      :disabled="debug.status.value === 'starting'"
      @click="toggleRun"
    >
      <Play v-if="debug.status.value === 'paused'" :size="13" />
      <Pause v-else :size="13" />
    </button>
    <button
      class="dbg-btn"
      title="Step over (F10)"
      :disabled="debug.status.value !== 'paused'"
      @click="debug.step('next')"
    >
      <StepForward :size="13" />
    </button>
    <button
      class="dbg-btn"
      title="Step into (F11)"
      :disabled="debug.status.value !== 'paused'"
      @click="debug.step('stepIn')"
    >
      <CornerDownRight :size="13" />
    </button>
    <button
      class="dbg-btn"
      title="Step out (Shift+F11)"
      :disabled="debug.status.value !== 'paused'"
      @click="debug.step('stepOut')"
    >
      <CornerUpRight :size="13" />
    </button>
    <button class="dbg-btn" title="Restart" @click="debug.restart()">
      <RotateCcw :size="13" />
    </button>
    <button class="dbg-btn danger" title="Stop (Shift+F5)" @click="debug.stop()">
      <CircleStop :size="13" />
    </button>
  </div>
</template>

<style scoped>
.debug-toolbar {
  position: absolute;
  top: 44px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px 4px 10px;
  border-radius: 9px;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.35);
  max-width: min(90%, 640px);
}
.debug-toolbar-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.debug-toolbar-text {
  font-size: 11.5px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 280px;
}
.debug-toolbar-sep {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background: var(--border);
}
.dbg-btn {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
}
.dbg-btn:hover:not(:disabled) {
  background: var(--glass-strong);
  color: var(--text);
}
.dbg-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.dbg-btn.danger:hover:not(:disabled) {
  color: var(--danger, #f87171);
}
</style>
