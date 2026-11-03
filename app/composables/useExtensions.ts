import { call } from '../lib/api'
import type { ExtensionInfo } from '../lib/types'
import {
  expandSnippet,
  normalizeSnippet,
  normalizeTheme,
  type SnippetContribution,
  type Theme
} from '../lib/themes'

export interface InstalledSnippet extends SnippetContribution {
  extension: string
  extensionFolder: string
}

/**
 * Installed extensions and the contributions they switch on. Extensions are
 * declarative folders in `<config>/extensions`; nothing here executes code.
 */
export function useExtensions() {
  const ide = useIde()
  const registry = useThemes()
  const list = useState<ExtensionInfo[]>('kodra:extensions', () => [])
  const loading = useState<boolean>('kodra:extensions-loading', () => false)
  const error = useState<string>('kodra:extensions-error', () => '')
  const directory = useState<string>('kodra:extensions-dir', () => '')

  const enabled = computed(() =>
    list.value.filter((extension) => extension.enabled && !extension.error)
  )

  const themes = computed<Theme[]>(() => {
    const seen = new Set<string>()
    const out: Theme[] = []
    for (const extension of enabled.value) {
      for (const raw of extension.themes) {
        const theme = normalizeTheme(raw, extension.folder)
        if (!theme || seen.has(theme.id)) continue
        seen.add(theme.id)
        out.push(theme)
      }
    }
    return out
  })

  const snippets = computed<InstalledSnippet[]>(() => {
    const out: InstalledSnippet[] = []
    for (const extension of enabled.value) {
      for (const raw of extension.snippets) {
        const snippet = normalizeSnippet(raw, extension.name)
        if (!snippet) continue
        out.push({ ...snippet, extensionFolder: extension.folder } as InstalledSnippet)
      }
    }
    return out
  })

  /** Push the current theme contributions into the registry and repaint. */
  function syncThemes() {
    registry.setExtensionThemes(themes.value)
    registry.apply()
  }

  async function load() {
    loading.value = true
    try {
      list.value = (await call<ExtensionInfo[]>('extensions_list')) ?? []
      directory.value = await call<string>('extensions_dir_path').catch(() => '')
      error.value = ''
    } catch (err) {
      error.value = String(err)
    } finally {
      loading.value = false
    }
    syncThemes()
  }

  async function ensureLoaded() {
    if (list.value.length || loading.value) return
    await load()
  }

  async function install(path: string) {
    await call('extension_install', { source: path })
    await load()
    const name = list.value.find((extension) => extension.path.toLowerCase() === path.toLowerCase())
      ?.name
    ide.notify(name ? `${name} installed` : 'Extension installed', 'success')
  }

  async function setEnabled(folder: string, value: boolean) {
    await call('extension_set_enabled', { folder, enabled: value })
    await load()
  }

  async function remove(folder: string) {
    const extension = list.value.find((item) => item.folder === folder)
    await call('extension_remove', { folder })
    await load()
    ide.notify(extension ? `${extension.name} removed` : 'Extension removed')
  }

  /** Insert a snippet into the active editor (via the CodeEditor listener). */
  function applySnippet(snippet: InstalledSnippet | SnippetContribution): boolean {
    if (!ide.activePath.value) {
      ide.notify('Open a file before inserting a snippet', 'error')
      return false
    }
    const text = expandSnippet(snippet.body)
    window.dispatchEvent(new CustomEvent<string>('kodra:editor-insert', { detail: text }))
    return true
  }

  return {
    list,
    enabled,
    themes,
    snippets,
    loading,
    error,
    directory,
    load,
    ensureLoaded,
    install,
    setEnabled,
    remove,
    applySnippet
  }
}
