use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_store::StoreExt;

use crate::tray;

const DEFAULT_SHORTCUT: &str = "Ctrl+Alt+Space";
const GLOBAL_SHORTCUT_EVENT: &str = "orb:global-shortcut";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutPayload {
    shortcut: String,
}

fn register_shortcut(app: &tauri::AppHandle, shortcut: &str) -> Result<(), String> {
    if app.global_shortcut().is_registered(shortcut) {
        return Ok(());
    }
    app.global_shortcut()
        .on_shortcut(shortcut, |app, shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            if let Some(orb) = app.get_webview_window("orb-window") {
                let visible = orb.is_visible().unwrap_or(true);
                if !visible {
                    let _ = orb.show();
                    let _ = orb.set_focus();
                } else {
                    let _ = orb.emit(
                        GLOBAL_SHORTCUT_EVENT,
                        ShortcutPayload {
                            shortcut: shortcut.to_string(),
                        },
                    );
                }
            }
        })
        .map_err(|_| "shortcut_register_failed".to_owned())
}

pub fn register_saved_shortcut(app: &tauri::AppHandle) -> Result<(), String> {
    let shortcut = app
        .store("settings.json")
        .ok()
        .and_then(|store| store.get("appSettings"))
        .and_then(|settings| {
            settings
                .get("globalShortcut")
                .and_then(|value| value.as_str())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| DEFAULT_SHORTCUT.to_owned());
    register_shortcut(app, &shortcut)
}

#[tauri::command]
pub fn replace_global_shortcut(
    app: tauri::AppHandle,
    next_shortcut: String,
    previous_shortcut: String,
) -> Result<(), String> {
    let next = next_shortcut.trim();
    if next.is_empty() {
        return Err("shortcut_empty".to_owned());
    }
    if next == previous_shortcut.trim() {
        return register_shortcut(&app, next);
    }
    register_shortcut(&app, next)?;
    if app
        .global_shortcut()
        .is_registered(previous_shortcut.as_str())
    {
        app.global_shortcut()
            .unregister(previous_shortcut.as_str())
            .map_err(|_| "previous_shortcut_unregister_failed".to_owned())?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_tray_mode(app: tauri::AppHandle, mode: String) -> Result<(), String> {
    tray::set_mode(&app, &mode)
}

#[tauri::command]
pub fn exit_application(app: tauri::AppHandle) {
    app.exit(0);
}
