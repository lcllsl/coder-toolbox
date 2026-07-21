use std::{thread, time::Duration};

use serde::Serialize;
use serde_json::json;
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri_plugin_store::StoreExt;

const ORB_WINDOW: &str = "orb-window";
const PANEL_WINDOW: &str = "panel-window";
const PANEL_NAVIGATE_EVENT: &str = "panel:navigate";
const ORB_PANEL_CLOSED_EVENT: &str = "orb:panel-closed";
const COLLAPSED_ORB_SIZE: f64 = 88.0;
const EXPANDED_ORB_SIZE: f64 = 340.0;
const EDGE_MARGIN: f64 = 12.0;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PanelNavigationPayload<'a> {
    category: &'a str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PanelClosedPayload {
    reopen_petals: bool,
    debug_reminder_id: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrbWindowGeometry {
    width: f64,
    height: f64,
    orb_x: f64,
    orb_y: f64,
    horizontal: &'static str,
    vertical: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapResult {
    edge: &'static str,
    x: f64,
    y: f64,
}

fn expanded_orb_placement(
    snap_edge: Option<&str>,
    center_x: i32,
    work_center_x: i32,
    relative_y: f64,
) -> (&'static str, &'static str, f64, f64) {
    let vertical = if relative_y < 0.35 {
        "down"
    } else if relative_y > 0.65 {
        "up"
    } else {
        "center"
    };
    let preferred_orb_y = match vertical {
        "down" => 44.0,
        "up" => 296.0,
        _ => EXPANDED_ORB_SIZE / 2.0,
    };

    match snap_edge {
        Some("top") => ("center", "down", EXPANDED_ORB_SIZE / 2.0, 44.0),
        Some("bottom") => ("center", "up", EXPANDED_ORB_SIZE / 2.0, 296.0),
        Some("left") => ("right", vertical, 44.0, preferred_orb_y),
        Some("right") => ("left", vertical, 296.0, preferred_orb_y),
        _ if center_x >= work_center_x => ("left", vertical, 296.0, preferred_orb_y),
        _ => ("right", vertical, 44.0, preferred_orb_y),
    }
}

fn panel_size(category: &str) -> Result<LogicalSize<f64>, String> {
    match category {
        "health" => Ok(LogicalSize::new(520.0, 560.0)),
        "clipboard" => Ok(LogicalSize::new(680.0, 720.0)),
        "dev-tools" => Ok(LogicalSize::new(760.0, 620.0)),
        "files" => Ok(LogicalSize::new(620.0, 620.0)),
        "quick-actions" | "settings" => Ok(LogicalSize::new(560.0, 540.0)),
        _ => Err("unknown_panel_category".to_owned()),
    }
}

fn emit_panel_navigation(panel: &WebviewWindow, category: &str) -> Result<(), String> {
    panel
        .emit(PANEL_NAVIGATE_EVENT, PanelNavigationPayload { category })
        .map_err(|_| "panel_navigation_failed".to_owned())
}

fn show_panel(app: &tauri::AppHandle, category: &str) -> Result<(), String> {
    let panel = app
        .get_webview_window(PANEL_WINDOW)
        .ok_or_else(|| "panel_window_missing".to_owned())?;

    position_panel_near_orb(app, &panel, panel_size(category)?)?;
    emit_panel_navigation(&panel, category)?;
    panel.show().map_err(|_| "panel_show_failed".to_owned())?;
    panel
        .set_focus()
        .map_err(|_| "panel_focus_failed".to_owned())?;

    Ok(())
}

fn position_panel_near_orb(
    app: &tauri::AppHandle,
    panel: &WebviewWindow,
    logical_size: LogicalSize<f64>,
) -> Result<(), String> {
    let orb = app
        .get_webview_window(ORB_WINDOW)
        .ok_or_else(|| "orb_window_missing".to_owned())?;
    let monitor = orb
        .current_monitor()
        .map_err(|_| "current_monitor_failed".to_owned())?
        .or_else(|| orb.primary_monitor().ok().flatten())
        .ok_or_else(|| "monitor_missing".to_owned())?;
    let work_area = monitor.work_area();
    let orb_position = orb
        .outer_position()
        .map_err(|_| "orb_position_read_failed".to_owned())?;
    let orb_size = orb
        .outer_size()
        .map_err(|_| "orb_size_read_failed".to_owned())?;
    let scale = monitor.scale_factor();
    let gap = (16.0 * scale).round() as i32;
    let requested_size: PhysicalSize<u32> = logical_size.to_physical(scale);
    let panel_size = PhysicalSize::new(
        requested_size
            .width
            .min((work_area.size.width as f64 * 0.8).round() as u32),
        requested_size
            .height
            .min((work_area.size.height as f64 * 0.8).round() as u32),
    );
    panel
        .set_size(panel_size)
        .map_err(|_| "panel_resize_failed".to_owned())?;
    let orb_center_x = orb_position.x + orb_size.width as i32 / 2;
    let orb_center_y = orb_position.y + orb_size.height as i32 / 2;
    let work_right = work_area.position.x + work_area.size.width as i32;
    let work_bottom = work_area.position.y + work_area.size.height as i32;

    let preferred_x = if orb_center_x >= work_area.position.x + work_area.size.width as i32 / 2 {
        orb_position.x - panel_size.width as i32 - gap
    } else {
        orb_position.x + orb_size.width as i32 + gap
    };
    let x = preferred_x.clamp(
        work_area.position.x + gap,
        work_right - panel_size.width as i32 - gap,
    );
    let y = (orb_center_y - panel_size.height as i32 / 2).clamp(
        work_area.position.y + gap,
        work_bottom - panel_size.height as i32 - gap,
    );

    panel
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|_| "panel_position_failed".to_owned())
}

