<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Bot,
  Check,
  Cpu,
  Download,
  Info,
  Keyboard,
  Loader2,
  Monitor,
  Palette,
  Blocks,
  RotateCcw,
  Save,
  SquareTerminal,
  X
} from 'lucide-vue-next'
import type { Settings, TerminalShellInfo, UpdateCheck } from '../lib/types'
import type { Theme } from '../lib/themes'
import { call } from '../lib/api'

const ide = useIde()
const lsp = useLsp()
const format = useFormat()
const themes = useThemes()
const extensions = useExtensions()
const settingsTab = useState<string>('kudo:settings-tab', () => 'appearance')

interface AppInfo {
  name: string
  version: string
  platform: string
  arch: string
  configDir: string
}

const draft = ref<Settings>(JSON.parse(JSON.stringify(ide.settings.value)))
const models = ref<string[]>([])
const probing = ref(false)
const saving = ref(false)
const appInfo = ref<AppInfo | null>(null)

const checking = ref(false)
const updateInfo = ref<UpdateCheck | null>(null)
const updateError = ref('')
const downloading = ref(false)
const downloaded = ref<{ path: string; bytes: number; fileName: string } | null>(null)

const accents = ['#d4a73c', '#6cb6ff', '#73c991', '#c792ea', '#e4676b', '#e2a03f']

const tabs = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'editor', label: 'Editor', icon: Cpu },
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
  { id: 'ai', label: 'Agent', icon: Bot },
  { id: 'integrations', label: 'Integrations', icon: Blocks },
  { id: 'keys', label: 'Keys', icon: Keyboard },
  { id: 'about', label: 'About', icon: Info }
]

const shellFallbacks = ['powershell.exe', 'pwsh.exe', 'cmd.exe', 'wsl.exe', 'bash', 'zsh']
const shells = ref<TerminalShellInfo[]>([])
const shellChoices = computed(() =>
  shells.value.length
    ? shells.value
    : shellFallbacks.map((shell) => ({
        id: shell,
        label: shell,
        path: shell,
        isDefault: false
      }))
)

/** Settings may hold a bare command (`powershell.exe`) or a full path. */
function isShellSelected(path: string) {
  const name = (value: string) => value.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  return name(draft.value.terminalShell) === name(path)
}

const shortcuts = [
  { keys: 'Ctrl+P', action: 'Go to file' },
  { keys: 'Ctrl+Shift+P', action: 'Command palette' },
  { keys: 'Ctrl+S', action: 'Save active file' },
  { keys: 'Ctrl+B', action: 'Toggle sidebar' },
  { keys: 'Ctrl+`', action: 'Toggle terminal' },
  { keys: 'Ctrl+Shift+A', action: 'Toggle agent panel' },
  { keys: 'Ctrl+W', action: 'Close editor' },
  { keys: 'Ctrl+,', action: 'Open settings' },
  { keys: 'Ctrl+Shift+E', action: 'Explorer' },
  { keys: 'Ctrl+Shift+F', action: 'Search' },
  { keys: 'Ctrl+Shift+G', action: 'Source control' },
  { keys: 'Ctrl+Shift+`', action: 'New terminal' }
]

const canSave = computed(() => JSON.stringify(draft.value) !== JSON.stringify(ide.settings.value))

function close() {
  ide.settingsOpen.value = false
}

function chooseAccent(color: string) {
  draft.value.accent = color
}

function chooseTheme(id: string) {
  draft.value.theme = id
  if (id !== 'system') draft.value.accent = themes.byId(id).colors.accent.toLowerCase()
}

const themeOptions = computed(() => themes.all.value)

/** Four representative syntax colours for the theme thumbnail. */
function syntaxPreview(theme: Theme): string[] {
  const keys = ['keyword', 'string', 'function', 'number'] as const
  return keys.map((key) => theme.syntax[key]?.color ?? theme.colors.text)
}

function openExtensions() {
  ide.settingsOpen.value = false
  ide.sidebarView.value = 'extensions'
  ide.sidebarVisible.value = true
  void extensions.load()
}

async function save() {
  saving.value = true
  try {
    await ide.saveSettings(draft.value)
    close()
  } finally {
    saving.value = false
  }
}

