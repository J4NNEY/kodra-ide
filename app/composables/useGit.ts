import type { Branch, Commit, GitStatus, Worktree } from '../lib/types'
import { call } from '../lib/api'

const LETTER: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  conflict: 'U',
  untracked: 'U',
  changed: 'M'
}

export function useGit() {
  const status = useState<GitStatus | null>('kudo:git-status', () => null)
  const branches = useState<Branch[]>('kudo:git-branches', () => [])
  const log = useState<Commit[]>('kudo:git-log', () => [])
  const worktrees = useState<Worktree[]>('kudo:git-worktrees', () => [])
  const loading = useState<boolean>('kudo:git-loading', () => false)
  const error = useState<string>('kudo:git-error', () => '')
  const ide = useIde()
  const gitCount = useState<number>('kudo:git-count', () => 0)

  const marks = computed(() => {
    const map = new Map<string, { letter: string; kind: string }>()
    for (const f of status.value?.files ?? []) {
      map.set(f.rel.replace(/\\/g, '/'), {
        letter: LETTER[f.status] ?? 'M',
        kind: f.status
      })
    }
    return map
  })

  function markFor(rel: string) {
    return marks.value.get(rel.replace(/\\/g, '/'))
  }

  async function refresh() {
    if (!ide.workspace.value?.isGit) {
      status.value = null
      gitCount.value = 0
      return
    }
    loading.value = true
    error.value = ''
    try {
      status.value = await call<GitStatus>('git_status')
      gitCount.value = status.value.files.length
    } catch (err) {
      error.value = String(err)
      status.value = null
      gitCount.value = 0
    } finally {
      loading.value = false
    }
  }

  async function loadBranches() {
    try {
      branches.value = await call<Branch[]>('git_branches')
    } catch {
      branches.value = []
    }
  }

  async function loadLog() {
    try {
      log.value = await call<Commit[]>('git_log', { limit: 40 })
    } catch {
      log.value = []
    }
  }

  async function loadWorktrees() {
    if (!ide.workspace.value?.isGit) {
      worktrees.value = []
      return
    }
    try {
      worktrees.value = (await call<Worktree[]>('git_worktrees')) ?? []
    } catch {
      worktrees.value = []
    }
  }

  async function addWorktree(path: string, branch: string, base?: string) {
    const out = await call<string>('git_worktree_add', { path, branch, base })
    await loadWorktrees()
    await loadBranches()
    return out
  }

  async function removeWorktree(path: string, force = false) {
    const out = await call<string>('git_worktree_remove', { path, force })
    await loadWorktrees()
    return out
  }

  async function pruneWorktrees() {
    const out = await call<string>('git_worktree_prune')
    await loadWorktrees()
    return out
  }

  async function stage(files: string[]) {
    await call('git_stage', { paths: files })
    await refresh()
  }

  async function unstage(files: string[]) {
    await call('git_unstage', { paths: files })
    await refresh()
  }

  async function stageAll() {
    await call('git_stage_all')
    await refresh()
  }

  async function discard(files: string[]) {
    await call('git_discard', { paths: files })
    await refresh()
  }

  async function commit(message: string) {
    const out = await call<string>('git_commit', { message })
    await refresh()
    return out
  }

  async function checkout(name: string) {
    await call('git_checkout_branch', { name })
    await refresh()
    await loadBranches()
    if (ide.workspace.value) ide.workspace.value.branch = name
  }

  async function createBranch(name: string) {
    await call('git_create_branch', { name })
    await refresh()
    await loadBranches()
  }

  async function pull() {
    const out = await call<string>('git_pull')
    await refresh()
    return out
  }

  async function push() {
    const out = await call<string>('git_push')
    await refresh()
    return out
  }

  async function fetch() {
    const out = await call<string>('git_fetch')
    await refresh()
    return out
  }

  return {
    status,
    branches,
    log,
    worktrees,
    loading,
    error,
    marks,
    gitCount,
    markFor,
    refresh,
    loadBranches,
    loadLog,
    loadWorktrees,
    addWorktree,
    removeWorktree,
    pruneWorktrees,
    stage,
    unstage,
    stageAll,
    discard,
    commit,
    checkout,
    createBranch,
    pull,
    push,
    fetch
  }
}
