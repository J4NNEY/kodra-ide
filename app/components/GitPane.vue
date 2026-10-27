<script setup lang="ts">
import {
  RefreshCw,
  ArrowDownToLine,
  ArrowUpFromLine,
  GitBranch,
  FolderGit2,
  ExternalLink,
  Trash2,
  Plus,
  Minus,
  RotateCcw,
  Check,
  History,
  X
} from 'lucide-vue-next'
import type { GitFile, Worktree } from '../lib/types'
import { call, basename, dirname, relativeTo } from '../lib/api'

const ide = useIde()
const git = useGit()

const message = ref('')
const busy = ref(false)
const showBranches = ref(false)
const newBranch = ref('')
const diff = ref<{ file: string; text: string } | null>(null)
const showLog = ref(false)

const showWorktrees = ref(true)
const wtBranch = ref('')
const wtPath = ref('')
const wtBusy = ref(false)

const staged = computed(() => git.status.value?.files.filter((f) => f.staged) ?? [])
const unstaged = computed(() => git.status.value?.files.filter((f) => !f.staged) ?? [])

function suggestWorktreePath() {
  const ws = ide.workspace.value
  if (!ws) return
  const slug = wtBranch.value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) {
    wtPath.value = ''
    return
  }
  const sep = ws.path.includes('\\') ? '\\' : '/'
  wtPath.value = [dirname(ws.path), `${basename(ws.path)}-${slug}`].join(sep)
}

async function createWorktree() {
  if (!wtBranch.value.trim() || !wtPath.value.trim() || wtBusy.value) return
  wtBusy.value = true
  try {
    await git.addWorktree(wtPath.value.trim(), wtBranch.value.trim())
    ide.notify(`Worktree ready for ${wtBranch.value.trim()}`, 'success')
    wtBranch.value = ''
    wtPath.value = ''
  } catch (err) {
    ide.notify(String(err), 'error')
  } finally {
    wtBusy.value = false
  }
}

async function removeWorktree(worktree: Worktree) {
  if (worktree.current || worktree.main) return
  if (!window.confirm(`Remove the worktree at ${worktree.path}? The branch itself is kept.`)) return
  try {
    await git.removeWorktree(worktree.path)
    ide.notify('Worktree removed', 'success')
  } catch (err) {
    const force = window.confirm(
      `${String(err)}\n\nForce remove it? Uncommitted changes in that folder will be lost.`
    )
    if (!force) return
    try {
      await git.removeWorktree(worktree.path, true)
      ide.notify('Worktree force-removed', 'success')
    } catch (err2) {
      ide.notify(String(err2), 'error')
    }
  }
}

async function pruneWorktrees() {
  try {
    const out = await git.pruneWorktrees()
    ide.notify(out.trim() || 'Nothing to prune', 'success')
  } catch (err) {
    ide.notify(String(err), 'error')
  }
}

function openWorktree(worktree: Worktree) {
  if (worktree.current) return
  ide.openFolder(worktree.path)
}

async function refreshAll() {
  await git.refresh()
  await git.loadBranches()
  await git.loadWorktrees()
  if (showLog.value) await git.loadLog()
}

async function commit() {
  if (!message.value.trim()) return
  busy.value = true
  try {
    await git.commit(message.value.trim())
    message.value = ''
    ide.notify('Committed', 'success')
    await git.loadLog()
  } catch (err) {
    ide.notify(String(err), 'error')
  } finally {
    busy.value = false
  }
}

async function push() {
  busy.value = true
  try {
    await git.push()
    ide.notify('Pushed to remote', 'success')
  } catch (err) {
    ide.notify(String(err), 'error')
  } finally {
    busy.value = false
  }
}

async function pull() {
  busy.value = true
  try {
    await git.pull()
    ide.notify('Pulled from remote', 'success')
  } catch (err) {
    ide.notify(String(err), 'error')
  } finally {
    busy.value = false
  }
}

