import type { DbColumn, DbConnection, DbResult, DbTable } from '../lib/types'
import { call, pickDatabaseFile, pickSaveFile } from '../lib/api'

const STORAGE_KEY = 'kudo:db-connections'

export function useDatabase() {
  const ide = useIde()
  const connections = useState<DbConnection[]>('kudo:db-connections', () => [])
  const activeId = useState<string | null>('kudo:db-active', () => null)
  const tables = useState<DbTable[]>('kudo:db-tables', () => [])
  const schema = useState<DbColumn[]>('kudo:db-schema', () => [])
  const selectedTable = useState<string>('kudo:db-table', () => '')
  const result = useState<DbResult | null>('kudo:db-result', () => null)
  const lastSql = useState<string>('kudo:db-sql', () => '')
  const history = useState<string[]>('kudo:db-history', () => [])
  const busy = useState<boolean>('kudo:db-busy', () => false)
  const consoleOpen = useState<boolean>('kudo:db-console', () => false)
  const error = useState<string>('kudo:db-error', () => '')

  const active = computed(
    () => connections.value.find((c) => c.id === activeId.value) ?? null
  )

  function persistConnections() {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(connections.value.map((c) => ({ path: c.path, name: c.name })))
    )
  }

  function addHistory(sql: string) {
    const text = sql.trim()
    if (!text) return
    history.value = [text, ...history.value.filter((h) => h !== text)].slice(0, 40)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('kudo:db-history', JSON.stringify(history.value))
    }
  }

  function loadHistory() {
    if (typeof localStorage === 'undefined') return
    try {
      const raw = localStorage.getItem('kudo:db-history')
      if (raw) history.value = JSON.parse(raw)
    } catch {
      history.value = []
    }
  }

  async function connectToPath(path: string, create = false) {
    busy.value = true
    error.value = ''
    try {
      const handle = await call<DbConnection>('db_connect', { path, create })
      const existing = connections.value.find((c) => c.path === handle.path)
      if (existing) {
        connections.value = connections.value.map((c) =>
          c.path === handle.path ? { ...handle, id: existing.id } : c
        )
        handle.id = existing.id
      } else {
        connections.value = [...connections.value, handle]
      }
      activeId.value = handle.id
      persistConnections()
      await refreshTables()
      await openTable(tables.value[0]?.name ?? '')
      return handle
    } catch (err) {
      error.value = String(err)
      ide.notify(String(err), 'error')
      return null
    } finally {
      busy.value = false
    }
  }

  async function openDatabase() {
    const path = await pickDatabaseFile()
    if (!path) return null
    return connectToPath(path)
  }

  async function createDatabase() {
    const path = await pickSaveFile('kudo.sqlite', [
      { name: 'SQLite database', extensions: ['sqlite', 'db', 'sqlite3'] }
    ])
    if (!path) return null
    return connectToPath(path, true)
  }

  async function disconnect(id: string) {
    try {
      await call('db_disconnect', { id })
    } catch {
      /* connection may already be gone */
    }
    connections.value = connections.value.filter((c) => c.id !== id)
    persistConnections()
    if (activeId.value === id) {
      activeId.value = connections.value[0]?.id ?? null
      tables.value = []
      schema.value = []
      result.value = null
      selectedTable.value = ''
      if (activeId.value) await refreshTables()
    }
  }

  async function select(id: string) {
    activeId.value = id
    schema.value = []
    result.value = null
    selectedTable.value = ''
    await refreshTables()
    await openTable(tables.value[0]?.name ?? '')
  }

  async function refreshTables() {
    if (!activeId.value) return
    try {
      tables.value = await call<DbTable[]>('db_list_tables', { id: activeId.value })
      const conn = connections.value.find((c) => c.id === activeId.value)
      if (conn) conn.tables = tables.value.length
    } catch (err) {
      tables.value = []
      error.value = String(err)
    }
  }

  async function openTable(name: string) {
    if (!activeId.value || !name) return
    selectedTable.value = name
    try {
      schema.value = await call<DbColumn[]>('db_table_schema', {
        id: activeId.value,
        table: name
      })
    } catch {
      schema.value = []
    }
    const sql = `select * from "${name.replace(/"/g, '""')}" limit 200`
    consoleOpen.value = true
    await run(sql)
  }

  async function run(sql?: string) {
    const statement = (sql ?? lastSql.value).trim()
    if (!activeId.value || !statement) return null
    lastSql.value = statement
    busy.value = true
    error.value = ''
    try {
      const res = await call<DbResult>('db_query', {
        id: activeId.value,
        sql: statement,
        limit: 2000
      })
      result.value = res
      addHistory(statement)
      return res
    } catch (err) {
      error.value = String(err)
      result.value = null
      ide.notify(String(err), 'error')
      return null
    } finally {
      busy.value = false
    }
  }

  async function init() {
    if (connections.value.length) return
    loadHistory()
    let saved: { path: string; name: string }[] = []
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) saved = JSON.parse(raw)
    } catch {
      saved = []
    }
    for (const entry of saved.slice(0, 4)) {
      try {
        const handle = await call<DbConnection>('db_connect', { path: entry.path })
        connections.value = [...connections.value, handle]
        if (!activeId.value) activeId.value = handle.id
      } catch {
        /* file moved or deleted */
      }
    }
    if (activeId.value) await refreshTables()
  }

  return {
    connections,
    activeId,
    active,
    tables,
    schema,
    selectedTable,
    result,
    lastSql,
    history,
    busy,
    error,
    consoleOpen,
    init,
    openDatabase,
    createDatabase,
    connectToPath,
    disconnect,
    select,
    refreshTables,
    openTable,
    run
  }
}
