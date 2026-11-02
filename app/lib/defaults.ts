import type { Settings } from './types'

/** Fresh-install settings. Shared by `useIde` and preview-only composables. */
export const defaultSettings: Settings = {
  theme: 'kudo-dark',
  accent: '#d4a73c',
  fontFamily: 'JetBrains Mono, Cascadia Code, Consolas, monospace',
  fontSize: 13,
  tabSize: 2,
  wordWrap: false,
  minimap: true,
  terminalShell: 'powershell.exe',
  terminalFontSize: 12,
  restoreSession: true,
  formatOnSave: false,
  lintOnSave: false,
  inlayHints: true,
  semanticHighlighting: true,
  ai: {
    provider: 'demo',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: '',
    temperature: 0.3,
    maxTokens: 4096,
    systemPrompt:
      "You are Kudo's coding agent. Use the provided tools to inspect and edit files in the open workspace.",
    agentMode: true,
    autoApprove: false
  },
  recentWorkspaces: [],
  mcpServers: [],
  updateFeed: '',
  browserHome: 'http://localhost:3000'
}
