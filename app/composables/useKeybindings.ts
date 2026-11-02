/**
 * Global keymap for the shell. Chorded shortcuts (Ctrl+K …) are supported with
 * a small pending-state machine so they compose with regular bindings.
 */
export function useKeybindings() {
  const ide = useIde()
  const epoch = useTerminalEpoch()
  const browser = useBrowser()
  const database = useDatabase()
  const debug = useDebug()
  const tests = useTests()
  const tasks = useTasks()
  const intel = useCodeIntel()
  const cursor = useState('kudo:cursor', () => ({ line: 1, column: 1, selected: 0 }))
  let chord: string | null = null
  let chordTimer: ReturnType<typeof setTimeout> | null = null

  function isTyping(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    if (!el) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
  }

  function startChord(next: string) {
    chord = next
    if (chordTimer) clearTimeout(chordTimer)
    chordTimer = setTimeout(() => (chord = null), 1400)
  }

  function closeOverlays() {
    if (browser.open.value) {
      browser.hide()
      return true
    }
    if (database.consoleOpen.value) {
      database.consoleOpen.value = false
      return true
    }
    if (intel.dismiss()) return true
    if (ide.palette.value.mode !== 'none') {
      ide.palette.value = { mode: 'none' }
      return true
    }
    if (ide.settingsOpen.value) {
      ide.settingsOpen.value = false
      return true
    }
    return false
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closeOverlays()
      return
    }

    // Code intelligence shortcuts: F2 renames, Shift+F12 finds references.
    if (event.key === 'F2' || (event.key === 'F12' && event.shiftKey)) {
      if (ide.settingsOpen.value || ide.palette.value.mode !== 'none' || intel.anyOpen.value) return
      event.preventDefault()
      if (event.key === 'F2') void intel.openRename()
      else void intel.openReferences()
      return
    }

    // Debugger function keys work without a modifier, so they are handled
    // before the Ctrl/Cmd gate below.
    if (event.key === 'F5' || event.key === 'F9' || event.key === 'F10' || event.key === 'F11') {
      if (ide.settingsOpen.value || ide.palette.value.mode !== 'none' || intel.anyOpen.value) {
        return
      }
      event.preventDefault()
      if (event.key === 'F5') {
        if (event.shiftKey) void debug.stop()
        else void debug.start()
      } else if (event.key === 'F9') {
        const path = ide.activePath.value
        if (path) void debug.toggleBreakpoint(path, cursor.value.line)
      } else if (event.key === 'F10') {
        void debug.step('next')
      } else if (event.shiftKey) {
        void debug.step('stepOut')
      } else {
        void debug.step('stepIn')
      }
      return
    }

    // Shift+Alt+F formats the active buffer without Ctrl, so it is handled
    // before the Ctrl/Cmd gate below.
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'f') {
      if (ide.settingsOpen.value || ide.palette.value.mode !== 'none') return
      event.preventDefault()
      void ide.formatDocument()
      return
    }

    // Shift+Alt+H shows the callers of the symbol under the cursor.
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'h') {
      if (ide.settingsOpen.value || ide.palette.value.mode !== 'none' || intel.anyOpen.value) return
      event.preventDefault()
      void intel.openHierarchy('callers')
      return
    }

    const mod = event.ctrlKey || event.metaKey
    if (!mod) {
      chord = null
      return
    }

    const key = event.key.toLowerCase()
    const shift = event.shiftKey
    const code = event.code

    if (chord === 'k') {
      chord = null
      if (chordTimer) clearTimeout(chordTimer)
      if (key === 'o') {
        event.preventDefault()
        ide.openFolder()
        return
      }
      if (key === 's') {
        event.preventDefault()
        ide.saveTab()
        return
      }
      if (key === 'w') {
        event.preventDefault()
        if (ide.activePath.value) ide.closeTab(ide.activePath.value, ide.activeGroupId.value)
        return
      }
    }

    if (key === '.' || code === 'Period') {
      if (ide.settingsOpen.value || ide.palette.value.mode !== 'none' || intel.anyOpen.value) return
      event.preventDefault()
      void intel.openActions()
      return
    }

    if (shift && key === 'o') {
      if (ide.settingsOpen.value || ide.palette.value.mode !== 'none' || intel.anyOpen.value) return
      event.preventDefault()
      void intel.openSymbols()
      return
    }

    if (key === 't' && !shift) {
      if (ide.settingsOpen.value || ide.palette.value.mode !== 'none' || intel.anyOpen.value) return
      event.preventDefault()
      void intel.openWorkspaceSymbols()
      return
    }

    if (key === 'k' && !shift) {
      event.preventDefault()
      startChord('k')
      return
    }

    if (code === 'Backquote') {
      event.preventDefault()
      if (shift) {
        epoch.value++
        ide.panelTab.value = 'terminal'
        ide.panelVisible.value = true
      } else {
        ide.togglePanel('terminal')
      }
      return
    }

    if (key === 'p') {
      event.preventDefault()
      ide.palette.value = { mode: shift ? 'commands' : 'files' }
      return
    }

    if (shift && key === 'r') {
      event.preventDefault()
      ide.panelTab.value = 'tests'
      ide.panelVisible.value = true
      void tests.runAll()
      return
    }

    if (event.altKey && key === 'b') {
      event.preventDefault()
      ide.panelTab.value = 'tasks'
      ide.panelVisible.value = true
      void tasks.runDefault().then((started) => {
        if (!started) ide.notify('No default build task. Mark one in .kudo/tasks.json.', 'info')
      })
      return
    }

    if (key === 's') {
      event.preventDefault()
      ide.saveTab()
      return
    }

    if (key === 'b' && !shift) {
      event.preventDefault()
      ide.toggleSidebar()
      return
    }

    if (shift && key === 'b') {
      event.preventDefault()
      browser.show()
      return
    }

    if (shift && key === 'd') {
      event.preventDefault()
      ide.sidebarView.value = 'database'
      ide.sidebarVisible.value = true
      return
    }

    if (key === 'j' && !shift) {
      event.preventDefault()
      ide.togglePanel('terminal')
      return
    }

    if (key === '\\' || code === 'Backslash') {
      event.preventDefault()
      ide.toggleSplit()
      return
    }

    if (key === 'w' && !shift) {
      if (isTyping(event.target) && !event.ctrlKey) return
      event.preventDefault()
      if (ide.activePath.value) ide.closeTab(ide.activePath.value, ide.activeGroupId.value)
      return
    }

    if (key === ',') {
      event.preventDefault()
      ide.settingsOpen.value = true
      return
    }

    if (shift && key === 'a') {
      event.preventDefault()
      ide.toggleChat()
      return
    }

    if (shift && key === 'e') {
      event.preventDefault()
      ide.sidebarView.value = 'explorer'
      ide.sidebarVisible.value = true
      return
    }

    if (shift && key === 'f') {
      event.preventDefault()
      ide.sidebarView.value = 'search'
      ide.sidebarVisible.value = true
      return
    }

    if (shift && key === 'g') {
      event.preventDefault()
      ide.sidebarView.value = 'git'
      ide.sidebarVisible.value = true
      return
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
    if (chordTimer) clearTimeout(chordTimer)
  })
}
