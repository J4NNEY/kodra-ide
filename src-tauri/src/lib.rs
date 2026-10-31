mod commands;
mod state;
mod util;

use state::AppState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            let state = app.state::<AppState>();
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            *state.config_dir.write() = config_dir;
            state.load_settings();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // workspace
            commands::workspace::open_workspace,
            commands::workspace::current_workspace,
            commands::workspace::close_workspace,
            commands::workspace::list_dir,
            commands::workspace::read_file,
            commands::workspace::write_file,
            commands::workspace::create_path,
            commands::workspace::rename_path,
            commands::workspace::delete_path,
            commands::workspace::reveal_in_file_manager,
            commands::workspace::search_files,
            commands::workspace::search_in_files,
            commands::workspace::replace_in_files,
            commands::workspace::workspace_stats,
            commands::workspace::export_text,
            // git
            commands::git::git_status,
            commands::git::git_branches,
            commands::git::git_stage,
            commands::git::git_unstage,
            commands::git::git_stage_all,
            commands::git::git_discard,
            commands::git::git_commit,
            commands::git::git_diff,
            commands::git::git_log,
            commands::git::git_checkout_branch,
            commands::git::git_create_branch,
            commands::git::git_push,
            commands::git::git_pull,
            commands::git::git_fetch,
            commands::git::git_worktrees,
            commands::git::git_worktree_add,
            commands::git::git_worktree_remove,
            commands::git::git_worktree_prune,
            // terminal
            commands::pty::pty_spawn,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
            commands::pty::pty_is_running,
            commands::pty::pty_kill_all,
            commands::pty::terminal_shells,
            // agent / ai
            commands::ai::ai_chat,
            commands::ai::ai_cancel,
            commands::ai::ai_probe,
            commands::exec::run_command,
            // settings
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::reset_settings,
            commands::settings::remove_recent_workspace,
            commands::settings::app_info,
            // database
            commands::db::db_connect,
            commands::db::db_disconnect,
            commands::db::db_list_tables,
            commands::db::db_table_schema,
            commands::db::db_query,
            commands::db::db_execute_script,
            commands::db::db_engine_info,
            // in-app browser / network
            commands::browser::browser_fetch,
            commands::browser::browser_open_external,
            commands::netlog::netlog_list,
            commands::netlog::netlog_clear,
            commands::netlog::browser_ping,
            // mcp
            commands::mcp::mcp_connect,
            commands::mcp::mcp_disconnect,
            commands::mcp::mcp_list_tools,
            commands::mcp::mcp_call_tool,
            commands::mcp::mcp_probe,
            // language servers
            commands::lsp::lsp_start,
            commands::lsp::lsp_stop,
            commands::lsp::lsp_request,
            commands::lsp::lsp_notify,
            commands::lsp::lsp_complete,
            commands::lsp::lsp_sessions,
            commands::lsp::lsp_detect,
            // debug adapters
            commands::dap::dap_start,
            commands::dap::dap_request,
            commands::dap::dap_stop,
            commands::dap::dap_detect,
            commands::dap::dap_sessions,
            // test runner
            commands::tests::tests_detect,
            commands::tests::test_run,
            commands::tests::test_cancel,
            commands::tests::test_cancel_all,
            commands::tests::tests_toolchain,
            // checkpoints
            commands::checkpoint::checkpoint_snapshot,
            commands::checkpoint::checkpoint_get,
            commands::checkpoint::checkpoint_list,
            commands::checkpoint::checkpoint_restore,
            commands::checkpoint::checkpoint_clear,
            // docker
            commands::docker::docker_info,
            commands::docker::docker_containers,
            commands::docker::docker_images,
            commands::docker::docker_action,
            commands::docker::docker_logs,
            commands::docker::docker_run_image,
            // skills
            commands::skills::skills_list,
            commands::skills::skill_read,
            commands::skills::skill_save,
            commands::skills::skill_scaffold,
            // extensions
            commands::extensions::extensions_list,
            commands::extensions::extensions_dir_path,
            commands::extensions::extension_install,
            commands::extensions::extension_set_enabled,
            commands::extensions::extension_remove,
            // updater
            commands::updater::update_check,
            commands::updater::update_download,
            commands::updater::update_install,
            commands::updater::update_reveal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kudo");
}
