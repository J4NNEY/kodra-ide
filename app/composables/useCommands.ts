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
  const debug = useDebug()
  const tests = useTests()
  const tasks = useTasks()
  const format = useFormat()
  const intel = useCodeIntel()
  const lsp = useLsp()
  const cursor = useState('kudo:cursor', () => ({ line: 1, column: 1, selected: 0 }))
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
      id: 'view.debug',
      label: 'View: Run and Debug',
      group: 'View',
      hint: 'F5',
      run: () => (ide.sidebarView.value = 'debug', (ide.sidebarVisible.value = true))
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
      id: 'debug.start',
      label: 'Debug: Start / Continue',
      group: 'Debug',
      hint: 'F5',
      run: () => debug.start()
    },
    {
      id: 'debug.stop',
      label: 'Debug: Stop',
      group: 'Debug',
      hint: 'Shift+F5',
      run: () => debug.stop()
    },
    {
      id: 'debug.pause',
      label: 'Debug: Pause',
      group: 'Debug',
      run: () => debug.pause()
    },
    {
      id: 'debug.restart',
      label: 'Debug: Restart',
      group: 'Debug',
      run: () => debug.restart()
    },
    {
      id: 'debug.step-over',
      label: 'Debug: Step Over',
      group: 'Debug',
      hint: 'F10',
      run: () => debug.step('next')
    },
    {
      id: 'debug.step-into',
      label: 'Debug: Step Into',
      group: 'Debug',
      hint: 'F11',
      run: () => debug.step('stepIn')
    },
    {
      id: 'debug.step-out',
      label: 'Debug: Step Out',
      group: 'Debug',
      hint: 'Shift+F11',
      run: () => debug.step('stepOut')
    },
    {
      id: 'debug.toggle-breakpoint',
      label: 'Debug: Toggle Breakpoint',
      group: 'Debug',
      hint: 'F9',
      run: () => {
        const path = ide.activePath.value
        if (path) void debug.toggleBreakpoint(path, cursor.value.line)
      }
    },
    {
      id: 'debug.clear-breakpoints',
      label: 'Debug: Remove All Breakpoints',
      group: 'Debug',
      run: () => debug.clearBreakpoints()
    },
    {
      id: 'tests.show',
      label: 'Test: Show Test Explorer',
      group: 'Test',
      run: () => {
        ide.sidebarView.value = 'tests'
        ide.sidebarVisible.value = true
      }
    },
    {
      id: 'tests.run-all',
      label: 'Test: Run All Tests',
      group: 'Test',
      hint: 'Ctrl+Shift+R',
      run: () => {
        ide.panelTab.value = 'tests'
        ide.panelVisible.value = true
        return tests.runAll()
      }
    },
    {
      id: 'tests.run-file',
      label: 'Test: Run Tests in Active File',
      group: 'Test',
      run: () => {
        const path = ide.activePath.value
        const file = path ? tests.fileFor(path) : null
        if (!file) {
          ide.notify('No tests detected in this file')
          return
        }
        ide.panelTab.value = 'tests'
        ide.panelVisible.value = true
        return tests.runFile(file)
      }
    },
    {
      id: 'tests.cancel',
      label: 'Test: Cancel Test Run',
      group: 'Test',
      run: () => tests.cancel()
    },
    {
      id: 'tests.refresh',
      label: 'Test: Refresh Test Explorer',
      group: 'Test',
      run: () => tests.detect()
    },
    {
      id: 'tasks.show',
      label: 'Task: Show Task Explorer',
      group: 'Task',
      run: () => {
        ide.sidebarView.value = 'tasks'
        ide.sidebarVisible.value = true
      }
    },
    {
      id: 'tasks.run-default',
      label: 'Task: Run Build Task',
      group: 'Task',
      hint: 'Ctrl+Alt+B',
      run: async () => {
        ide.panelTab.value = 'tasks'
        ide.panelVisible.value = true
        const started = await tasks.runDefault()
        if (!started) ide.notify('No default build task. Mark one in .kudo/tasks.json.', 'info')
      }
    },
    {
      id: 'tasks.run-last',
      label: 'Task: Run Last Task',
      group: 'Task',
      run: async () => {
        ide.panelTab.value = 'tasks'
        ide.panelVisible.value = true
        const started = await tasks.runLast()
        if (!started) ide.notify('No task to run yet.', 'info')
      }
    },
    {
      id: 'tasks.stop',
      label: 'Task: Stop Running Task',
      group: 'Task',
      run: () => tasks.stop()
    },
    {
      id: 'tasks.refresh',
      label: 'Task: Refresh Task Explorer',
      group: 'Task',
      run: () => tasks.detect()
    },
    {
      id: 'format.document',
      label: 'Format: Format Document',
      group: 'Format',
      hint: 'Shift+Alt+F',
      run: () => ide.formatDocument()
    },
    {
      id: 'format.lint',
      label: 'Format: Lint Active File',
      group: 'Format',
      run: () => ide.lintDocument()
    },
    {
      id: 'format.toggle-on-save',
      label: 'Format: Toggle Format On Save',
      group: 'Format',
      run: async () => {
        const on = await format.toggleFormatOnSave()
        ide.notify(`Format on save ${on ? 'enabled' : 'disabled'}`, 'info')
      }
    },
    {
      id: 'format.toggle-lint-on-save',
      label: 'Format: Toggle Lint On Save',
      group: 'Format',
      run: async () => {
        const on = await format.toggleLintOnSave()
        ide.notify(`Lint on save ${on ? 'enabled' : 'disabled'}`, 'info')
      }
    },
    {
      id: 'format.refresh',
      label: 'Format: Refresh Formatter Toolchain',
      group: 'Format',
      run: async () => {
        const found = await format.detect()
        const list = found.filter((tool) => tool.path).map((tool) => tool.label)
        ide.notify(
          list.length ? `Formatters and linters: ${list.join(', ')}` : 'No formatters or linters found',
          list.length ? 'success' : 'info'
        )
      }
    },
    {
      id: 'code.rename',
      label: 'Code: Rename Symbol',
      group: 'Code',
      hint: 'F2',
      run: () => intel.openRename()
    },
    {
      id: 'code.references',
      label: 'Code: Find All References',
      group: 'Code',
      hint: 'Shift+F12',
      run: () => intel.openReferences()
    },
    {
      id: 'code.symbols',
      label: 'Code: Go to Symbol in File…',
      group: 'Code',
      hint: 'Ctrl+Shift+O',
      run: () => intel.openSymbols()
    },
    {
      id: 'code.actions',
      label: 'Code: Quick Fix / Code Actions',
      group: 'Code',
      hint: 'Ctrl+.',
      run: () => intel.openActions()
    },
    {
      id: 'code.restart',
      label: 'Code: Restart Language Servers',
      group: 'Code',
      run: async () => {
        lsp.reset()
        const found = await lsp.detect()
        const list = Object.keys(found)
        ide.notify(
          list.length
            ? `Language servers detected: ${list.join(', ')}`
            : 'No language servers detected',
          list.length ? 'success' : 'info'
        )
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
