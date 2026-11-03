// Move browser-mode state written by the pre-rename build (`kudo:*`) to the
// Kodra namespace. Desktop builds use a new app-data folder instead, so this
// only matters for `pnpm dev`, but it keeps dev settings, chat history and
// breakpoints when the name changes.
const LEGACY_PREFIX = 'kudo:'
const PREFIX = 'kodra:'

export default defineNuxtPlugin(() => {
  try {
    const legacy: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(LEGACY_PREFIX)) legacy.push(key)
    }
    for (const key of legacy) {
      const target = PREFIX + key.slice(LEGACY_PREFIX.length)
      const value = localStorage.getItem(key)
      if (value !== null && localStorage.getItem(target) === null) {
        localStorage.setItem(target, value)
      }
      localStorage.removeItem(key)
    }
  } catch {
    /* storage may be unavailable */
  }
})