pub fn toggle_orb_visibility(app: &tauri::AppHandle) -> Result<(), String> {
    let orb = app
        .get_webview_window(ORB_WINDOW)
        .ok_or_else(|| "orb_window_missing".to_owned())?;
    let visible = orb
        .is_visible()
        .map_err(|_| "orb_visibility_read_failed".to_owned())?;

    if visible {
        orb.hide().map_err(|_| "orb_hide_failed".to_owned())
    } else {
        orb.show().map_err(|_| "orb_show_failed".to_owned())?;
        orb.set_focus().map_err(|_| "orb_focus_failed".to_owned())
    }
}

#[tauri::command]
pub fn open_panel(app: tauri::AppHandle, category: String) -> Result<(), String> {
    show_panel(&app, &category)
}

#[tauri::command]
pub fn show_settings(app: tauri::AppHandle) -> Result<(), String> {
    show_panel(&app, "settings")
}

#[tauri::command]
pub fn close_panel(app: tauri::AppHandle, reopen_petals: bool) -> Result<(), String> {
    let panel = app
        .get_webview_window(PANEL_WINDOW)
        .ok_or_else(|| "panel_window_missing".to_owned())?;
    panel.hide().map_err(|_| "panel_hide_failed".to_owned())?;
    let orb = app
        .get_webview_window(ORB_WINDOW)
        .ok_or_else(|| "orb_window_missing".to_owned())?;
    orb.emit(
        ORB_PANEL_CLOSED_EVENT,
        PanelClosedPayload {
            reopen_petals,
            debug_reminder_id: None,
        },
    )
    .map_err(|_| "orb_panel_event_failed".to_owned())
}

#[tauri::command]
pub fn trigger_health_debug_reminder(
    app: tauri::AppHandle,
    reminder_id: String,
) -> Result<(), String> {
    if !matches!(
        reminder_id.as_str(),
        "stand" | "water" | "pelvic_floor" | "eye_rest" | "posture"
    ) {
        return Err("unknown_reminder_id".to_owned());
    }
    let panel = app
        .get_webview_window(PANEL_WINDOW)
        .ok_or_else(|| "panel_window_missing".to_owned())?;
    panel.hide().map_err(|_| "panel_hide_failed".to_owned())?;
    let orb = app
        .get_webview_window(ORB_WINDOW)
        .ok_or_else(|| "orb_window_missing".to_owned())?;
    orb.emit(
        ORB_PANEL_CLOSED_EVENT,
        PanelClosedPayload {
            reopen_petals: false,
            debug_reminder_id: Some(reminder_id),
        },
    )
    .map_err(|_| "orb_panel_event_failed".to_owned())
}

#[tauri::command]
pub fn hide_orb(app: tauri::AppHandle) -> Result<(), String> {
    let orb = app
        .get_webview_window(ORB_WINDOW)
        .ok_or_else(|| "orb_window_missing".to_owned())?;
    orb.hide().map_err(|_| "orb_hide_failed".to_owned())
}