async function reset() {
  if (!window.confirm('Reset every setting back to its default value?')) return
  try {
    const fresh = await call<Settings>('reset_settings')
    draft.value = { ...fresh, recentWorkspaces: fresh.recentWorkspaces ?? [] }
    ide.settings.value = draft.value
    ide.applyTheme()
    ide.notify('Settings reset', 'success')
  } catch (err) {
    ide.notify(String(err), 'error')
  }
}

async function probe() {
  probing.value = true
  models.value = []
  try {
    const list = await call<string[]>('ai_probe', {
      baseUrl: draft.value.ai.baseUrl,
      apiKey: draft.value.ai.apiKey
    })
    models.value = list ?? []
    ide.notify(`Provider reachable — ${models.value.length} models`, 'success')
  } catch (err) {
    ide.notify(String(err), 'error')
  } finally {
    probing.value = false
  }
}

async function removeRecent(path: string) {
  try {
    const next = await call<Settings>('remove_recent_workspace', { path })
    ide.settings.value = { ...ide.settings.value, ...next }
    draft.value.recentWorkspaces = next.recentWorkspaces
    ide.notify('Removed from recents', 'success')
  } catch (err) {
    ide.notify(String(err), 'error')
  }
}

async function checkUpdates() {
  checking.value = true
  updateError.value = ''
  updateInfo.value = null
  downloaded.value = null
  try {
    updateInfo.value = await call<UpdateCheck>('update_check', {
      feedUrl: draft.value.updateFeed,
      current: appInfo.value?.version ?? '0.10.0'
    })
    if (!updateInfo.value.available) ide.notify('Kudo is up to date', 'success')
  } catch (err) {
    updateError.value = String(err)
  } finally {
    checking.value = false
  }
}

async function downloadUpdate() {
  if (!updateInfo.value?.url) return
  downloading.value = true
  updateError.value = ''
  try {
    downloaded.value = await call('update_download', {
      url: updateInfo.value.url,
      fileName: updateInfo.value.url.split('/').pop()
    })
    ide.notify('Installer downloaded', 'success')
  } catch (err) {
    updateError.value = String(err)
  } finally {
    downloading.value = false
  }
}

async function installUpdate() {
  if (!downloaded.value) return
  try {
    await call('update_install', { path: downloaded.value.path })
    ide.notify('Installer launched', 'success')
  } catch (err) {
    updateError.value = String(err)
  }
}

async function revealUpdate() {
  if (!downloaded.value) return
  try {
    await call('update_reveal', { path: downloaded.value.path })
  } catch (err) {
    updateError.value = String(err)
  }
}

watch(
  () => ide.settingsOpen.value,
  async (open) => {
    if (!open) {
      ide.applyTheme()
      return
    }
    draft.value = JSON.parse(JSON.stringify(ide.settings.value))
    models.value = []
    if (!shells.value.length) {
      shells.value = await call<TerminalShellInfo[]>('terminal_shells').catch(() => [])
    }
    if (!appInfo.value) {
      appInfo.value = await call<AppInfo>('app_info').catch(() => null)
    }
  }
)

watch(
  () => [draft.value.theme, draft.value.accent, draft.value.fontSize, draft.value.fontFamily],
  () => {
    if (!ide.settingsOpen.value || typeof document === 'undefined') return
    themes.preview(draft.value.theme, draft.value.accent)
    document.documentElement.style.setProperty('--fs-mono', `${draft.value.fontSize}px`)
    document.documentElement.style.setProperty('--font-mono', draft.value.fontFamily)
  }
)
</script>

