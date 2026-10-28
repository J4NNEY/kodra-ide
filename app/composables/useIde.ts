import type {
  EditorTab,
  Settings,
  SidebarView,
  WorkspaceInfo
} from '../lib/types'
import { basename, call, languageFor, pickFolder } from '../lib/api'
import { defaultSettings } from '../lib/defaults'
import {
  EXTENSION_THEMES_KEY,
  applyThemeVars,
  builtinThemes,
  resolveTheme,
  type Theme
} from '../lib/themes'

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'error' | 'success'
}

export interface PaletteState {
  mode: 'none' | 'commands' | 'files'
}

export function useIde() {
  const workspace = useState<WorkspaceInfo | null>('kudo:workspace', () => null)
  const settings = useState<Settings>('kudo:settings', () => structuredClone(defaultSettings))
  const tabs = useState<EditorTab[]>('kudo:tabs', () => [])
  const activePath = useState<string | null>('kudo:active', () => null)
  const sidebarView = useState<SidebarView>('kudo:sidebar-view', () => 'explorer')
  const sidebarVisible = useState<boolean>('kudo:sidebar-visible', () => true)
  const chatOpen = useState<boolean>('kudo:chat-open', () => true)
  const panelVisible = useState<boolean>('kudo:panel-visible', () => true)
  const panelTab = useState<'terminal' | 'problems' | 'output' | 'network'>('kudo:panel-tab', () => 'terminal')
  const settingsOpen = useState<boolean>('kudo:settings-open', () => false)
  const palette = useState<PaletteState>('kudo:palette', () => ({ mode: 'none' }))
  const toasts = useState<Toast[]>('kudo:toasts', () => [])
  const ready = useState<boolean>('kudo:ready', () => false)
  const loadingFile = useState<boolean>('kudo:loading-file', () => false)

  const activeTab = computed(() => tabs.value.find((t) => t.path === activePath.value) ?? null)

  let toastSeq = 0
  function notify(message: string, kind: Toast['kind'] = 'info') {
    const id = ++toastSeq
    toasts.value = [...toasts.value, { id, message, kind }]
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, kind === 'error' ? 6000 : 3200)
  }

  function applyTheme(theme = settings.value.theme) {
    if (typeof document === 'undefined') return
    const extras = useState<Theme[]>(EXTENSION_THEMES_KEY, () => []).value
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches
    const active = resolveTheme(theme, [...builtinThemes, ...extras], prefersLight)
    applyThemeVars(active, {
      accent: settings.value.accent,
      fontSize: settings.value.fontSize,
      fontFamily: settings.value.fontFamily
    })
  }

  async function init() {
    if (ready.value) return
    try {
      const loaded = await call<Settings>('get_settings')
      settings.value = {
        ...defaultSettings,
        ...loaded,
        ai: { ...defaultSettings.ai, ...loaded.ai }
      }
    } catch (err) {
      console.warn('[kudo] settings unavailable', err)
    }
    applyTheme()

    try {
      const info = await call<WorkspaceInfo | null>('current_workspace')
      if (info) workspace.value = info
    } catch {
      /* no workspace yet */
    }

    if (settings.value.restoreSession) {
      try {
        const raw = localStorage.getItem('kudo:session')
        if (raw) {
          const session = JSON.parse(raw) as { tabs: string[]; active: string | null }
          for (const path of session.tabs ?? []) {
            await openFile(path, undefined, true).catch(() => {})
          }
          if (session.active) activePath.value = session.active
        }
      } catch {
        /* ignore */
      }
    }
    ready.value = true
  }

  function persistSession() {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(
      'kudo:session',
      JSON.stringify({ tabs: tabs.value.map((t) => t.path), active: activePath.value })
    )
  }

  async function openFolder(path?: string) {
    const target = path ?? (await pickFolder())
    if (!target) return
    try {
      const info = await call<WorkspaceInfo>('open_workspace', { path: target })
      workspace.value = info
      tabs.value = []
      activePath.value = null
      notify(`Opened ${info.name}`, 'success')
      const recent = await call<Settings>('get_settings')
      settings.value = { ...settings.value, ...recent }
    } catch (err) {
      notify(String(err), 'error')
    }
  }

  async function closeWorkspace() {
    await call('close_workspace')
    workspace.value = null
    tabs.value = []
    activePath.value = null
    notify('Workspace closed')
  }

  async function openFile(path: string, line?: number, quiet = false) {
    if (!path) return
    const existing = tabs.value.find((t) => t.path === path)
    if (existing) {
      activePath.value = path
      if (line) pendingLine.value = { path, line }
      return
    }
    loadingFile.value = true
    try {
      const file = await call<{
        path: string
        text: string
        binary: boolean
        size: number
      }>('read_file', { path })
      const tab: EditorTab = {
        path,
        name: basename(path),
        content: file.text,
        savedContent: file.text,
        language: languageFor(path),
        binary: file.binary,
        dirty: false
      }
      tabs.value = [...tabs.value, tab]
      activePath.value = path
      if (line) pendingLine.value = { path, line }
      persistSession()
    } catch (err) {
      if (!quiet) notify(String(err), 'error')
    } finally {
      loadingFile.value = false
    }
  }

  const pendingLine = useState<{ path: string; line: number } | null>(
    'kudo:pending-line',
    () => null
  )

  function updateContent(path: string, content: string) {
    const tab = tabs.value.find((t) => t.path === path)
    if (!tab) return
    tab.content = content
    tab.dirty = content !== tab.savedContent
  }

  async function saveTab(path?: string) {
    const target = path ?? activePath.value
    if (!target) return
    const tab = tabs.value.find((t) => t.path === target)
    if (!tab || !tab.dirty) return
    try {
      await call('write_file', { path: target, text: tab.content })
      tab.savedContent = tab.content
      tab.dirty = false
      notify(`Saved ${tab.name}`, 'success')
    } catch (err) {
      notify(String(err), 'error')
    }
  }

  /**
   * Re-read a file from disk into its open tab. Used after a workspace-wide
   * replace so the editor never shows stale text.
   */
  async function reloadTab(path: string) {
    const tab = tabs.value.find((t) => t.path === path)
    if (!tab) return false
    try {
      const file = await call<{ path: string; text: string; binary: boolean; size: number }>(
        'read_file',
        { path }
      )
      tab.content = file.text
      tab.savedContent = file.text
      tab.binary = file.binary
      tab.dirty = false
      return true
    } catch {
      return false
    }
  }

  async function closeTab(path: string) {
    const tab = tabs.value.find((t) => t.path === path)
    if (tab?.dirty) {
      const keep = window.confirm(`Discard unsaved changes in ${tab.name}?`)
      if (!keep) return
    }
    const idx = tabs.value.findIndex((t) => t.path === path)
    tabs.value = tabs.value.filter((t) => t.path !== path)
    if (activePath.value === path) {
      const next = tabs.value[Math.max(0, idx - 1)]
      activePath.value = next?.path ?? null
    }
    persistSession()
  }

  function toggleSidebar(view?: SidebarView) {
    if (view && view !== sidebarView.value) {
      sidebarView.value = view
      sidebarVisible.value = true
      return
    }
    if (view) {
      sidebarVisible.value = !sidebarVisible.value
      return
    }
    sidebarVisible.value = !sidebarVisible.value
  }

  function toggleChat() {
    chatOpen.value = !chatOpen.value
  }

  function togglePanel(tab?: 'terminal' | 'problems' | 'output' | 'network') {
    if (tab) {
      if (panelVisible.value && panelTab.value === tab) {
        panelVisible.value = false
        return
      }
      panelTab.value = tab
      panelVisible.value = true
      return
    }
    panelVisible.value = !panelVisible.value
  }

  async function saveSettings(next: Settings) {
    settings.value = next
    applyTheme()
    try {
      await call('save_settings', { settings: next })
      notify('Settings saved', 'success')
    } catch (err) {
      notify(String(err), 'error')
    }
  }

  return {
    workspace,
    settings,
    tabs,
    activePath,
    activeTab,
    sidebarView,
    sidebarVisible,
    chatOpen,
    panelVisible,
    panelTab,
    settingsOpen,
    palette,
    toasts,
    ready,
    loadingFile,
    pendingLine,
    init,
    openFolder,
    closeWorkspace,
    openFile,
    updateContent,
    saveTab,
    reloadTab,
    closeTab,
    toggleSidebar,
    toggleChat,
    togglePanel,
    saveSettings,
    applyTheme,
    notify,
    persistSession
  }
}
