<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowLeft,
  ArrowRight,
  CornerDownLeft,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  Send,
  Settings2,
  X
} from 'lucide-vue-next'
import { call } from '../lib/api'

const ide = useIde()
const browser = useBrowser()

type Tab = 'preview' | 'request'

const tab = ref<Tab>('preview')
const address = ref(browser.url.value)
const addressInput = ref<HTMLInputElement | null>(null)

const method = ref('GET')
const reqUrl = ref('http://localhost:3000/api/health')
const reqHeaders = ref('Accept: application/json')
const reqBody = ref('')
const sending = ref(false)
const response = ref<{
  status: number
  statusText: string
  headers: [string, string][]
  body: string
  contentType: string
  durationMs: number
  truncated: boolean
} | null>(null)
const reqError = ref('')
const showHeaders = ref(false)

const canBack = computed(() => browser.index.value > 0)
const canForward = computed(() => browser.index.value < browser.history.value.length - 1)
const hasUrl = computed(() => Boolean(browser.url.value))
const canPreview = computed(() => hasUrl.value && !browser.isSelfUrl.value)
const configuredHome = computed(() => ide.settings.value.browserHome?.trim() ?? '')
const configuredHomeIsSelf = computed(() => {
  if (!configuredHome.value || !import.meta.client) return false
  try {
    return new URL(configuredHome.value).origin === window.location.origin
  } catch {
    return false
  }
})
const prettyBody = computed(() => {
  const body = response.value?.body ?? ''
  if (!body) return ''
  const contentType = response.value?.contentType ?? ''
  if (contentType.includes('json') || /^\s*[[{]/.test(body)) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2)
    } catch {
      return body
    }
  }
  return body
})
const prettySize = computed(() => {
  const bytes = response.value?.body.length ?? 0
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
})

watch(
  () => browser.url.value,
  (value) => {
    address.value = value
    if (tab.value === 'preview') browser.loading.value = true
  }
)

watch(
  () => browser.open.value,
  async (open) => {
    if (!open) return
    await nextTick()
    addressInput.value?.select()
  }
)

function go() {
  if (!address.value.trim()) return
  browser.navigate(address.value)
}

function useHome() {
  browser.home()
  if (!configuredHome.value) addressInput.value?.focus()
}

function focusAddress() {
  addressInput.value?.focus()
  addressInput.value?.select()
}

function openExternal(target?: string) {
  const dest = target ?? browser.url.value
  if (!dest) return
  call('browser_open_external', { url: dest }).catch((err) => ide.notify(String(err), 'error'))
}

function parseHeaders(raw: string): [string, string][] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line.includes(':'))
    .map((line) => {
      const idx = line.indexOf(':')
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as [string, string]
    })
}

async function sendRequest() {
  sending.value = true
  reqError.value = ''
  response.value = null
  try {
    response.value = await call('browser_fetch', {
      url: reqUrl.value,
      method: method.value,
      headers: parseHeaders(reqHeaders.value),
      body: ['GET', 'HEAD'].includes(method.value) ? '' : reqBody.value
    })
  } catch (err) {
    reqError.value = String(err)
  } finally {
    sending.value = false
  }
}

async function copyBody() {
  try {
    await navigator.clipboard.writeText(prettyBody.value)
    ide.notify('Response copied', 'success')
  } catch {
    ide.notify('Clipboard is unavailable', 'error')
  }
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    browser.hide()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && tab.value === 'request') {
    event.preventDefault()
    sendRequest()
  }
  if (event.key === 'Enter' && tab.value === 'preview' && event.target === addressInput.value) {
    event.preventDefault()
    go()
  }
}

