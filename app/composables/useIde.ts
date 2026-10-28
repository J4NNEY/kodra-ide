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

export type EditorGroupId = 'main' | 'side'

export interface EditorGroup {
  id: EditorGroupId
  paths: string[]
  active: string | null
}

function freshGroups(): EditorGroup[] {
  return [{ id: 'main', paths: [], active: null }]
}

interface StoredSession {
  tabs?: string[]
  active?: string | null
  groups?: Array<{ id?: string; paths?: string[]; active?: string | null }>
  activeGroup?: string
}

export function useIde() {
  const workspace = useState<WorkspaceInfo | null>('kudo:workspace', () => null)
  const settings = useState<Settings>('kudo:settings', () => structuredClone(defaultSettings))
  const tabs = useState<EditorTab[]>('kudo:tabs', () => [])
  const groups = useState<EditorGroup[]>('kudo:editor-groups', () => freshGroups())
  const activeGroupId = useState<EditorGroupId>('kudo:editor-active-group', () => 'main')
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

  const splitOpen = computed(() => groups.value.length > 1)
  const activeGroup = computed(
    () => groups.value.find((g) => g.id === activeGroupId.value) ?? groups.value[0] ?? null
  )
  /** The focused pane's file. Writing switches the focused pane's active tab. */
  const activePath = computed<string | null>({
    get: () => activeGroup.value?.active ?? null,
    set: (path) => {
      const group = activeGroup.value
      if (group) group.active = path
    }
  })
  const activeTab = computed(() => tabs.value.find((t) => t.path === activePath.value) ?? null)

  function groupFor(id: EditorGroupId) {
    return groups.value.find((g) => g.id === id) ?? null
  }

  function groupTabs(id: EditorGroupId): EditorTab[] {
    const group = groupFor(id)
    if (!group) return []
    return group.paths
      .map((path) => tabs.value.find((t) => t.path === path))
      .filter((tab): tab is EditorTab => !!tab)
  }

  function focusGroup(id: EditorGroupId) {
    if (groupFor(id)) activeGroupId.value = id
  }

  function resetGroups() {
    groups.value = freshGroups()
    activeGroupId.value = 'main'
  }

  /** Remove a path from one pane and fix up that pane's active tab. */
  function detachFromGroup(group: EditorGroup, path: string) {
    const index = group.paths.indexOf(path)
    if (index < 0) return
    group.paths.splice(index, 1)
    if (group.active === path) group.active = group.paths[Math.max(0, index - 1)] ?? null
  }

  function attachToGroup(group: EditorGroup, path: string) {
    if (!group.paths.includes(path)) group.paths.push(path)
    group.active = path
    activeGroupId.value = group.id
  }

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
          const session = JSON.parse(raw) as StoredSession
          const wanted = [
            ...new Set([
              ...(session.tabs ?? []),
              ...(session.groups ?? []).flatMap((group) => group.paths ?? [])
            ])
          ]
          for (const path of wanted) {
            await openFile(path, undefined, true).catch(() => {})
          }
          restoreGroups(session)
        }
      } catch {
        /* ignore */
      }
    }
    ready.value = true
  }

  /** Rebuild panes from the stored session, dropping files that failed to load. */
  function restoreGroups(session: StoredSession) {
    const present = new Set(tabs.value.map((t) => t.path))
    const stored = session.groups ?? []
    if (!stored.length) {
      const active =
        session.active && present.has(session.active) ? session.active : tabs.value[0]?.path ?? null
      groups.value = [{ id: 'main', paths: tabs.value.map((t) => t.path), active }]
      activeGroupId.value = 'main'
      persistSession()
      return
    }

    const main = stored.find((group) => group.id === 'main')
    const side = stored.find((group) => group.id === 'side')
    const mainGroup: EditorGroup = {
      id: 'main',
      paths: (main?.paths ?? []).filter((path) => present.has(path)),
      active: null
    }
    // Tabs that were open but not listed in a pane belong to the main pane.
    const referenced = new Set([...(main?.paths ?? []), ...(side?.paths ?? [])])
    for (const path of present) {
      if (!referenced.has(path)) mainGroup.paths.push(path)
    }
    mainGroup.active =
      main?.active && mainGroup.paths.includes(main.active)
        ? main.active
        : mainGroup.paths[0] ?? null

    const next: EditorGroup[] = [mainGroup]
    if (side) {
      const sidePaths = (side.paths ?? []).filter((path) => present.has(path))
      next.push({
        id: 'side',
        paths: sidePaths,
        active:
          side.active && sidePaths.includes(side.active) ? side.active : sidePaths[0] ?? null
      })
    }
    groups.value = next
    activeGroupId.value = session.activeGroup === 'side' && next.length > 1 ? 'side' : 'main'
    persistSession()
  }

  function persistSession() {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(
      'kudo:session',
      JSON.stringify({
        tabs: tabs.value.map((t) => t.path),
        active: activePath.value,
        groups: groups.value.map((group) => ({
          id: group.id,
          paths: [...group.paths],
          active: group.active
        })),
        activeGroup: activeGroupId.value
      })
    )
  }

  async function openFolder(path?: string) {
    const target = path ?? (await pickFolder())
    if (!target) return
    try {
      const info = await call<WorkspaceInfo>('open_workspace', { path: target })
      workspace.value = info
      tabs.value = []
      resetGroups()
      persistSession()
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
    resetGroups()
    persistSession()
    notify('Workspace closed')
  }

  async function openFile(path: string, line?: number, quiet = false) {
    if (!path) return
    const existing = tabs.value.find((t) => t.path === path)
    if (existing) {
      // Reveal the file in whichever pane already owns it, otherwise the focused pane.
      const target =
        groups.value.find((group) => group.paths.includes(path)) ??
        activeGroup.value ??
        groups.value[0]
      if (target) attachToGroup(target, path)
      if (line) pendingLine.value = { path, line }
      persistSession()
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
      const target = activeGroup.value ?? groups.value[0]
      if (target) attachToGroup(target, path)
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

  async function closeTab(path: string, groupId?: EditorGroupId) {
    const tab = tabs.value.find((t) => t.path === path)
    if (tab?.dirty) {
      const keep = window.confirm(`Discard unsaved changes in ${tab.name}?`)
      if (!keep) return
    }
    if (groupId) {
      const group = groupFor(groupId)
      if (!group) return
      detachFromGroup(group, path)
      // A file mirrored in another pane stays open there.
      if (!groups.value.some((item) => item.paths.includes(path))) {
        tabs.value = tabs.value.filter((t) => t.path !== path)
      }
    } else {
      tabs.value = tabs.value.filter((t) => t.path !== path)
      for (const group of groups.value) detachFromGroup(group, path)
    }
    if (!tabs.value.length) resetGroups()
    persistSession()
  }

  /** Close several tabs at once (checkpoint restores recreate deleted files). */
  function removeTabs(paths: string[]) {
    if (!paths.length) return
    const closing = new Set(paths)
    tabs.value = tabs.value.filter((tab) => !closing.has(tab.path))
    for (const group of groups.value) {
      for (const path of paths) detachFromGroup(group, path)
    }
    if (!tabs.value.length) resetGroups()
    persistSession()
  }

  /** Duplicate the focused file into a second pane and focus it. */
  function splitEditor() {
    if (splitOpen.value) return
    const path = activePath.value
    if (!path) return
    groups.value = [
      ...groups.value,
      { id: 'side', paths: [path], active: path }
    ]
    activeGroupId.value = 'side'
    persistSession()
  }

  /** Merge the side pane back into the main pane. */
  function closeSplit() {
    if (!splitOpen.value) return
    const focusedSide = activeGroupId.value === 'side'
    const main = groupFor('main')
    const side = groupFor('side')
    if (main && side) {
      for (const path of side.paths) {
        if (!main.paths.includes(path)) main.paths.push(path)
      }
      // Keep the file the user was working on if the side pane had focus.
      if ((focusedSide && side.active) || !main.active) main.active = side.active ?? main.active
    }
    groups.value = groups.value.filter((group) => group.id === 'main')
    if (!groups.value.length) groups.value = freshGroups()
    activeGroupId.value = 'main'
    persistSession()
  }

  function toggleSplit() {
    if (splitOpen.value) closeSplit()
    else splitEditor()
  }

  /** Move a tab between panes, keeping the flat tab pool unchanged. */
  function moveTab(path: string, fromId: EditorGroupId, toId: EditorGroupId) {
    if (fromId === toId) {
      activateTab(toId, path)
      return
    }
    const from = groupFor(fromId)
    const to = groupFor(toId)
    if (!from || !to) return
    detachFromGroup(from, path)
    attachToGroup(to, path)
    persistSession()
  }

  /** Palette: move the focused editor to the opposite pane (or open the split). */
  function moveActiveToOtherPane() {
    const path = activePath.value
    if (!path) return
    if (!splitOpen.value) {
      splitEditor()
      return
    }
    const from = activeGroup.value
    if (!from) return
    moveTab(path, from.id, from.id === 'main' ? 'side' : 'main')
  }

  function activateTab(groupId: EditorGroupId, path: string) {
    const group = groupFor(groupId)
    if (!group || !tabs.value.some((tab) => tab.path === path)) return
    attachToGroup(group, path)
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
    groups,
    activeGroupId,
    activeGroup,
    splitOpen,
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
    removeTabs,
    splitEditor,
    closeSplit,
    toggleSplit,
    moveTab,
    moveActiveToOtherPane,
    activateTab,
    focusGroup,
    groupTabs,
    toggleSidebar,
    toggleChat,
    togglePanel,
    saveSettings,
    applyTheme,
    notify,
    persistSession
  }
}