async function openDiff(file: GitFile) {
  try {
    const text = await call<string>('git_diff', { path: file.path, staged: file.staged })
    diff.value = { file: file.rel, text: text || 'No changes to show.' }
  } catch (err) {
    ide.notify(String(err), 'error')
  }
}

async function createBranch() {
  if (!newBranch.value.trim()) return
  try {
    await git.createBranch(newBranch.value.trim())
    newBranch.value = ''
    showBranches.value = false
    ide.notify('Branch created', 'success')
  } catch (err) {
    ide.notify(String(err), 'error')
  }
}

function dirOf(rel: string) {
  const d = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  return d
}

onMounted(refreshAll)
watch(() => ide.workspace.value?.path, refreshAll)
</script>

<template>
  <div class="pane">
    <div class="sidebar-header">
      <span class="sidebar-title">Source Control</span>
      <div class="sidebar-actions">
        <button class="icon-btn" title="Refresh" @click="refreshAll">
          <RefreshCw :size="13" :class="{ spin: git.loading.value }" />
        </button>
      </div>
    </div>

    <div class="sidebar-body">
      <div v-if="!ide.workspace.value?.isGit" class="pane-empty">
        This folder is not a git repository.
      </div>

      <template v-else>
        <div class="branch-card">
          <button class="branch-name" @click="showBranches = !showBranches">
            <GitBranch :size="13" />
            <span>{{ git.status.value?.branch ?? 'HEAD' }}</span>
            <span v-if="git.status.value?.upstream" class="upstream">
              ↕ {{ git.status.value?.ahead }} / {{ git.status.value?.behind }}
            </span>
          </button>
          <div class="branch-actions">
            <button class="icon-btn" title="Pull" :disabled="busy" @click="pull">
              <ArrowDownToLine :size="13" />
            </button>
            <button class="icon-btn" title="Push" :disabled="busy" @click="push">
              <ArrowUpFromLine :size="13" />
            </button>
          </div>
        </div>

        <div v-if="showBranches" class="branch-list">
          <button
            v-for="b in git.branches.value"
            :key="b.name"
            class="branch-item"
            :class="{ current: b.current }"
            @click="
              b.current
                ? null
                : git.checkout(b.name).then(() => {
                    showBranches = false;
                    ide.notify(`On ${b.name}`, 'success')
                  })
            "
          >
            <Check v-if="b.current" :size="12" />
            <span v-else style="width: 12px" />
            {{ b.name }}
          </button>
          <div class="new-branch">
            <input
              v-model="newBranch"
              class="input"
              placeholder="New branch name"
              @keydown.enter="createBranch"
            />
            <button class="btn sm" :disabled="!newBranch" @click="createBranch">Create</button>
          </div>
        </div>

        <button class="log-toggle wt-toggle" @click="showWorktrees = !showWorktrees">
          <FolderGit2 :size="12" />
          Worktrees
          <span class="wt-count">{{ git.worktrees.value.length }}</span>
        </button>
        <template v-if="showWorktrees">
          <div v-for="worktree in git.worktrees.value" :key="worktree.path" class="wt-row">
            <div class="col">
              <span class="wt-branch">
                <GitBranch :size="10" />
                {{ worktree.branch ?? (worktree.detached ? 'detached' : 'bare') }}
                <span v-if="worktree.main" class="wt-tag">main</span>
                <span v-if="worktree.current" class="wt-tag current">open</span>
              </span>
              <span class="wt-path" :title="worktree.path">{{ basename(worktree.path) }}</span>
            </div>
            <div class="wt-actions">
              <button
                class="icon-btn"
                title="Open this worktree"
                :disabled="worktree.current"
                @click="openWorktree(worktree)"
              >
                <ExternalLink :size="12" />
              </button>
              <button
                class="icon-btn"
                title="Remove worktree"
                :disabled="worktree.current || worktree.main"
                @click="removeWorktree(worktree)"
              >
                <Trash2 :size="12" />
              </button>
            </div>
          </div>
          <div class="wt-new">
            <input
              v-model="wtBranch"
              class="input"
              placeholder="New branch"
              @input="suggestWorktreePath"
            />
            <input v-model="wtPath" class="input" placeholder="Worktree folder (absolute)" />
            <button
              class="btn sm"
              :disabled="wtBusy || !wtBranch.trim() || !wtPath.trim()"
              @click="createWorktree"
            >
              Create
            </button>
          </div>
          <div class="wt-foot">
            <span>New branches start at {{ git.status.value?.branch ?? 'HEAD' }}</span>
            <button class="link-btn" @click="pruneWorktrees">Prune stale</button>
          </div>
        </template>

        <div class="commit-box">
          <textarea
            v-model="message"
            class="input"
            rows="2"
            placeholder="Commit message (Ctrl+Enter)"
            style="resize: none; min-height: 54px"
            @keydown.ctrl.enter="commit"
          />
          <div class="commit-actions">
            <span class="hint">{{ staged.length }} staged</span>
            <div style="flex: 1" />
            <button class="btn sm" :disabled="!unstaged.length" @click="git.stageAll()">
              Stage all
            </button>
            <button class="btn primary sm" :disabled="busy || !message.trim()" @click="commit">
              Commit
            </button>
          </div>
        </div>

        <div v-if="staged.length" class="section-label">Staged Changes · {{ staged.length }}</div>
        <div
          v-for="file in staged"
          :key="`s-${file.rel}`"
          class="git-file"
          @click="openDiff(file)"
        >
          <span class="git-mark git-added">{{ file.index.trim() || 'M' }}</span>
          <div class="col">
            <span class="name">{{ basename(file.rel) }}</span>
            <span v-if="dirOf(file.rel)" class="dir">{{ dirOf(file.rel) }}</span>
          </div>
          <div class="actions">
            <button class="icon-btn" title="Unstage" @click.stop="git.unstage([file.path])">
              <Minus :size="12" />
            </button>
          </div>
        </div>

        <div v-if="unstaged.length" class="section-label">Changes · {{ unstaged.length }}</div>
        <div
          v-for="file in unstaged"
          :key="`u-${file.rel}`"
          class="git-file"
          @click="openDiff(file)"
        >
          <span class="git-mark" :class="file.status === 'untracked' ? 'git-untracked' : 'git-modified'">
            {{ file.worktree.trim() || 'M' }}
          </span>
          <div class="col">
            <span class="name">{{ basename(file.rel) }}</span>
            <span v-if="dirOf(file.rel)" class="dir">{{ dirOf(file.rel) }}</span>
          </div>
          <div class="actions">
            <button class="icon-btn" title="Stage" @click.stop="git.stage([file.path])">
              <Plus :size="12" />
            </button>
            <button class="icon-btn" title="Discard" @click.stop="git.discard([file.path])">
              <RotateCcw :size="12" />
            </button>
          </div>
        </div>

        <div v-if="git.status.value?.clean" class="clean-state">
          <Check :size="13" /> Working tree clean
        </div>

        <button class="log-toggle" @click="showLog = !showLog; showLog && git.loadLog()">
          <History :size="12" /> History
        </button>
        <template v-if="showLog">
          <div v-for="c in git.log.value" :key="c.hash" class="commit-row">
            <span class="hash">{{ c.short }}</span>
            <div class="col">
              <span class="subject">{{ c.subject }}</span>
              <span class="meta">{{ c.author }} · {{ c.date }}</span>
            </div>
          </div>
        </template>
      </template>
    </div>

    <Teleport to="body">
      <div v-if="diff" class="overlay" style="padding-top: 8vh" @click.self="diff = null">
        <div class="modal" style="width: min(900px, 94vw)">
          <div class="modal-head">
            <GitBranch :size="15" />
            <h2>{{ diff.file }}</h2>
            <div style="flex: 1" />
            <button class="icon-btn" @click="diff = null"><X :size="15" /></button>
          </div>
          <div class="modal-body" style="padding: 0; max-height: 64vh; overflow: auto">
            <pre class="diff"><code><span
              v-for="(line, i) in diff.text.split('\n')"
              :key="i"
              :class="line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('@@') ? 'hunk' : ''"
            >{{ line }}