function setTab(next: Tab) {
  tab.value = next
  if (next === 'request') {
    reqUrl.value = browser.url.value
    if (browser.loading.value) browser.loading.value = false
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="browser.open.value"
      class="browser-shell"
      :style="{ '--tb': 'var(--titlebar-h)' }"
    >
      <div class="browser-head">
        <div class="browser-title">
          <Globe :size="15" style="color: var(--accent)" />
          <span>Browser</span>
        </div>

        <div class="nav-btns">
          <button class="icon-btn" :disabled="!canBack" title="Back" @click="browser.back()">
            <ArrowLeft :size="14" />
          </button>
          <button class="icon-btn" :disabled="!canForward" title="Forward" @click="browser.forward()">
            <ArrowRight :size="14" />
          </button>
          <button class="icon-btn" title="Reload" @click="browser.reload()">
            <RefreshCw :size="13" />
          </button>
        </div>

        <div class="address">
          <input
            ref="addressInput"
            v-model="address"
            class="address-input"
            spellcheck="false"
            placeholder="Enter a URL, e.g. http://localhost:5173"
            @keydown.enter.prevent="go"
          />
          <Loader2 v-if="browser.loading.value && tab === 'preview'" :size="12" class="spin" />
        </div>

        <div class="browser-tabs">
          <button :class="{ active: tab === 'preview' }" @click="setTab('preview')">Preview</button>
          <button :class="{ active: tab === 'request' }" @click="setTab('request')">Request</button>
        </div>

        <button
          class="icon-btn"
          :disabled="!canPreview"
          :title="canPreview ? 'Set as home' : hasUrl ? 'Kodra cannot use its own address as home' : 'Open a page first'"
          @click="ide.settings.value.browserHome = browser.url.value; ide.notify('Browser home updated', 'success')"
        >
          <Settings2 :size="13" />
        </button>
        <button
          class="icon-btn"
          :disabled="!hasUrl"
          title="Open in system browser"
          @click="openExternal()"
        >
          <ExternalLink :size="13" />
        </button>
        <button class="icon-btn" title="Close (Esc)" @click="browser.hide()">
          <X :size="15" />
        </button>
      </div>

      <div v-show="tab === 'preview'" class="preview-body">
        <div v-if="!hasUrl" class="preview-empty">
          <div class="empty-card">
            <span class="empty-badge"><Globe :size="22" /></span>
            <h2>Preview a running app</h2>
            <p>
              Type a URL in the address bar to show a dev server, docs page or local build
              inside Kodra.
            </p>
            <div class="empty-actions">
              <button class="btn primary sm" @click="focusAddress">Enter URL</button>
              <button
                v-if="configuredHome && !configuredHomeIsSelf"
                class="btn ghost sm"
                @click="useHome"
              >
                Open home page
              </button>
            </div>
            <p class="empty-hint">
              Kodra never loads its own address here — that would nest the whole IDE inside the
              pane.
            </p>
          </div>
        </div>

        <div v-else-if="browser.isSelfUrl.value" class="preview-empty">
          <div class="empty-card warn">
            <span class="empty-badge"><Globe :size="22" /></span>
            <h2>This address is Kodra itself</h2>
            <p>
              <code>{{ browser.url.value }}</code> is the origin this IDE is served from. Loading
              it would embed Kodra inside Kodra, so the pane stays empty.
            </p>
            <div class="empty-actions">
              <button class="btn primary sm" @click="openExternal()">
                <ExternalLink :size="12" />
                Open in system browser
              </button>
              <button class="btn ghost sm" @click="focusAddress">Use another URL</button>
            </div>
          </div>
        </div>

        <iframe
          v-else
          :key="browser.reloadKey.value"
          :src="browser.url.value"
          class="preview-frame"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
          referrerpolicy="no-referrer"
          @load="browser.loading.value = false"
        />
        <div class="preview-foot">
          <span class="hint">{{ hasUrl ? browser.url.value : 'No page loaded' }}</span>
          <div style="flex: 1" />
          <span class="hint">Frames blocked by the site? Use “Open in system browser”.</span>
        </div>
      </div>

      <div v-show="tab === 'request'" class="request-body">
        <div class="req-bar">
          <select v-model="method" class="select req-method">
            <option>GET</option>
            <option>POST</option>
            <option>PUT</option>
            <option>PATCH</option>
            <option>DELETE</option>
            <option>HEAD</option>
          </select>
          <input v-model="reqUrl" class="input" spellcheck="false" placeholder="https://api.example.com/health" />
          <button class="btn primary sm" :disabled="sending || !reqUrl" @click="sendRequest">
            <Loader2 v-if="sending" :size="12" class="spin" />
            <Send v-else :size="12" />
            Send
          </button>
        </div>

        <div class="req-grid">
          <div class="req-pane">
            <div class="pane-label">Headers</div>
            <textarea
              v-model="reqHeaders"
              class="code-area"
              spellcheck="false"
              placeholder="Accept: application/json&#10;Authorization: Bearer …"
            />
            <div class="pane-label">Body</div>
            <textarea
              v-model="reqBody"
              class="code-area"
              spellcheck="false"
              placeholder='{"hello":"world"}'
              :disabled="['GET', 'HEAD'].includes(method)"
            />
            <div class="hint" style="padding: 2px 2px 8px">
              Requests run in Rust, so CORS does not apply. Body is ignored for GET/HEAD.
            </div>
          </div>

          <div class="req-pane response-pane">
            <div class="response-head">
              <span v-if="response" class="status" :class="{ ok: response.status < 400 }">
                {{ response.status }} {{ response.statusText }}
              </span>
              <span v-if="response" class="hint">{{ response.durationMs }} ms · {{ prettySize }}</span>
              <span v-if="reqError" class="status err">Failed</span>
              <div style="flex: 1" />
              <button
                v-if="response"
                class="btn ghost sm"
                @click="showHeaders = !showHeaders"
              >
                Headers ({{ response.headers.length }})
              </button>
              <button
                v-if="response"
                class="btn ghost sm"
                @click="copyBody"
              >
                Copy
              </button>
            </div>

            <div v-if="showHeaders && response" class="resp-headers">
              <div v-for="([key, value], i) in response.headers" :key="i">
                <span>{{ key }}</span>
                <em>{{ value }}</em>
              </div>
            </div>

            <pre v-if="reqError" class="resp-body error">{{ reqError }}</pre>
            <pre v-else-if="response" class="resp-body">{{ prettyBody }}</pre>
            <div v-else class="panel-empty">Send a request to inspect the response.</div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.browser-shell {
  position: fixed;
  inset: calc(var(--tb) + 2 * var(--gutter)) var(--gutter) var(--gutter) var(--gutter);
  z-index: 240;
  display: flex;
  flex-direction: column;
  background: var(--layer-solid);
  backdrop-filter: blur(26px) saturate(150%);
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--rim-top), var(--shadow-pop);
  overflow: hidden;
  animation: browser-in 0.16s ease-out;
}
@keyframes browser-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.995);
  }
}
.browser-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--hairline);
  background: var(--fill-1);
}
.browser-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  padding-right: 4px;
}
.nav-btns {
  display: flex;
  gap: 1px;
}
.address {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-2);
}
.address:focus-within {
  border-color: var(--accent);
}
.address-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11.5px;
}
.browser-tabs {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-2);
}
.browser-tabs button {
  padding: 4px 9px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font-size: 10.5px;
  cursor: pointer;
}
.browser-tabs button.active {
  background: var(--glass-strong);
  color: var(--text);
}
.preview-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
}
.preview-frame {
  flex: 1;
  width: 100%;
  border: 0;
  background: #fff;
}
.preview-empty {
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  padding: 28px;
  overflow: auto;
  background: var(--surface-0);
}
.empty-card {
  width: 100%;
  max-width: 470px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}
