import { watch } from 'vue'

/**
 * A layout dimension (panel width/height) that survives restarts. Values live in
 * Nuxt state so every component shares one source of truth, and mirror to
 * localStorage so the workspace keeps its shape between sessions.
 */
export function useLayoutSize(key: string, fallback: number, min: number, max: number) {
  const size = useState<number>(key, () => fallback)

  if (import.meta.client) {
    const stored = Number(localStorage.getItem(`kudo:${key}`))
    if (Number.isFinite(stored) && stored >= min && stored <= max && size.value === fallback) {
      size.value = stored
    }
  }

  watch(size, (value) => {
    if (!import.meta.client) return
    localStorage.setItem(`kudo:${key}`, String(Math.round(value)))
  })

  return size
}