</span></code></pre>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.branch-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px 10px;
}
.branch-name {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--text-dim);
  font-size: 11.5px;
  cursor: pointer;
}
.branch-name:hover {
  border-color: var(--border-strong);
}
.branch-name span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upstream {
  color: var(--text-faint);
  font-size: 10px;
}
.branch-actions {
  display: flex;
  gap: 2px;
}
.branch-list {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px;
  margin-bottom: 10px;
  background: var(--surface-2);
}
.branch-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 7px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-dim);
  font-size: 11.5px;
  cursor: pointer;
  text-align: left;
}
.branch-item:hover {
  background: var(--glass);
  color: var(--text);
}
.branch-item.current {
  color: var(--accent);
}
.new-branch {
  display: flex;
  gap: 5px;
  padding: 5px 3px 2px;
}
.new-branch .input {
  height: 26px;
  font-size: 11.5px;
}
.wt-toggle {
  margin-top: 2px;
}
.wt-count {
  margin-left: auto;
  font-family: var(--font-mono);
  color: var(--text-faint);
  font-size: 10px;
}
.wt-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 2px 3px 8px;
  border-radius: 6px;
}
.wt-row:hover {
  background: var(--glass);
}
.wt-row .col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
  line-height: 1.3;
}
.wt-branch {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--text-dim);
  min-width: 0;
}
.wt-branch svg {
  color: var(--accent);
  flex: 0 0 auto;
}
.wt-tag {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--glass);
  color: var(--text-faint);
}
.wt-tag.current {
  color: var(--green);
}
.wt-path {
  font-size: 9.5px;
  font-family: var(--font-mono);
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wt-actions {
  display: flex;
  opacity: 0;
}
.wt-row:hover .wt-actions {
  opacity: 1;
}
.wt-new {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 4px 4px;
}
.wt-new .input {
  height: 26px;
  font-size: 11px;
}
.wt-new .btn {
  align-self: flex-end;
}
.wt-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 2px 6px 8px;
  font-size: 9.5px;
  color: var(--text-faint);
}
.link-btn {
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 9.5px;
  cursor: pointer;
  padding: 0;
}
.link-btn:hover {
  text-decoration: underline;
}
.commit-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 6px;
}
.commit-box .input {
  font-size: 12px;
  font-family: var(--font-ui);
}
.commit-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.git-file .col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
  line-height: 1.25;
}
.git-file {
  height: auto;
  padding: 4px 8px;
}
.git-file .dir {
  font-size: 10px;
  color: var(--text-faint);
}
.clean-state {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 8px;
  font-size: 11.5px;
  color: var(--text-faint);
}
.log-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin-top: 10px;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  cursor: pointer;
}
.log-toggle:hover {
  background: var(--glass);
  color: var(--text-dim);
}
.commit-row {
  display: flex;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 11.5px;
}
.commit-row:hover {
  background: var(--glass);
}
.commit-row .hash {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--accent);
  flex: 0 0 auto;
}
.commit-row .col {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.commit-row .subject {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.commit-row .meta {
  font-size: 10px;
  color: var(--text-faint);
}
.pane-empty {
  padding: 26px 12px;
  text-align: center;
  color: var(--text-faint);
  font-size: 12px;
}
.diff {
  margin: 0;
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--text-dim);
  white-space: pre;
}
.diff .add {
  color: #8fd6a5;
  background: #1e3a2a55;
  display: inline-block;
  width: 100%;
}
.diff .del {
  color: #ef9a9d;
  background: #3a1e2055;
  display: inline-block;
  width: 100%;
}
.diff .hunk {
  color: var(--blue);
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
