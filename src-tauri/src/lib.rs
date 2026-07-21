mod commands;
mod tray;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
                    ],
                )
                .build(),
        )
        .setup(|app| {
            tray::create(app)?;
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
            commands::clipboard::clipboard_sequence_number,
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