#[tauri::command]
pub fn set_orb_expanded(
    app: tauri::AppHandle,
    expanded: bool,
    anchor_x: Option<f64>,
    anchor_y: Option<f64>,
    snap_edge: Option<String>,
) -> Result<OrbWindowGeometry, String> {
    let orb = app
        .get_webview_window(ORB_WINDOW)
        .ok_or_else(|| "orb_window_missing".to_owned())?;
    let scale = orb
        .scale_factor()
        .map_err(|_| "orb_scale_factor_failed".to_owned())?;
    let current_position = orb
        .outer_position()
        .map_err(|_| "orb_position_read_failed".to_owned())?;
    let current_size = orb
        .outer_size()
        .map_err(|_| "orb_size_read_failed".to_owned())?;
    if !expanded {
        let current_logical_size = current_size.to_logical::<f64>(scale);
        let local_x = anchor_x.unwrap_or(current_logical_size.width / 2.0);
        let local_y = anchor_y.unwrap_or(current_logical_size.height / 2.0);
        let center_x = current_position.x + (local_x * scale).round() as i32;
        let center_y = current_position.y + (local_y * scale).round() as i32;
        let collapsed_physical = (COLLAPSED_ORB_SIZE * scale).round() as i32;
        let next_position = PhysicalPosition::new(
            center_x - collapsed_physical / 2,
            center_y - collapsed_physical / 2,
        );

        orb.set_position(next_position)
            .map_err(|_| "orb_position_failed".to_owned())?;
        orb.set_size(LogicalSize::new(COLLAPSED_ORB_SIZE, COLLAPSED_ORB_SIZE))
            .map_err(|_| "orb_resize_failed".to_owned())?;

        return Ok(OrbWindowGeometry {
            width: COLLAPSED_ORB_SIZE,
            height: COLLAPSED_ORB_SIZE,
            orb_x: COLLAPSED_ORB_SIZE / 2.0,
            orb_y: COLLAPSED_ORB_SIZE / 2.0,
            horizontal: if local_x >= current_logical_size.width / 2.0 {
                "left"
            } else {
                "right"
            },
            vertical: "center",
        });
    }

    let monitor = orb
        .current_monitor()
        .map_err(|_| "current_monitor_failed".to_owned())?
        .or_else(|| orb.primary_monitor().ok().flatten())
        .ok_or_else(|| "monitor_missing".to_owned())?;
    let work_area = monitor.work_area();
    let center_x = current_position.x + current_size.width as i32 / 2;
    let center_y = current_position.y + current_size.height as i32 / 2;
    let work_right = work_area.position.x + work_area.size.width as i32;
    let work_bottom = work_area.position.y + work_area.size.height as i32;
    let relative_y = (center_y - work_area.position.y) as f64 / work_area.size.height as f64;
    let work_center_x = work_area.position.x + work_area.size.width as i32 / 2;
    let (horizontal, vertical, preferred_orb_x, preferred_orb_y) =
        expanded_orb_placement(snap_edge.as_deref(), center_x, work_center_x, relative_y);
    let expanded_physical = (EXPANDED_ORB_SIZE * scale).round() as i32;
    let preferred_x = center_x - (preferred_orb_x * scale).round() as i32;
    let preferred_y = center_y - (preferred_orb_y * scale).round() as i32;
    let next_x = preferred_x.clamp(work_area.position.x, work_right - expanded_physical);
    let next_y = preferred_y.clamp(work_area.position.y, work_bottom - expanded_physical);
    let next_position = PhysicalPosition::new(next_x, next_y);

    orb.set_position(next_position)
        .map_err(|_| "orb_position_failed".to_owned())?;
    orb.set_size(LogicalSize::new(EXPANDED_ORB_SIZE, EXPANDED_ORB_SIZE))
        .map_err(|_| "orb_resize_failed".to_owned())?;

    Ok(OrbWindowGeometry {
        width: EXPANDED_ORB_SIZE,
        height: EXPANDED_ORB_SIZE,
        orb_x: (center_x - next_x) as f64 / scale,
        orb_y: (center_y - next_y) as f64 / scale,
        horizontal,
        vertical,
    })
}

fn animate_position(window: &WebviewWindow, target: PhysicalPosition<i32>) -> Result<(), String> {
    let start = window
        .outer_position()
        .map_err(|_| "orb_position_read_failed".to_owned())?;
    let frames = 14;
    for frame in 1..=frames {
        let t = frame as f64 / frames as f64;
        let eased = 1.0 - (1.0 - t).powi(3);
        let x = start.x as f64 + (target.x - start.x) as f64 * eased;
        let y = start.y as f64 + (target.y - start.y) as f64 * eased;
        window
            .set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
            .map_err(|_| "orb_position_failed".to_owned())?;
        thread::sleep(Duration::from_millis(16));
    }
    Ok(())
}

