export interface Command {
  id: string
  label: string
  group: string
  hint?: string
  run: () => void | Promise<void>
}

function cloneSettings<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function useTerminalEpoch() {
  return useState<number>('kudo:terminal-epoch', () => 0)
}

export function useCommands() {
  const ide = useIde()
  const chat = useChat()
  const epoch = useTerminalEpoch()
  const browser = useBrowser()
  const database = useDatabase()
  const extensions = useExtensions()
  const themes = useThemes()

  /** Snippet commands are rebuilt on every access so late-loaded extensions appear. */
  const snippetCommands = (): Command[] =>
    extensions.snippets.value.map((snippet, index) => ({
      id: `snippet.${snippet.extensionFolder}.${index}`,
      label: `Snippet: ${snippet.prefix}${snippet.description ? ` — ${snippet.description}` : ''}`,
      group: snippet.extension ?? 'Snippets',
      hint: 'insert',
      run: () => {
        extensions.applySnippet(snippet)
      }
    }))

  const commands = computed<Command[]>(() => {
    const items: Command[] = [
    {
      id: 'file.open-folder',
      label: 'Open Folder…',
      group: 'File',
      hint: 'Ctrl+K O',
      run: () => ide.openFolder()
    },
    {
      id: 'file.save',
      label: 'Save File',
      group: 'File',
      hint: 'Ctrl+S',
      run: () => ide.saveTab()
    },
    {
      id: 'file.close-tab',
      label: 'Close Editor',
      group: 'File',
      hint: 'Ctrl+W',
      run: () => {
        if (ide.activePath.value) ide.closeTab(ide.activePath.value, ide.activeGroupId.value)
      }
    },
    {
      id: 'file.close-workspace',
      label: 'Close Workspace',
      group: 'File',
      run: () => ide.closeWorkspace()
    },
    {
      id: 'view.explorer',
      label: 'View: Explorer',
      group: 'View',
      hint: 'Ctrl+Shift+E',
      run: () => (ide.sidebarView.value = 'explorer', (ide.sidebarVisible.value = true))
    },
    {
      id: 'view.search',
      label: 'View: Search',
      group: 'View',
      hint: 'Ctrl+Shift+F',
      run: () => (ide.sidebarView.value = 'search', (ide.sidebarVisible.value = true))
    },
    {
      id: 'view.git',
      label: 'View: Source Control',
      group: 'View',
      hint: 'Ctrl+Shift+G',
      run: () => (ide.sidebarView.value = 'git', (ide.sidebarVisible.value = true))
    },
    {
      id: 'view.agent',
      label: 'View: Agent',
      group: 'View',
      run: () => (ide.sidebarView.value = 'agent', (ide.sidebarVisible.value = true))
    },
    {
      id: 'view.database',
      label: 'View: Database',
      group: 'View',
      hint: 'Ctrl+Shift+D',
      run: () => (ide.sidebarView.value = 'database', (ide.sidebarVisible.value = true))
    },
    {
      id: 'view.skills',
      label: 'View: Skills',
      group: 'View',
      run: () => (ide.sidebarView.value = 'skills', (ide.sidebarVisible.value = true))
    },
    {
      id: 'view.docker',
      label: 'View: Docker',
      group: 'View',
      run: () => (ide.sidebarView.value = 'docker', (ide.sidebarVisible.value = true))
    },
    {
      id: 'view.mcp',
      label: 'View: MCP Servers',
      group: 'View',
      run: () => (ide.sidebarView.value = 'mcp', (ide.sidebarVisible.value = true))
    },
    {
      id: 'view.extensions',
      label: 'View: Extensions',
      group: 'View',
      run: () => (ide.sidebarView.value = 'extensions', (ide.sidebarVisible.value = true))
    },
    {
      id: 'browser.open',
      label: 'Browser: Open Preview',
      group: 'Browser',
      hint: 'Ctrl+Shift+B',
      run: () => browser.show()
    },
    {
      id: 'browser.localhost',
      label: 'Browser: Preview localhost:3000',
      group: 'Browser',
      run: () => browser.show('http://localhost:3000')
    },
    {
      id: 'database.console',
      label: 'Database: Open SQL Console',
      group: 'Database',
      run: () => {
        ide.sidebarView.value = 'database'
        ide.sidebarVisible.value = true
        database.consoleOpen.value = true
      }
    },
    {
      id: 'view.network',
      label: 'View: Network Log',
      group: 'View',
      run: () => ide.togglePanel('network')
    },
    {
      id: 'view.toggle-sidebar',
      label: 'Toggle Sidebar',
      group: 'View',
      hint: 'Ctrl+B',
      run: () => ide.toggleSidebar()
    },
    {
      id: 'view.toggle-terminal',
      label: 'Toggle Terminal',
      group: 'View',
      hint: 'Ctrl+`',
      run: () => ide.togglePanel('terminal')
    },
    {
      id: 'view.split-editor',
      label: 'View: Split Editor',
      group: 'View',
      hint: 'Ctrl+\\',
      run: () => ide.splitEditor()
    },
    {
      id: 'view.close-split',
      label: 'View: Close Split',
      group: 'View',
      hint: 'Ctrl+\\',
      run: () => ide.closeSplit()
    },
    {
      id: 'view.move-editor',
      label: 'View: Move Editor to Other Pane',
      group: 'View',
      run: () => ide.moveActiveToOtherPane()
    },
    {
      id: 'view.toggle-agent',
      label: 'Toggle Agent Panel',
      group: 'View',
      hint: 'Ctrl+Shift+A',
      run: () => ide.toggleChat()
    },
    {
      id: 'view.settings',
      label: 'Open Settings',
      group: 'Preferences',
      hint: 'Ctrl+,',
      run: () => (ide.settingsOpen.value = true)
    },
    {
      id: 'view.theme',
      label: 'Toggle Light / Dark Theme',
      group: 'Preferences',
      run: () => {
        const next = cloneSettings(ide.settings.value)
        const light = themes.active.value.kind === 'light'
        const target = themes.byId(light ? 'kudo-dark' : 'kudo-light')
        next.theme = target.id
        next.accent = target.colors.accent
        ide.saveSettings(next)
      }
    },
    {
      id: 'terminal.new',
      label: 'Terminal: New Session',
      group: 'Terminal',
      hint: 'Ctrl+Shift+`',
      run: () => {
        epoch.value++
        ide.panelTab.value = 'terminal'
        ide.panelVisible.value = true
      }
    },
    {
      id: 'terminal.clear',
      label: 'Terminal: Clear Buffer',
      group: 'Terminal',
      run: () => {
        window.dispatchEvent(new CustomEvent('kudo:terminal-clear'))
      }
    },
    {
      id: 'terminal.close',
      label: 'Terminal: Close Active Session',
      group: 'Terminal',
      run: () => {
        window.dispatchEvent(new CustomEvent('kudo:terminal-close'))
      }
    },
    {
      id: 'agent.new',
      label: 'Agent: New Chat',
      group: 'Agent',
      run: () => {
        chat.clear()
        ide.chatOpen.value = true
      }
    },
    {
      id: 'agent.focus',
      label: 'Agent: Focus Composer',
      group: 'Agent',
      run: () => {
        ide.chatOpen.value = true
        window.dispatchEvent(new CustomEvent('kudo:focus-composer'))
      }
    },
    {
      id: 'agent.toggle-tools',
      label: 'Agent: Toggle Tool Calling',
      group: 'Agent',
      run: () => {
        const next = cloneSettings(ide.settings.value)
        next.ai.agentMode = !next.ai.agentMode
        ide.saveSettings(next)
      }
    },
    {
      id: 'go.files',
      label: 'Go to File…',
      group: 'Navigation',
      hint: 'Ctrl+P',
      run: () => (ide.palette.value = { mode: 'files' })
    },
    {
      id: 'help.about',
      label: 'About Kudo',
      group: 'Help',
      run: () => (ide.settingsOpen.value = true)
    },
    {
      id: 'help.updates',
      label: 'Check for Updates…',
      group: 'Help',
      run: () => {
        useState<string>('kudo:settings-tab').value = 'about'
        ide.settingsOpen.value = true
      }
    }
  ]
    items.push(...snippetCommands())
    return items
  })

  function filter(query: string): Command[] {
    const q = query.trim().toLowerCase()
    if (!q) return commands.value
    const terms = q.split(/\s+/)
    return commands.value
      .map((command) => {
        const haystack = `${command.label} ${command.group} ${command.hint ?? ''}`.toLowerCase()
        let score = 0
        for (const term of terms) {
          const idx = haystack.indexOf(term)
          if (idx < 0) return { command, score: -1 }
          score += idx === 0 ? 4 : 1
        }
        if (haystack.startsWith(q)) score += 6
        return { command, score }
      })
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.command)
  }

  return { commands, filter }
}
