export function useBrowser() {
  const ide = useIde()
  const open = useState<boolean>('kudo:browser-open', () => false)
  const url = useState<string>('kudo:browser-url', () => 'http://localhost:3000')
  const history = useState<string[]>('kudo:browser-history', () => [])
  const index = useState<number>('kudo:browser-index', () => -1)
  const reloadKey = useState<number>('kudo:browser-reload', () => 0)
  const loading = useState<boolean>('kudo:browser-loading', () => false)

  function normalise(raw: string): string {
    const text = raw.trim()
    if (!text) return ''
    if (/^https?:\/\//i.test(text)) return text
    if (text.startsWith('//')) return `https:${text}`
    if (/^[\w.-]+:\d+/.test(text) || /^localhost([:/]|$)/i.test(text)) return `http://${text}`
    if (!text.includes('.') && !text.includes(':')) return `http://localhost:${text}`
    return `https://${text}`
  }

  function navigate(raw: string) {
    const target = normalise(raw)
    if (!target) return
    url.value = target
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
    ide.settings.value.browserHome = url.value
  }

  function back() {
    if (index.value <= 0) return
    index.value--
    url.value = history.value[index.value]
    reload()
  }

  function forward() {
    if (index.value >= history.value.length - 1) return
    index.value++
    url.value = history.value[index.value]
    reload()
  }

  function home() {
    navigate(ide.settings.value.browserHome || 'http://localhost:3000')
  }

  function show(target?: string) {
    if (target) navigate(target)
    else if (!history.value.length) navigate(url.value)
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
    show,
    hide,
    navigate,
    reload,
    back,
    forward,
    home
  }
}