<template>
  <Teleport to="body">
    <div v-if="ide.settingsOpen.value" class="overlay" @click.self="close">
      <div class="modal settings-modal">
        <div class="modal-head">
          <h2>Settings</h2>
          <span class="hint">Kudo {{ appInfo?.version ?? '0.10.0' }}</span>
          <div style="flex: 1" />
          <button class="icon-btn" @click="close"><X :size="15" /></button>
        </div>

        <div class="settings-body">
          <nav class="settings-nav">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              :class="{ active: settingsTab === tab.id }"
              @click="settingsTab = tab.id"
            >
              <component :is="tab.icon" :size="14" />
              {{ tab.label }}
            </button>
          </nav>

          <div class="settings-pane">
            <template v-if="settingsTab === 'appearance'">
              <div class="pane-title">Appearance</div>

              <div class="field">
                <div class="field-head">
                  <label>Theme</label>
                  <button class="link-btn" @click="openExtensions">
                    <Blocks :size="12" /> Manage extensions
                  </button>
                </div>
                <div class="theme-grid">
                  <button
                    class="theme-card"
                    :class="{ active: draft.theme === 'system' }"
                    @click="chooseTheme('system')"
                  >
                    <span class="theme-preview system">
                      <span class="theme-preview-bar" />
                      <Monitor :size="14" />
                    </span>
                    <span class="theme-card-label">System</span>
                    <span class="theme-card-meta">Follows Windows</span>
                    <Check v-if="draft.theme === 'system'" class="theme-check" :size="13" />
                  </button>

                  <button
                    v-for="theme in themeOptions"
                    :key="theme.id"
                    class="theme-card"
                    :class="{ active: draft.theme === theme.id }"
                    @click="chooseTheme(theme.id)"
                  >
                    <span
                      class="theme-preview"
                      :style="{ background: theme.colors.surface1, borderColor: theme.colors.borderStrong }"
                    >
                      <span class="theme-preview-bar" :style="{ background: theme.colors.surface3 }" />
                      <span class="theme-syntax">
                        <i
                          v-for="(style, index) in syntaxPreview(theme)"
                          :key="index"
                          :style="{ background: style }"
                        />
                      </span>
                      <span class="theme-accent" :style="{ background: theme.colors.accent }" />
                    </span>
                    <span class="theme-card-label">{{ theme.name }}</span>
                    <span class="theme-card-meta">
                      {{ theme.extension ? 'Extension' : theme.kind === 'light' ? 'Light' : 'Dark' }}
                    </span>
                    <Check v-if="draft.theme === theme.id" class="theme-check" :size="13" />
                  </button>
                </div>
                <span class="hint">Changes preview live; press Save to persist.</span>
              </div>

              <div class="field">
                <label>Accent colour</label>
                <div class="swatches">
                  <button
                    v-for="color in accents"
                    :key="color"
                    class="swatch"
                    :class="{ active: draft.accent.toLowerCase() === color }"
                    :style="{ background: color }"
                    :title="color"
                    @click="chooseAccent(color)"
                  >
                    <Check v-if="draft.accent.toLowerCase() === color" :size="12" />
                  </button>
                  <input v-model="draft.accent" type="color" class="color-input" title="Custom colour" />
                </div>
              </div>

              <div class="field">
                <label>Interface scale</label>
                <div class="row">
                  <input
                    v-model.number="draft.fontSize"
                    type="range"
                    min="11"
                    max="18"
                    step="1"
                    class="range"
                  />
                  <span class="mono">{{ draft.fontSize }}px</span>
                </div>
                <span class="hint">Controls the editor font size.</span>
              </div>

              <div class="field">
                <label>Editor font</label>
                <input v-model="draft.fontFamily" class="input" spellcheck="false" />
                <span class="hint">Any installed font family; falls back to Consolas.</span>
              </div>
            </template>

            <template v-else-if="settingsTab === 'editor'">
              <div class="pane-title">Editor</div>

              <div class="field">
                <label>Tab size</label>
                <div class="segment" style="max-width: 240px">
                  <button
                    v-for="size in [2, 4, 8]"
                    :key="size"
                    :class="{ active: draft.tabSize === size }"
                    @click="draft.tabSize = size"
                  >
                    {{ size }}
                  </button>
                </div>
              </div>

              <div class="field toggle-field">
                <div>
                  <label>Word wrap</label>
                  <span class="hint">Wrap long lines at the viewport edge.</span>
                </div>
                <button class="switch" :class="{ on: draft.wordWrap }" @click="draft.wordWrap = !draft.wordWrap" />
              </div>

              <div class="field toggle-field">
                <div>
                  <label>Minimap</label>
                  <span class="hint">Reserved for the upcoming canvas renderer.</span>
                </div>
                <button class="switch" :class="{ on: draft.minimap }" @click="draft.minimap = !draft.minimap" />
              </div>

              <div class="field toggle-field">
                <div>
                  <label>Restore session</label>
                  <span class="hint">Reopen previously edited files on launch.</span>
                </div>
                <button
                  class="switch"
                  :class="{ on: draft.restoreSession }"
                  @click="draft.restoreSession = !draft.restoreSession"
                />
              </div>

              <div class="field toggle-field">
                <div>
                  <label>Format on save</label>
                  <span class="hint">
                    Run Prettier, gofmt, rustfmt or Black before the file is written.
                  </span>
                </div>
                <button
                  class="switch format-on-save-switch"
                  :class="{ on: draft.formatOnSave }"
                  @click="draft.formatOnSave = !draft.formatOnSave"
                />
              </div>

              <div class="field toggle-field">
                <div>
                  <label>Lint on save</label>
                  <span class="hint">
                    Run ESLint or Ruff after saving; problems land in the Problems panel.
                  </span>
                </div>
                <button
                  class="switch lint-on-save-switch"
                  :class="{ on: draft.lintOnSave }"
                  @click="draft.lintOnSave = !draft.lintOnSave"
                />
              </div>

              <div class="pane-title" style="margin-top: 18px">Formatters and linters</div>
              <div class="field">
                <span class="hint">
                  Detected for this workspace. A local install under
                  <span class="mono">node_modules</span> wins over a global one.
                </span>
                <div class="lsp-list">
                  <div v-for="tool in format.tools.value" :key="tool.id" class="lsp-row">
                    <div class="lsp-main">
                      <span class="lsp-name">{{ tool.label }}</span>
                      <span class="lsp-langs">
                        {{ tool.kind }} · {{ tool.languages.join(', ') }}
                      </span>
                    </div>
                    <span v-if="tool.path" class="lsp-path" :title="tool.path">
                      {{ tool.scope }}
                    </span>
                    <span v-else class="lsp-missing">not installed · {{ tool.install }}</span>
                  </div>
                </div>
              </div>

              <div class="pane-title" style="margin-top: 18px">Language servers</div>
              <div class="field">
                <span class="hint">
                  Kudo starts a language server for a file's language when one is installed. Detected
                  automatically from PATH.
                </span>
                <div class="lsp-list">
                  <div v-for="spec in lsp.specs.value" :key="spec.name" class="lsp-row">
                    <div class="lsp-main">
                      <span class="lsp-name">{{ spec.name }}</span>
                      <span class="lsp-langs">{{ spec.languages.join(', ') }}</span>
                    </div>
                    <span v-if="spec.path" class="lsp-path" :title="spec.path">{{ spec.path }}</span>
                    <span v-else class="lsp-missing">not installed · {{ spec.install }}</span>
                    <button
                      class="switch"
                      :class="{ on: spec.enabled }"
                      :title="spec.enabled ? 'Disable' : 'Enable'"
                      @click="lsp.toggle(spec.name, !spec.enabled)"
                    />
                  </div>
                </div>
                <button class="btn ghost sm" style="align-self: flex-start" @click="lsp.detect()">
                  Rescan PATH
                </button>
              </div>
            </template>

            <template v-else-if="settingsTab === 'terminal'">
              <div class="pane-title">Terminal</div>

              <div class="field">
                <label>Shell</label>
                <input v-model="draft.terminalShell" class="input" spellcheck="false" />
                <div class="chips">
                  <button
                    v-for="shell in shellChoices"
                    :key="shell.id"
                    class="chip"
                    :class="{ active: isShellSelected(shell.path) }"
                    :title="shell.path"
                    @click="draft.terminalShell = shell.path"
                  >
                    {{ shell.label }}
                  </button>
                </div>
                <span class="hint">Used for new terminal sessions on this machine.</span>
              </div>

              <div class="field">
                <label>Font size</label>
                <div class="row">
                  <input
                    v-model.number="draft.terminalFontSize"
                    type="range"
                    min="10"
                    max="20"
                    step="1"
                    class="range"
                  />
                  <span class="mono">{{ draft.terminalFontSize }}px</span>
                </div>
              </div>

              <div class="callout">
                Terminals started before a settings change keep their old shell. Use
                <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>`</kbd> to open a fresh session.
              </div>
            </template>

            <template v-else-if="settingsTab === 'ai'">
              <div class="pane-title">Agent</div>

              <div class="field">
                <label>Provider</label>
                <div class="segment">
                  <button
                    v-for="option in ['demo', 'openai', 'anthropic']"
                    :key="option"
                    :class="{ active: draft.ai.provider === option }"
                    @click="draft.ai.provider = option"
                  >
                    {{ option }}
                  </button>
                </div>
                <span class="hint">
                  Demo streams a canned reply. OpenAI-compatible covers OpenAI, OpenRouter,
                  Together, Ollama, LM Studio and similar gateways.
                </span>
              </div>

              <div v-if="draft.ai.provider !== 'demo'" class="field">
                <label>Base URL</label>
                <input v-model="draft.ai.baseUrl" class="input" spellcheck="false" />
              </div>

              <div class="field">
                <label>Model</label>
                <input v-model="draft.ai.model" class="input" spellcheck="false" />
                <div v-if="models.length" class="chips">
                  <button
                    v-for="model in models.slice(0, 12)"
                    :key="model"
                    class="chip"
                    :class="{ active: draft.ai.model === model }"
                    @click="draft.ai.model = model"
                  >
                    {{ model }}
                  </button>
                </div>
              </div>

              <div v-if="draft.ai.provider !== 'demo'" class="field">
                <label>API key</label>
                <div class="row">
                  <input
                    v-model="draft.ai.apiKey"
                    class="input"
                    type="password"
                    placeholder="sk-…"
                    spellcheck="false"
                  />
                  <button class="btn sm" :disabled="probing" @click="probe">
                    <Loader2 v-if="probing" :size="12" class="spin" />
                    Test
                  </button>
                </div>
                <span class="hint">Stored locally in the app config directory, never uploaded.</span>
              </div>

              <div class="field">
                <label>Temperature · {{ draft.ai.temperature }}</label>
                <input
                  v-model.number="draft.ai.temperature"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  class="range"
                />
              </div>

              <div class="field">
                <label>Max tokens</label>
                <input v-model.number="draft.ai.maxTokens" class="input" type="number" min="256" step="256" />
              </div>

              <div class="field">
                <label>System prompt</label>
                <textarea v-model="draft.ai.systemPrompt" class="input" rows="4" spellcheck="false" />
              </div>

              <div class="field toggle-field">
                <div>
                  <label>Tool calling</label>
                  <span class="hint">Let the agent read, write and search the workspace.</span>
                </div>
                <button
                  class="switch"
                  :class="{ on: draft.ai.agentMode }"
                  @click="draft.ai.agentMode = !draft.ai.agentMode"
                />
              </div>

              <div class="field toggle-field">
                <div>
                  <label>Auto-approve write actions</label>
                  <span class="hint">Skip the confirmation for file writes and shell commands.</span>
                </div>
                <button
                  class="switch"
                  :class="{ on: draft.ai.autoApprove }"
                  @click="draft.ai.autoApprove = !draft.ai.autoApprove"
                />
              </div>
            </template>

            <template v-else-if="settingsTab === 'integrations'">
              <div class="pane-title">Integrations</div>

              <div class="field">
                <label>Browser preview home</label>
                <input v-model="draft.browserHome" class="input" spellcheck="false" />
                <span class="hint">Opened by the browser panel and Ctrl+Shift+B.</span>
              </div>

              <div class="field">
                <label>MCP tool servers</label>
                <div class="row">
                  <span class="mono">{{ (draft.mcpServers ?? []).length }} configured</span>
                  <div style="flex: 1" />
                  <button
                    class="btn sm"
                    @click="
                      ide.settingsOpen.value = false;
                      ide.sidebarView.value = 'mcp';
                      ide.sidebarVisible.value = true
                    "
                  >
                    Manage servers
                  </button>
                </div>
                <span class="hint">
                  Stdio JSON-RPC servers. Their tools are exposed to the agent and can be
                  called from the MCP pane.
                </span>
              </div>

              <div class="field">
                <label>Update feed</label>
                <input
                  v-model="draft.updateFeed"
                  class="input"
                  spellcheck="false"
                  placeholder="https://example.com/versions.json"
                />
                <span class="hint">
                  Tauri-style manifest: <code>version</code>, <code>notes</code>,
                  <code>pub_date</code> and <code>platforms[platform].url</code>.
                </span>
              </div>

              <div class="callout">
                Docker, language servers and skills are configured from their sidebar panes.
              </div>
            </template>

            <template v-else-if="settingsTab === 'keys'">
              <div class="pane-title">Keyboard shortcuts</div>
              <div class="key-list">
                <div v-for="item in shortcuts" :key="item.keys" class="key-row">
                  <span>{{ item.action }}</span>
                  <kbd>{{ item.keys }}</kbd>
                </div>
              </div>
              <div class="callout">Shortcut remapping arrives with the keymap editor.</div>
            </template>

            <template v-else-if="settingsTab === 'about'">
              <div class="pane-title">About</div>
              <div class="about">
                <div class="empty-mark" style="width: 52px; height: 52px; font-size: 22px">K</div>
                <div>
                  <h3 style="margin: 0 0 2px">Kudo {{ appInfo?.version ?? '0.10.0' }}</h3>
                  <p class="hint" style="margin: 0">
                    A clean-room desktop IDE built with Tauri v2, Nuxt 3 and Rust.
                  </p>
                </div>
              </div>
              <div class="about-grid">
                <span>Platform</span><span class="mono">{{ appInfo?.platform ?? '—' }}</span>
                <span>Architecture</span><span class="mono">{{ appInfo?.arch ?? '—' }}</span>
                <span>Config directory</span><span class="mono ellipsis">{{ appInfo?.configDir ?? '—' }}</span>
                <span>Renderer</span><span class="mono">Nuxt 3 · WebView2</span>
                <span>Backend</span><span class="mono">Tauri 2 · Rust</span>
              </div>

              <div class="update-card">
                <div class="row">
                  <Download :size="14" />
                  <div class="col">
                    <span style="font-size: 12px">Software updates</span>
                    <span class="hint">
                      {{ updateInfo ? `Latest ${updateInfo.latestVersion}` : 'Check your configured feed' }}
                    </span>
                  </div>
                  <div style="flex: 1" />
                  <button class="btn sm" :disabled="checking" @click="checkUpdates">
                    <Loader2 v-if="checking" :size="12" class="spin" />
                    Check
                  </button>
                </div>

                <div v-if="updateInfo?.available" class="update-body">
                  <div class="row" style="justify-content: space-between">
                    <span class="mono">{{ appInfo?.version ?? '0.10.0' }} → {{ updateInfo.latestVersion }}</span>
                    <span class="hint">{{ updateInfo.publishedAt }}</span>
                  </div>
                  <pre v-if="updateInfo.notes" class="update-notes">{{ updateInfo.notes }}</pre>
                  <div class="row">
                    <button
                      class="btn primary sm"
                      :disabled="downloading || !updateInfo.url"
                      @click="downloadUpdate"
                    >
                      <Loader2 v-if="downloading" :size="12" class="spin" />
                      <Download v-else :size="12" />
                      Download installer
                    </button>
                    <button v-if="downloaded" class="btn sm" @click="installUpdate">
                      Install now
                    </button>
                    <button v-if="downloaded" class="btn ghost sm" @click="revealUpdate">
                      Show file
                    </button>
                  </div>
                  <span v-if="downloaded" class="hint">
                    {{ downloaded.fileName }} · {{ (downloaded.bytes / 1024 / 1024).toFixed(1) }} MB
                  </span>
                  <span v-if="!updateInfo.url" class="hint" style="color: var(--red)">
                    The feed has no build for this platform.
                  </span>
                </div>
                <div v-else-if="updateInfo" class="hint">You are running the latest version.</div>
                <div v-if="updateError" class="hint" style="color: var(--red)">{{ updateError }}</div>
              </div>

              <div class="section-label" style="padding-left: 0">Recent workspaces</div>
              <div v-if="!draft.recentWorkspaces.length" class="hint">No recent workspaces.</div>
              <div
                v-for="recent in draft.recentWorkspaces"
                :key="recent.path"
                class="recent-row"
              >
                <div class="col">
                  <span>{{ recent.name }}</span>
                  <span class="hint ellipsis">{{ recent.path }}</span>
                </div>
                <button class="icon-btn" title="Forget" @click="removeRecent(recent.path)">
                  <X :size="13" />
                </button>
              </div>
            </template>
          </div>
        </div>

        <div class="modal-foot">
          <button class="btn ghost" @click="reset">
            <RotateCcw :size="13" /> Reset to defaults
          </button>
          <div style="flex: 1" />
          <button class="btn ghost" @click="close">Cancel</button>
          <button class="btn primary" :disabled="saving || !canSave" @click="save">
            <Save :size="13" /> Save changes
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.settings-modal {
  width: min(900px, 94vw);
  height: min(640px, 86vh);
}
.settings-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 176px 1fr;
}
.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 8px;
  border-right: 1px solid var(--border);
  background: var(--surface-0);
}
.settings-nav button {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.settings-nav button:hover {
  background: var(--glass);
  color: var(--text-dim);
}
.settings-nav button.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.settings-pane {
  padding: 16px 18px 24px;
  overflow-y: auto;
  min-height: 0;
}
.pane-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 16px;
}
.segment {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.segment button {
  flex: 1;
  height: 27px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11.5px;
  text-transform: capitalize;
  cursor: pointer;
}
.segment button.active {
  background: var(--glass-strong);
  color: var(--text);
}
.swatches {
  display: flex;
  align-items: center;
  gap: 8px;
}
.swatch {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 2px solid transparent;
  display: grid;
  place-items: center;
  color: #16130a;
  cursor: pointer;
  padding: 0;
}
.swatch.active {
  border-color: var(--text);
}
.color-input {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.row .input {
  flex: 1;
}
.range {
  flex: 1;
  accent-color: var(--accent);
}
.mono {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-dim);
}
.toggle-field {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.toggle-field > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.toggle-field label {
  font-size: 12px;
  color: var(--text);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 2px;
}
.chip {
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--glass);
  color: var(--text-muted);
  font-size: 10.5px;
  font-family: var(--font-mono);
  cursor: pointer;
}
.chip.active,
.chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.callout {
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-left: 2px solid var(--accent);
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.55;
}
.key-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 14px;
}
.key-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 9px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-dim);
}
.key-row:hover {
  background: var(--glass);
}
.about {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
}
.about-grid {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 7px 12px;
  font-size: 11.5px;
  color: var(--text-faint);
  margin-bottom: 18px;
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.update-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 11px;
  margin-bottom: 18px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
}
.update-card .row {
  gap: 8px;
}
.update-card .col {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.update-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.update-notes {
  margin: 0;
  max-height: 130px;
  overflow: auto;
  padding: 8px 9px;
  border-radius: 6px;
  background: var(--surface-1);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10.5px;
  line-height: 1.55;
  white-space: pre-wrap;
}
.recent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
}
.recent-row:hover {
  background: var(--glass);
}
.recent-row .col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.lsp-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 4px 0 8px;
}
.lsp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--glass);
}
.lsp-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 190px;
}
.lsp-name {
  font-size: 12px;
  color: var(--text);
}
.lsp-langs {
  font-size: 10.5px;
  color: var(--text-faint);
}
.lsp-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--text-faint);
  font-family: var(--font-mono);
}
.lsp-missing {
  flex: 1;
  min-width: 0;
  font-size: 10.5px;
  color: var(--text-faint);
  opacity: 0.85;
}
.field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.field-head > label {
  font-size: 11.5px;
  color: var(--text-dim);
  font-weight: 500;
}
.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 10.5px;
  cursor: pointer;
}
.link-btn:hover {
  color: var(--accent);
}
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 8px;
}
.theme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-2);
  text-align: left;
  cursor: pointer;
  transition: border-color 120ms ease, transform 120ms ease;
}
.theme-card:hover {
  border-color: var(--border-strong);
  transform: translateY(-1px);
}
.theme-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-soft);
}
.theme-preview {
  position: relative;
  display: block;
  height: 46px;
  margin-bottom: 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.theme-preview.system {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #0f0f0f 0%, #141414 49%, #f3f4f6 50%, #ffffff 100%);
  color: var(--text-muted);
}
.theme-preview-bar {
  position: absolute;
  inset: 0 0 auto 0;
  height: 10px;
  background: var(--surface-3);
}
.theme-syntax {
  position: absolute;
  left: 7px;
  right: 7px;
  top: 18px;
  display: flex;
  gap: 4px;
}
.theme-syntax i {
  height: 3px;
  border-radius: 2px;
  flex: 1;
}
.theme-accent {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px var(--surface-1);
}
.theme-card-label {
  font-size: 11.5px;
  font-weight: 550;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.theme-card-meta {
  font-size: 9.5px;
  color: var(--text-faint);
}
.theme-check {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 2px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--surface-1);
}
</style>
