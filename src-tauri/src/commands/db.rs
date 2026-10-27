use std::path::Path;

use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbHandle {
    pub id: String,
    pub path: String,
    pub name: String,
    pub tables: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbTable {
    pub name: String,
    pub kind: String,
    pub rows: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbColumn {
    pub name: String,
    pub kind: String,
    pub not_null: bool,
    pub primary_key: bool,
    pub default_value: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub affected: usize,
    pub last_insert_id: i64,
    pub duration_ms: u64,
    pub truncated: bool,
}

fn open(path: &str, create: bool) -> Result<Connection, String> {
    let file = Path::new(path);
    let flags = if create {
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_URI
    } else {
        if !file.exists() {
            return Err(format!("database not found: {path}"));
        }
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_URI
    };
    Connection::open_with_flags(file, flags).map_err(|e| format!("sqlite: {e}"))
}

fn count_tables(conn: &Connection) -> usize {
    conn.query_row(
        "select count(*) from sqlite_master where type in ('table','view') and name not like 'sqlite_%'",
        [],
        |row| row.get::<_, i64>(0),
    )
    .unwrap_or(0) as usize
}

fn table_list(conn: &Connection) -> Vec<DbTable> {
    let mut out = Vec::new();
    let Ok(mut stmt) = conn.prepare(
        "select name, type from sqlite_master \
         where type in ('table','view') and name not like 'sqlite_%' order by name",
    ) else {
        return out;
    };
    let names: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default();

    for (name, kind) in names {
        let rows = conn
            .query_row(
                &format!("select count(*) from \"{}\"", name.replace('"', "\"\"")),
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0);
        out.push(DbTable { name, kind, rows });
    }
    out
}

#[tauri::command]
pub async fn db_connect(
    path: String,
    create: Option<bool>,
    state: State<'_, AppState>,
) -> Result<DbHandle, String> {
    let conn = open(&path, create.unwrap_or(false))?;
    let tables = count_tables(&conn);
    let name = Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&path)
        .to_string();
    let id = uuid::Uuid::new_v4().to_string();
    state
        .dbs
        .lock()
        .insert(id.clone(), crate::state::DbSession { conn });
    Ok(DbHandle {
        id,
        path,
        name,
        tables,
    })
}

#[tauri::command]
pub async fn db_disconnect(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.dbs.lock().remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn db_list_tables(
    id: String,
    state: State<'_, AppState>,
) -> Result<Vec<DbTable>, String> {
    let dbs = state.dbs.lock();
    let session = dbs.get(&id).ok_or("database is not connected")?;
    Ok(table_list(&session.conn))
}

#[tauri::command]
pub async fn db_table_schema(
    id: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<Vec<DbColumn>, String> {
    let dbs = state.dbs.lock();
    let session = dbs.get(&id).ok_or("database is not connected")?;
    let mut stmt = session
        .conn
        .prepare(&format!(
            "pragma table_info(\"{}\")",
            table.replace('"', "\"\"")
        ))
        .map_err(|e| e.to_string())?;
    let cols = stmt
        .query_map([], |row| {
            Ok(DbColumn {
                name: row.get(1)?,
                kind: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                not_null: row.get::<_, i64>(3)? != 0,
                default_value: row.get(4)?,
                primary_key: row.get::<_, i64>(5)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    Ok(cols)
}

fn value_to_json(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(v) => json!(v),
        ValueRef::Real(v) => json!(v),
        ValueRef::Text(bytes) => Value::String(String::from_utf8_lossy(bytes).to_string()),
        ValueRef::Blob(bytes) => Value::String(format!("<blob {} bytes>", bytes.len())),
    }
}

/// Execute a single statement and return rows when the statement produces output.
#[tauri::command]
pub async fn db_query(
    id: String,
    sql: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<DbResult, String> {
    let started = std::time::Instant::now();
    let limit = limit.unwrap_or(2_000).clamp(1, 20_000);
    let dbs = state.dbs.lock();
    let session = dbs.get(&id).ok_or("database is not connected")?;

    let mut stmt = session.conn.prepare(&sql).map_err(|e| e.to_string())?;
    let column_count = stmt.column_count();

    if column_count == 0 {
        let affected = stmt.execute([]).map_err(|e| e.to_string())?;
        return Ok(DbResult {
            columns: Vec::new(),
            rows: Vec::new(),
            affected,
            last_insert_id: session.conn.last_insert_rowid(),
            duration_ms: started.elapsed().as_millis() as u64,
            truncated: false,
        });
    }

    let columns: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
    let mut rows_out: Vec<Vec<Value>> = Vec::new();
    let mut truncated = false;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        if rows_out.len() >= limit {
            truncated = true;
            break;
        }
        let mut values = Vec::with_capacity(column_count);
        for idx in 0..column_count {
            let value = row.get_ref(idx).map_err(|e| e.to_string())?;
            values.push(value_to_json(value));
        }
        rows_out.push(values);
    }

    Ok(DbResult {
        columns,
        rows: rows_out,
        affected: 0,
        last_insert_id: session.conn.last_insert_rowid(),
        duration_ms: started.elapsed().as_millis() as u64,
        truncated,
    })
}

/// Run a multi-statement script. Returns per-statement summaries plus the final
/// result set when the last statement was a query.
#[tauri::command]
pub async fn db_execute_script(
    id: String,
    sql: String,
    state: State<'_, AppState>,
) -> Result<DbResult, String> {
    let started = std::time::Instant::now();
    let dbs = state.dbs.lock();
    let session = dbs.get(&id).ok_or("database is not connected")?;

    let mut affected_total = 0usize;
    let mut columns = Vec::new();
    let mut rows_out: Vec<Vec<Value>> = Vec::new();

    let safe = sql.trim();
    if safe.is_empty() {
        return Err("statement is empty".into());
    }

    // `execute_batch` handles comments, triggers and multi-line scripts. When the
    // script is a single SELECT we fall back to `db_query` semantics through
    // prepare so the grid stays populated.
    let is_read = {
        let head = safe
            .trim_start_matches(|c: char| c.is_whitespace() || c == '(')
            .to_ascii_lowercase();
        head.starts_with("select")
            || head.starts_with("with")
            || head.starts_with("pragma")
            || head.starts_with("explain")
    };

    if is_read {
        let mut stmt = session.conn.prepare(safe).map_err(|e| e.to_string())?;
        let count = stmt.column_count();
        columns = stmt.column_names().iter().map(|c| c.to_string()).collect();
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let mut values = Vec::with_capacity(count);
            for idx in 0..count {
                values.push(value_to_json(
                    row.get_ref(idx).map_err(|e| e.to_string())?,
                ));
            }
            rows_out.push(values);
            if rows_out.len() >= 2_000 {
                break;
            }
        }
    } else {
        affected_total = session
            .conn
            .execute_batch(safe)
            .map(|_| session.conn.changes() as usize)
            .map_err(|e| e.to_string())?;
    }

    Ok(DbResult {
        columns,
        rows: rows_out,
        affected: affected_total,
        last_insert_id: session.conn.last_insert_rowid(),
        duration_ms: started.elapsed().as_millis() as u64,
        truncated: false,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqliteInfo {
    pub version: String,
    pub available: bool,
}

#[tauri::command]
pub async fn db_engine_info() -> Result<SqliteInfo, String> {
    Ok(SqliteInfo {
        version: rusqlite::version().to_string(),
        available: true,
    })
}
