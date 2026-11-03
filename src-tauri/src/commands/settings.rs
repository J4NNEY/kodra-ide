use serde::Serialize;
use tauri::State;

use crate::state::{AppState, Settings};

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.read().clone()
}

#[tauri::command]
pub fn save_settings(settings: Settings, state: State<'_, AppState>) -> Result<Settings, String> {
    {
        let mut current = state.settings.write();
        *current = settings;
    }
    state.persist_settings()?;
    Ok(state.settings.read().clone())
}

#[tauri::command]
pub fn reset_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    {
        let mut current = state.settings.write();
        let recents = current.recent_workspaces.clone();
        *current = Settings::default();
        current.recent_workspaces = recents;
    }
    state.persist_settings()?;
    Ok(state.settings.read().clone())
}

#[tauri::command]
pub fn remove_recent_workspace(path: String, state: State<'_, AppState>) -> Result<Settings, String> {
    {
        let mut current = state.settings.write();
        current.recent_workspaces.retain(|r| r.path != path);
    }
    state.persist_settings()?;
    Ok(state.settings.read().clone())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
    pub arch: String,
    pub config_dir: String,
}

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        name: "Kodra".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        platform: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        config_dir: state.config_dir.read().to_string_lossy().to_string(),
    }
}
