<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Pencil } from 'lucide-vue-next'

const intel = useCodeIntel()
const inputEl = ref<HTMLInputElement | null>(null)

function setName(value: string) {
  const state = intel.rename.value
  if (state) state.value = value
}

function submit() {
  const state = intel.rename.value
  if (!state || state.busy) return
  const value = state.value.trim()
  if (!value) {
    state.error = 'Enter a new name'
    return
  }
  void intel.submitRename(value)
}

watch(
  () => intel.rename.value?.path,
  async (path) => {
    if (!path) return
    await nextTick()
    inputEl.value?.focus()
    inputEl.value?.select()
  }
)
</script>

<template>
  <Teleport to="body">
    <div v-if="intel.rename.value" class="overlay" @click.self="intel.cancelRename()">
      <div class="intel-dialog">
        <div class="intel-head">
          <Pencil :size="15" style="color: var(--accent)" />
          <span>Rename Symbol</span>
          <kbd>Esc</kbd>
        </div>
        <p class="intel-sub">
          Rename “{{ intel.rename.value.placeholder }}” and every reference the language
          server knows about.
        </p>
        <input
          ref="inputEl"
          class="intel-input"
          :class="{ invalid: intel.rename.value.error }"
          :value="intel.rename.value.value"
          spellcheck="false"
          autocomplete="off"
          @input="setName(($event.target as HTMLInputElement).value)"
          @keydown.enter.prevent="submit"
          @keydown.esc.prevent="intel.cancelRename()"
        />
        <div v-if="intel.rename.value.error" class="intel-error">
          {{ intel.rename.value.error }}
        </div>
        <div class="intel-foot">
          <span class="hint">
            {{ intel.rename.value.busy ? 'Renaming…' : 'Enter to rename · Esc to cancel' }}
          </span>
          <button class="btn sm" :disabled="intel.rename.value.busy" @click="intel.cancelRename()">
            Cancel
          </button>
          <button
            class="btn primary sm"
            :disabled="intel.rename.value.busy"
            @click="submit"
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
