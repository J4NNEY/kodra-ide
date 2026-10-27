<script setup lang="ts">
import { AlertTriangle, CheckCircle2, Info } from 'lucide-vue-next'

const ide = useIde()

function icon(kind: string) {
  if (kind === 'error') return AlertTriangle
  if (kind === 'success') return CheckCircle2
  return Info
}
</script>

<template>
  <Teleport to="body">
    <div class="toast-host">
      <div v-for="toast in ide.toasts.value" :key="toast.id" class="toast" :class="toast.kind">
        <component
          :is="icon(toast.kind)"
          :size="14"
          :style="{
            color:
              toast.kind === 'error'
                ? 'var(--red)'
                : toast.kind === 'success'
                  ? 'var(--green)'
                  : 'var(--text-muted)',
            marginTop: '1px',
            flex: '0 0 auto'
          }"
        />
        <span>{{ toast.message }}</span>
      </div>
    </div>
  </Teleport>
</template>