#[tauri::command]
pub async fn snap_orb_to_edge(app: tauri::AppHandle) -> Result<SnapResult, String> {
    let orb = app
        .get_webview_window(ORB_WINDOW)
        .ok_or_else(|| "orb_window_missing".to_owned())?;
    let monitor = orb
        .current_monitor()
        .map_err(|_| "current_monitor_failed".to_owned())?
        .or_else(|| orb.primary_monitor().ok().flatten())
        .ok_or_else(|| "monitor_missing".to_owned())?;
    let work = monitor.work_area();
    let position = orb
        .outer_position()
        .map_err(|_| "orb_position_read_failed".to_owned())?;
    let size = orb
        .outer_size()
        .map_err(|_| "orb_size_read_failed".to_owned())?;
    let scale = monitor.scale_factor();
    let margin = (EDGE_MARGIN * scale).round() as i32;
    let right = work.position.x + work.size.width as i32;
    let bottom = work.position.y + work.size.height as i32;
    let normal_left = work.position.x + margin;
    let normal_right = right - size.width as i32 - margin;
    let normal_top = work.position.y + margin;
    let normal_bottom = bottom - size.height as i32 - margin;
    let distances = [
        ("left", (position.x - normal_left).abs()),
        ("right", (position.x - normal_right).abs()),
        ("top", (position.y - normal_top).abs()),
        ("bottom", (position.y - normal_bottom).abs()),
    ];
    let edge = distances
        .iter()
        .min_by_key(|(_, distance)| *distance)
        .map(|(edge, _)| *edge)
        .ok_or_else(|| "snap_edge_missing".to_owned())?;
    let target = match edge {
        "left" => PhysicalPosition::new(normal_left, position.y.clamp(normal_top, normal_bottom)),
        "right" => PhysicalPosition::new(normal_right, position.y.clamp(normal_top, normal_bottom)),
        "top" => PhysicalPosition::new(position.x.clamp(normal_left, normal_right), normal_top),
        _ => PhysicalPosition::new(position.x.clamp(normal_left, normal_right), normal_bottom),
    };
    let animation_window = orb.clone();
    tauri::async_runtime::spawn_blocking(move || animate_position(&animation_window, target))
        .await
        .map_err(|_| "snap_animation_failed".to_owned())??;

    if let Ok(store) = app.store("settings.json") {
        store.set(
            "orbPosition",
            json!({ "x": target.x, "y": target.y, "edge": edge }),
        );
        let _ = store.save();
    }

    Ok(SnapResult {
        edge,
        x: target.x as f64 / scale,
        y: target.y as f64 / scale,
    })
}

#[tauri::command]
pub async fn set_orb_edge_collapsed(
    app: tauri::AppHandle,
    edge: String,
    collapsed: bool,
) -> Result<(), String> {
    let orb = app
        .get_webview_window(ORB_WINDOW)
        .ok_or_else(|| "orb_window_missing".to_owned())?;
    let monitor = orb
        .current_monitor()
        .map_err(|_| "current_monitor_failed".to_owned())?
        .or_else(|| orb.primary_monitor().ok().flatten())
        .ok_or_else(|| "monitor_missing".to_owned())?;
    let work = monitor.work_area();
    let position = orb
        .outer_position()
        .map_err(|_| "orb_position_read_failed".to_owned())?;
    let size = orb
        .outer_size()
        .map_err(|_| "orb_size_read_failed".to_owned())?;
    let scale = monitor.scale_factor();
    let margin = (EDGE_MARGIN * scale).round() as i32;
    let hidden_x = (size.width as f64 * 0.35).round() as i32;
    let hidden_y = (size.height as f64 * 0.35).round() as i32;
    let right = work.position.x + work.size.width as i32;
    let bottom = work.position.y + work.size.height as i32;
    let normal_left = work.position.x + margin;
    let normal_right = right - size.width as i32 - margin;
    let normal_top = work.position.y + margin;
    let normal_bottom = bottom - size.height as i32 - margin;
    let target = match (edge.as_str(), collapsed) {
        ("left", true) => PhysicalPosition::new(work.position.x - hidden_x, position.y),
        ("right", true) => PhysicalPosition::new(right - size.width as i32 + hidden_x, position.y),
        ("top", true) => PhysicalPosition::new(position.x, work.position.y - hidden_y),
        ("bottom", true) => {
            PhysicalPosition::new(position.x, bottom - size.height as i32 + hidden_y)
        }
        ("left", false) => PhysicalPosition::new(normal_left, position.y),
        ("right", false) => PhysicalPosition::new(normal_right, position.y),
        ("top", false) => PhysicalPosition::new(position.x, normal_top),
        ("bottom", false) => PhysicalPosition::new(position.x, normal_bottom),
        _ => return Err("unknown_snap_edge".to_owned()),
    };

    let animation_window = orb.clone();
    tauri::async_runtime::spawn_blocking(move || animate_position(&animation_window, target))
        .await
        .map_err(|_| "edge_animation_failed".to_owned())??;

    Ok(())
}

