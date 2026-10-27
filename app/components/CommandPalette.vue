<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Command as CommandIcon, Search } from 'lucide-vue-next'
import type { Command } from '../composables/useCommands'

const ide = useIde()
const { filter } = useCommands()

const query = ref('')
const index = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLDivElement | null>(null)

const results = computed(() => filter(query.value).slice(0, 80))

watch(results, () => {
  index.value = 0
})

watch(
  () => ide.palette.value.mode,
  async (mode) => {
    if (mode !== 'commands') return
    query.value = ''
    index.value = 0
    await nextTick()
    inputEl.value?.focus()
  }
)

function close() {
  ide.palette.value = { mode: 'none' }
}

async function run(command: Command) {
  close()
  try {
    await command.run()
  } catch (err) {
    ide.notify(String(err), 'error')
  }
}

function move(delta: number) {
  if (!results.value.length) return
  const next = (index.value + delta + results.value.length) % results.value.length
  index.value = next
  nextTick(() => {
    listEl.value
      ?.querySelector<HTMLElement>(`[data-index="${next}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  })
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
    const command = results.value[index.value]
    if (command) run(command)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="ide.palette.value.mode === 'commands'" class="overlay" @click.self="close">
      <div class="palette">
        <div class="palette-input">
          <CommandIcon :size="15" style="color: var(--text-faint)" />
          <input
            ref="inputEl"
            v-model="query"
            placeholder="Type a command…"
            spellcheck="false"
            autofocus
            @keydown="onKeydown"
          />
          <kbd>Esc</kbd>
        </div>
        <div ref="listEl" class="palette-list">
          <div
            v-for="(command, i) in results"
            :key="command.id"
            class="palette-item"
            :class="{ active: i === index }"
            :data-index="i"
            @mouseenter="index = i"
            @click="run(command)"
          >
            <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
              {{ command.label }}
            </span>
            <span class="group">{{ command.group }}</span>
            <kbd v-if="command.hint">{{ command.hint }}</kbd>
          </div>
          <div v-if="!results.length" class="palette-empty">
            No command matches “{{ query }}”.
          </div>
        </div>
        <div class="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> run</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.palette-foot {
  display: flex;
  gap: 16px;
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  font-size: 10.5px;
  color: var(--text-faint);
}
.palette-foot span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.group {
  font-size: 10px;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
</style>
