use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

use crate::commands::windows;

const MODE_EVENT: &str = "app:mode-requested";

#[derive(Clone)]
pub struct TrayModeItems {
    work: CheckMenuItem<tauri::Wry>,
    silent: CheckMenuItem<tauri::Wry>,
    paused: CheckMenuItem<tauri::Wry>,
}

#[derive(Clone, serde::Serialize)]
struct ModePayload<'a> {
    mode: &'a str,
}

pub fn set_mode(app: &tauri::AppHandle, mode: &str) -> Result<(), String> {
    if !matches!(mode, "work" | "silent" | "paused") {
        return Err("unknown_app_mode".to_owned());
    }
    let items = app.state::<TrayModeItems>();
    items
        .work
        .set_checked(mode == "work")
        .map_err(|_| "tray_mode_update_failed".to_owned())?;
    items
        .silent
        .set_checked(mode == "silent")
        .map_err(|_| "tray_mode_update_failed".to_owned())?;
    items
        .paused
        .set_checked(mode == "paused")
        .map_err(|_| "tray_mode_update_failed".to_owned())
}

pub fn create(app: &tauri::App) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle_orb", "显示/隐藏悬浮球", true, None::<&str>)?;
    let work_mode = CheckMenuItem::with_id(app, "work_mode", "工作模式", true, true, None::<&str>)?;
    let silent_mode =
        CheckMenuItem::with_id(app, "silent_mode", "静默模式", true, false, None::<&str>)?;
    let paused = CheckMenuItem::with_id(app, "paused", "完全暂停", true, false, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &toggle,
            &work_mode,
            &silent_mode,
            &paused,
            &settings,
            &separator,
            &quit,
        ],
    )?;
    app.manage(TrayModeItems {
        work: work_mode.clone(),
        silent: silent_mode.clone(),
        paused: paused.clone(),
    });

    let mut tray_builder = TrayIconBuilder::with_id("petal-toolbox-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle_orb" => {
                let _ = windows::toggle_orb_visibility(app);
            }
            "settings" => {
                let _ = windows::show_settings(app.clone());
            }
            "work_mode" | "silent_mode" | "paused" => {
                let mode = match event.id().as_ref() {
                    "silent_mode" => "silent",
                    "paused" => "paused",
                    _ => "work",
                };
                let _ = set_mode(app, mode);
                let _ = app.emit_to("orb-window", MODE_EVENT, ModePayload { mode });
                let _ = app.emit_to("panel-window", MODE_EVENT, ModePayload { mode });
            }
            "quit" => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    tray_builder.build(app)?;
    Ok(())
}