pub fn position_orb_at_default(app: &tauri::AppHandle) -> Result<(), String> {
    let orb = app
        .get_webview_window(ORB_WINDOW)
        .ok_or_else(|| "orb_window_missing".to_owned())?;
    let primary_monitor = orb
        .primary_monitor()
        .map_err(|_| "primary_monitor_failed".to_owned())?
        .ok_or_else(|| "primary_monitor_missing".to_owned())?;
    let orb_size = orb
        .outer_size()
        .map_err(|_| "orb_size_read_failed".to_owned())?;
    let persisted = app
        .store("settings.json")
        .ok()
        .and_then(|store| store.get("orbPosition"))
        .and_then(|value| {
            Some((
                value.get("x")?.as_i64()? as i32,
                value.get("y")?.as_i64()? as i32,
            ))
        });
    let available_monitors = orb
        .available_monitors()
        .map_err(|_| "available_monitors_failed".to_owned())?;
    let selected_monitor = persisted
        .and_then(|(x, y)| {
            let center_x = x + orb_size.width as i32 / 2;
            let center_y = y + orb_size.height as i32 / 2;
            available_monitors.iter().find(|monitor| {
                let work = monitor.work_area();
                center_x >= work.position.x
                    && center_x < work.position.x + work.size.width as i32
                    && center_y >= work.position.y
                    && center_y < work.position.y + work.size.height as i32
            })
        })
        .unwrap_or(&primary_monitor);
    let work_area = selected_monitor.work_area();
    let work_right = work_area.position.x + work_area.size.width as i32;
    let work_bottom = work_area.position.y + work_area.size.height as i32;
    let default_x = work_right - orb_size.width as i32 - 16;
    let default_y = work_area.position.y + (work_area.size.height as f64 * 0.75) as i32
        - orb_size.height as i32;
    let (x, y) = persisted.unwrap_or((default_x, default_y));
    let x = x.clamp(work_area.position.x, work_right - orb_size.width as i32);
    let y = y.clamp(work_area.position.y, work_bottom - orb_size.height as i32);

    orb.set_position(PhysicalPosition::new(x, y))
        .map_err(|_| "orb_position_failed".to_owned())
}

#[cfg(test)]
mod tests {
    use super::{expanded_orb_placement, panel_size, COLLAPSED_ORB_SIZE, EXPANDED_ORB_SIZE};

    #[test]
    fn accepts_only_known_panel_destinations() {
        assert!(panel_size("health").is_ok());
        assert!(panel_size("settings").is_ok());
        assert_eq!(panel_size("unknown").unwrap_err(), "unknown_panel_category");
    }

    #[test]
    fn expanded_window_leaves_room_for_the_orb_and_petals() {
        assert!(EXPANDED_ORB_SIZE > COLLAPSED_ORB_SIZE * 3.0);
    }

    #[test]
    fn vertical_edges_use_centered_opposing_semicircles() {
        assert_eq!(
            expanded_orb_placement(Some("top"), 900, 500, 0.0),
            ("center", "down", 170.0, 44.0)
        );
        assert_eq!(
            expanded_orb_placement(Some("bottom"), 100, 500, 1.0),
            ("center", "up", 170.0, 296.0)
        );
    }

    #[test]
    fn horizontal_edges_keep_their_inward_direction() {
        assert_eq!(
            expanded_orb_placement(Some("left"), 900, 500, 0.5),
            ("right", "center", 44.0, 170.0)
        );
        assert_eq!(
            expanded_orb_placement(Some("right"), 100, 500, 0.8),
            ("left", "up", 296.0, 296.0)
        );
    }
}
