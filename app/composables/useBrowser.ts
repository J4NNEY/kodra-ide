const LAST_URL_KEY = 'kudo:browser-last-url'

export function useBrowser() {
  const ide = useIde()
  const open = useState<boolean>('kudo:browser-open', () => false)
  const url = useState<string>('kudo:browser-url', () => {
    if (!import.meta.client) return ''
    // Restore what the user was previewing last time, but never fall back to a
    // guessed port: an empty URL shows the start panel instead.
    return localStorage.getItem(LAST_URL_KEY) ?? ''
  })
  const history = useState<string[]>('kudo:browser-history', () => [])
  const index = useState<number>('kudo:browser-index', () => -1)
  const reloadKey = useState<number>('kudo:browser-reload', () => 0)
  const loading = useState<boolean>('kudo:browser-loading', () => false)

  /**
   * The origin Kudo itself is served from. In `pnpm desktop` this is the Nuxt
   * dev server on :3000, so previewing it would embed the IDE inside the IDE.
   */
  const selfOrigin = typeof window === 'undefined' ? '' : window.location.origin

  const isSelfUrl = computed(() => {
    if (!url.value) return false
    try {
      return new URL(url.value).origin === selfOrigin
    } catch {
      return false
    }
  })

  function normalise(raw: string): string {
    const text = raw.trim()
    if (!text) return ''
    if (/^https?:\/\//i.test(text)) return text
    if (text.startsWith('//')) return `https:${text}`
    if (/^[\w.-]+:\d+/.test(text) || /^localhost([:/]|$)/i.test(text)) return `http://${text}`
    if (!text.includes('.') && !text.includes(':')) return `http://localhost:${text}`
    return `https://${text}`
  }

  function remember(target: string) {
    if (!import.meta.client || !target) return
    try {
      localStorage.setItem(LAST_URL_KEY, target)
    } catch {
      /* storage may be unavailable */
    }
  }

  function navigate(raw: string) {
    const target = normalise(raw)
    if (!target) return
    url.value = target
    remember(target)
    if (target === history.value[index.value]) {
      reload()
      return
    }
    history.value = [...history.value.slice(0, index.value + 1), target].slice(-40)
    index.value = history.value.length - 1
    reload()
  }

  function reload() {
    loading.value = true
    reloadKey.value++
  }

  function back() {
    if (index.value <= 0) return
    index.value--
    url.value = history.value[index.value]
    remember(url.value)
    reload()
  }

  function forward() {
    if (index.value >= history.value.length - 1) return
    index.value++
    url.value = history.value[index.value]
    remember(url.value)
    reload()
  }

  /** Go to the configured home, or back to the start panel when unset. */
  function home() {
    const target = ide.settings.value.browserHome?.trim()
    if (!target) {
      url.value = ''
      return
    }
    navigate(target)
  }

  function show(target?: string) {
    if (target) navigate(target)
    else if (!url.value && !history.value.length) {
      // Only open the configured home automatically when it is set. The
      // preview panel guards against Kudo's own origin.
      const configured = ide.settings.value.browserHome?.trim()
      if (configured) navigate(configured)
    }
    open.value = true
  }

  function hide() {
    open.value = false
  }

  return {
    open,
    url,
    history,
    index,
    reloadKey,
    loading,
    isSelfUrl,
    show,
    hide,
    navigate,
    reload,
    back,
    forward,
    home
  }
}
