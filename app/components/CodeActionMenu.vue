<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Wand2 } from 'lucide-vue-next'

const intel = useCodeIntel()

const index = ref(0)
const busy = ref(false)
const menuEl = ref<HTMLElement | null>(null)

watch(
  () => intel.actions.value?.items.length,
  async (length) => {
    index.value = 0
    if (length === undefined) return
    await nextTick()
    menuEl.value?.focus()
  }
)

watch(
  () => intel.actions.value,
  async (state) => {
    if (!state) return
    await nextTick()
    menuEl.value?.focus()
  }
)

function move(delta: number) {
  const items = intel.actions.value?.items ?? []
  if (!items.length) return
  index.value = (index.value + delta + items.length) % items.length
}

async function run(at?: number) {
  const state = intel.actions.value
  const action = state?.items[at ?? index.value]
  if (!action || busy.value) return
  busy.value = true
  try {
    await intel.runAction(action)
  } finally {
    busy.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    void run()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    intel.cancelActions()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="intel.actions.value" class="overlay" @click.self="intel.cancelActions()">
      <div ref="menuEl" class="palette intel-actions" tabindex="-1" @keydown="onKeydown">
        <div class="palette-input">
          <Wand2 :size="15" style="color: var(--accent)" />
          <span style="flex: 1">Code Actions</span>
          <kbd>Esc</kbd>
        </div>
        <div class="palette-list">
          <div
            v-for="(action, i) in intel.actions.value.items"
            :key="`${action.title}:${i}`"
            class="palette-item"
            :class="{ active: i === index }"
            :data-index="i"
            @mouseenter="index = i"
            @click="run(i)"
          >
            <Wand2 :size="13" style="color: var(--text-faint); flex: 0 0 auto" />
            <span class="intel-action-title">{{ action.title }}</span>
            <span v-if="action.preferred" class="group">preferred</span>
            <span v-if="action.kind" class="group">{{ action.kind.replace('quickfix', 'quick fix') }}</span>
          </div>
          <div v-if="intel.actions.value.loading" class="palette-empty">
            Asking the language server…
          </div>
          <div v-else-if="!intel.actions.value.items.length" class="palette-empty">
            No code actions at this position.
          </div>
        </div>
        <div class="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> apply</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.intel-actions {
  width: min(560px, 92vw);
  outline: none;
}
.intel-action-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.group {
  font-size: 10px;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  flex: 0 0 auto;
}
</style>
