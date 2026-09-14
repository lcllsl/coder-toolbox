mod ai;
mod commands;
mod tray;
mod vault;

use std::{sync::Arc, time::Duration};
use tauri::{Emitter, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(vault::state::VaultState::default()))
        .manage(Arc::new(
            vault::clipboard::SensitiveClipboardState::default(),
        ))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:petal-toolbox.db",
                    vec![
                        Migration {
                            version: 1,
                            description: "create_health_reminder_logs",
                            sql: include_str!("../migrations/0001_initial.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 2,
                            description: "create_clipboard_items",
                            sql: include_str!("../migrations/0002_clipboard.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 3,
                            description: "create_temporary_transfer_items",
                            sql: include_str!("../migrations/0003_temporary_transfer.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 4,
                            description: "create_recent_features",
                            sql: include_str!("../migrations/0004_recent_features.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 5,
                            description: "create_encrypted_vault",
                            sql: include_str!("../migrations/0005_vault.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 6,
                            description: "create_smart_chart_projects",
                            sql: include_str!("../migrations/0006_smart_chart_projects.sql"),
                            kind: MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .setup(|app| {
            tray::create(app)?;
            let vault_state = app.state::<Arc<vault::state::VaultState>>().inner().clone();
            let vault_events = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(5));
                vault_state.lock_if_expired();
                if vault_state.take_pending_lock_event() {
                    let _ = vault_events.emit_to("panel-window", "vault:locked", ());
                }
            });
            if let Err(code) = commands::settings::register_saved_shortcut(app.handle()) {
                eprintln!("unable to register global shortcut: {code}");
            }
            if let Err(code) = commands::windows::position_orb_at_default(app.handle()) {
                eprintln!("unable to position orb: {code}");
            }

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "panel-window" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = commands::windows::close_panel(window.app_handle().clone(), false);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::ai::ai_status,
            commands::ai::ai_save_api_key,
            commands::ai::ai_delete_api_key,
            commands::ai::ai_test_connection,
            commands::ai::ai_generate_chart_plan,
            commands::ai::read_spreadsheet_file,
            commands::ai::write_report_html,
            commands::ai::open_report_html,
            commands::clipboard::clipboard_sequence_number,
            commands::clipboard::clipboard_should_ignore_sensitive,
            commands::files::system_directories,
            commands::files::directory_status,
            commands::files::open_directory,
            commands::files::create_date_directory,
            commands::files::copy_to_temporary_transfer,
            commands::files::delete_temporary_transfer_copy,
            commands::files::open_temporary_transfer_copy,
            commands::quick_actions::open_external_url,
            commands::quick_actions::application_status,
            commands::quick_actions::open_application,
            commands::settings::replace_global_shortcut,
            commands::settings::set_tray_mode,
            commands::settings::exit_application,
            commands::vault::vault_status,
            commands::vault::vault_initialize,
            commands::vault::vault_unlock,
            commands::vault::vault_list_items,
            commands::vault::vault_create_item,
            commands::vault::vault_update_item,
            commands::vault::vault_delete_item,
            commands::vault::vault_copy_item_field,
            commands::vault::vault_copy_text,
            commands::vault::vault_lock,
            commands::vault::vault_touch,
            commands::vault::vault_configure_auto_lock,
            commands::vault::vault_reset,
            commands::windows::open_panel,
            commands::windows::close_panel,
            commands::windows::trigger_health_debug_reminder,
            commands::windows::hide_orb,
            commands::windows::show_settings,
            commands::windows::set_orb_expanded,
            commands::windows::snap_orb_to_edge,
            commands::windows::set_orb_edge_collapsed,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run petal toolbox");
}