.empty-badge {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  margin-bottom: 2px;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--surface-2);
  color: var(--accent);
}
.empty-card.warn .empty-badge {
  color: var(--orange);
  background: color-mix(in srgb, var(--orange) 12%, var(--surface-2));
}
.empty-card h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.empty-card p {
  margin: 0;
  font-size: 12px;
  line-height: 1.65;
  color: var(--text-muted);
}
.empty-card code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--surface-2);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-dim);
  word-break: break-all;
}
.empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 6px;
}
.empty-hint {
  margin-top: 6px !important;
  font-size: 11px !important;
  color: var(--text-faint) !important;
}
.preview-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-top: 1px solid var(--border);
  background: var(--surface-1);
}
.request-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 10px;
}
.req-bar {
  display: flex;
  gap: 8px;
}
.req-method {
  width: 96px;
  font-family: var(--font-mono);
  font-size: 11px;
}
.req-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1.15fr;
  gap: 12px;
}
.req-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-1);
  overflow: hidden;
}
.pane-label {
  padding: 8px 10px 5px;
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
}
.code-area {
  flex: 1;
  min-height: 70px;
  resize: none;
  margin: 0 8px 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
  background: var(--surface-2);
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.55;
}
.code-area:focus {
  border-color: var(--accent);
}
.response-pane {
  display: flex;
  flex-direction: column;
}
.response-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
.status {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--red) 16%, transparent);
  color: var(--red);
}
.status.ok {
  background: color-mix(in srgb, var(--green) 16%, transparent);
  color: var(--green);
}
.status.err {
  background: color-mix(in srgb, var(--red) 16%, transparent);
  color: var(--red);
}
.resp-headers {
  max-height: 130px;
  overflow-y: auto;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 10px;
}
.resp-headers div {
  display: flex;
  gap: 8px;
  padding: 1px 0;
}
.resp-headers span {
  flex: 0 0 180px;
  color: var(--accent);
}
.resp-headers em {
  font-style: normal;
  color: var(--text-faint);
  word-break: break-all;
}
.resp-body {
  flex: 1;
  margin: 0;
  padding: 12px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-dim);
  white-space: pre-wrap;
  word-break: break-word;
}
.resp-body.error {
  color: var(--red);
}
.panel-empty {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--text-faint);
  font-size: 12px;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
