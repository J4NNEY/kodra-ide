import { call, isTauri } from '../lib/api'

export interface CheckpointFile {
  path: string
  rel: string
  existed: boolean
  changed: boolean
  size: number
}

export interface CheckpointSummary {
  id: string
  label: string
  createdAt: number
  files: CheckpointFile[]
}

export interface SnapshotResult {
  checkpointId: string
  created: boolean
  files: number
}

export interface RestoreResult {
  restored: number
  deleted: number
  skipped: number
}

/** Checkpoints taken by the agent, grouped per workspace and kept in the app config dir. */
export function useCheckpoints() {
  const ide = useIde()

  /** Id of the checkpoint for the turn that is currently running (created lazily). */
  const turnId = useState<string | null>('kudo:checkpoint-turn', () => null)
  const turnLabel = useState<string>('kudo:checkpoint-label', () => '')
  const summaries = useState<Record<string, CheckpointSummary>>(
    'kudo:checkpoint-cache',
    () => ({})
  )
  const recent = useState<CheckpointSummary[]>('kudo:checkpoint-list', () => [])
  const loading = useState<boolean>('kudo:checkpoint-loading', () => false)

  /** Start a fresh checkpoint scope; the first snapshot creates the checkpoint. */
  function beginTurn(label = '') {
    turnId.value = null
    turnLabel.value = label.trim().slice(0, 80)
  }

  /**
   * Copy `path` into the current turn's checkpoint before the agent touches it.
   * Returns the checkpoint id (null when no workspace is open).
   */
  async function snapshot(path: string, label?: string): Promise<string | null> {
    if (!path || !ide.workspace.value) return null
    if (!isTauri()) return null
    try {
      const result = await call<SnapshotResult>('checkpoint_snapshot', {
        id: turnId.value ?? undefined,
        path,
        label: turnId.value ? undefined : label ?? turnLabel.value ?? undefined
      })
      if (!result?.checkpointId) return null
      turnId.value = result.checkpointId
      delete summaries.value[result.checkpointId]
      summaries.value = { ...summaries.value }
      return result.checkpointId
    } catch (err) {
      ide.notify(`Checkpoint failed: ${String(err)}`, 'error')
      return null
    }
  }

  async function get(id: string): Promise<CheckpointSummary | null> {
    const cached = summaries.value[id]
    if (cached) return cached
    if (!isTauri()) return null
    try {
      const summary = await call<CheckpointSummary>('checkpoint_get', { id })
      if (!summary) return null
      summaries.value = { ...summaries.value, [id]: summary }
      return summary
    } catch {
      return null
    }
  }

  async function load(id: string) {
    await get(id)
  }

  async function list(limit = 20): Promise<CheckpointSummary[]> {
    if (!isTauri()) return []
    loading.value = true
    try {
      const found = await call<CheckpointSummary[]>('checkpoint_list', { limit })
      recent.value = found ?? []
      const next = { ...summaries.value }
      for (const checkpoint of recent.value) next[checkpoint.id] = checkpoint
      summaries.value = next
      return recent.value
    } catch {
      return []
    } finally {
      loading.value = false
    }
  }

  /** Reload any open editor tab whose file was touched by a checkpoint. */
  async function reloadTabs(files: CheckpointFile[]) {
    if (!files.length) return
    for (const file of files) {
      const tab = ide.tabs.value.find((t) => t.path === file.path)
      if (!tab) continue
      try {
        const payload = await call<{ text: string; binary: boolean }>('read_file', {
          path: file.path
        })
        tab.content = payload.text
        tab.savedContent = payload.text
        tab.binary = payload.binary
        tab.dirty = false
      } catch {
        // The file no longer exists (the agent created it): close the tab.
        ide.removeTabs([file.path])
      }
    }
  }

  /** Put every file touched by `id` back and clean up the UI. */
  async function restore(id: string): Promise<RestoreResult | null> {
    if (!isTauri()) {
      ide.notify('Checkpoints need the desktop build', 'error')
      return null
    }
    const summary = summaries.value[id] ?? (await get(id))
    try {
      const result = await call<RestoreResult>('checkpoint_restore', { id })
      if (!result) return null
      await reloadTabs(summary?.files ?? [])
      useState<number>('kudo:tree-version', () => 0).value++
      useGit().refresh()
      delete summaries.value[id]
      summaries.value = { ...summaries.value }
      await list()
      const parts = [`${result.restored} restored`]
      if (result.deleted) parts.push(`${result.deleted} removed`)
      if (result.skipped) parts.push(`${result.skipped} skipped`)
      ide.notify(parts.join(', '), result.skipped ? 'info' : 'success')
      return result
    } catch (err) {
      ide.notify(`Restore failed: ${String(err)}`, 'error')
      return null
    }
  }

  async function clear() {
    if (!isTauri()) return
    try {
      await call('checkpoint_clear')
      summaries.value = {}
      recent.value = []
      turnId.value = null
      ide.notify('Checkpoints cleared')
    } catch (err) {
      ide.notify(String(err), 'error')
    }
  }

  return {
    turnId,
    recent,
    summaries,
    loading,
    beginTurn,
    snapshot,
    get,
    load,
    list,
    restore,
    clear
  }
}
