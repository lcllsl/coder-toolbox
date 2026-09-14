use std::{
    io::ErrorKind,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Manager, WebviewWindow};

use crate::ai::{client, config, DEEPSEEK_MODELS};

const MAX_SPREADSHEET_BYTES: u64 = 50 * 1024 * 1024;
const MAX_REPORT_BYTES: usize = 24 * 1024 * 1024;
const PANEL_WINDOW: &str = "panel-window";
const AI_SERVICE_FILE: &str = "ai-service.json";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiServiceData {
    deepseek_api_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    provider: &'static str,
    has_api_key: bool,
    models: [&'static str; 2],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetFilePayload {
    file_name: String,
    size_bytes: u64,
    base64: String,
}

fn is_supported_spreadsheet(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "xlsx" | "xls" | "csv"
            )
        })
}

fn validated_html_path(path: &str) -> Result<PathBuf, String> {
    let target = PathBuf::from(path);
    if target
        .extension()
        .and_then(|value| value.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("html"))
    {
        return Err("report_path_invalid".to_owned());
    }
    if target.file_name().is_none() || target.parent().is_none_or(|parent| !parent.is_dir()) {
        return Err("report_directory_missing".to_owned());
    }
    Ok(target)
}

fn ensure_panel_window(window: &WebviewWindow) -> Result<(), String> {
    (window.label() == PANEL_WINDOW)
        .then_some(())
        .ok_or_else(|| "ai_command_forbidden".to_owned())
}

fn credential_configured(window: &WebviewWindow) -> bool {
    load_api_key(window).is_ok()
}

fn ai_service_path(window: &WebviewWindow) -> Result<PathBuf, String> {
    window
        .app_handle()
        .path()
        .app_data_dir()
        .map(|directory| directory.join(AI_SERVICE_FILE))
        .map_err(|_| "ai_local_storage_unavailable".to_owned())
}

fn load_api_key(window: &WebviewWindow) -> Result<zeroize::Zeroizing<String>, String> {
    let path = ai_service_path(window)?;
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Err("ai_api_key_missing".to_owned())
        }
        Err(_) => return Err("ai_local_storage_read_failed".to_owned()),
    };
    let data: AiServiceData =
        serde_json::from_str(&content).map_err(|_| "ai_local_storage_read_failed".to_owned())?;
    config::stored_api_key(Some(&data.deepseek_api_key))
}

fn save_api_key(window: &WebviewWindow, api_key: String) -> Result<(), String> {
    let api_key = config::normalize_api_key(api_key)?;
    let path = ai_service_path(window)?;
    let directory = path
        .parent()
        .ok_or_else(|| "ai_local_storage_write_failed".to_owned())?;
    std::fs::create_dir_all(directory).map_err(|_| "ai_local_storage_write_failed".to_owned())?;
    let content = serde_json::to_vec(&AiServiceData {
        deepseek_api_key: api_key.to_string(),
    })
    .map_err(|_| "ai_local_storage_write_failed".to_owned())?;
    std::fs::write(&path, content).map_err(|_| "ai_local_storage_write_failed".to_owned())?;
    restrict_api_key_file_permissions(&path)
}

fn delete_api_key(window: &WebviewWindow) -> Result<(), String> {
    match std::fs::remove_file(ai_service_path(window)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(_) => Err("ai_local_storage_write_failed".to_owned()),
    }
}

#[cfg(unix)]
fn restrict_api_key_file_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|_| "ai_local_storage_write_failed".to_owned())
}

#[cfg(not(unix))]
fn restrict_api_key_file_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn ai_status(window: WebviewWindow) -> Result<AiStatus, String> {
    ensure_panel_window(&window)?;
    Ok(AiStatus {
        provider: "deepseek",
        has_api_key: credential_configured(&window),
        models: DEEPSEEK_MODELS,
    })
}

#[tauri::command]
pub async fn ai_save_api_key(window: WebviewWindow, api_key: String) -> Result<(), String> {
    ensure_panel_window(&window)?;
    save_api_key(&window, api_key)
}

#[tauri::command]
pub async fn ai_delete_api_key(window: WebviewWindow) -> Result<(), String> {
    ensure_panel_window(&window)?;
    delete_api_key(&window)
}

#[tauri::command]
pub async fn ai_test_connection(window: WebviewWindow, model: String) -> Result<(), String> {
    ensure_panel_window(&window)?;
    let api_key = load_api_key(&window)?;
    client::test_connection(&api_key, &model).await
}

#[tauri::command]
pub async fn ai_generate_chart_plan(
    window: WebviewWindow,
    model: String,
    profile: Value,
    validation_reason: Option<String>,
) -> Result<Value, String> {
    ensure_panel_window(&window)?;
    let api_key = load_api_key(&window)?;
    client::generate_chart_plan(&api_key, &model, &profile, validation_reason.as_deref()).await
}

#[tauri::command]
pub async fn read_spreadsheet_file(
    window: WebviewWindow,
    path: String,
) -> Result<SpreadsheetFilePayload, String> {
    ensure_panel_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let source = PathBuf::from(path);
        if !is_supported_spreadsheet(&source) {
            return Err("unsupported_spreadsheet_type".to_owned());
        }
        let metadata =
            std::fs::metadata(&source).map_err(|_| "spreadsheet_file_missing".to_owned())?;
        if !metadata.is_file() || metadata.len() == 0 {
            return Err("spreadsheet_empty_file".to_owned());
        }
        if metadata.len() > MAX_SPREADSHEET_BYTES {
            return Err("spreadsheet_too_large".to_owned());
        }
        let bytes = std::fs::read(&source).map_err(|_| "spreadsheet_read_failed".to_owned())?;
        Ok(SpreadsheetFilePayload {
            file_name: source
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("spreadsheet")
                .to_owned(),
            size_bytes: metadata.len(),
            base64: STANDARD.encode(bytes),
        })
    })
    .await
    .map_err(|_| "spreadsheet_read_failed".to_owned())?
}

#[tauri::command]
pub async fn write_report_html(
    window: WebviewWindow,
    path: String,
    html: String,
) -> Result<String, String> {
    ensure_panel_window(&window)?;
    if html.len() > MAX_REPORT_BYTES || !html.starts_with("<!doctype html>") {
        return Err("report_content_invalid".to_owned());
    }
    let target = validated_html_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::write(&target, html)
            .map(|_| target.to_string_lossy().into_owned())
            .map_err(|_| "report_write_failed".to_owned())
    })
    .await
    .map_err(|_| "report_write_failed".to_owned())?
}

#[tauri::command]
pub fn open_report_html(window: WebviewWindow, path: String, reveal: bool) -> Result<(), String> {
    ensure_panel_window(&window)?;
    let target = validated_html_path(&path)?;
    let canonical = std::fs::canonicalize(target).map_err(|_| "report_file_missing".to_owned())?;
    let open_target = if reveal {
        canonical
            .parent()
            .ok_or_else(|| "report_directory_missing".to_owned())?
            .to_path_buf()
    } else {
        canonical
    };
    tauri_plugin_opener::open_path(open_target, None::<&str>)
        .map_err(|_| "report_open_failed".to_owned())
}

#[cfg(test)]
mod tests {
    use super::{is_supported_spreadsheet, validated_html_path};
    use std::path::Path;

    #[test]
    fn spreadsheet_extensions_are_restricted() {
        assert!(is_supported_spreadsheet(Path::new("sales.xlsx")));
        assert!(is_supported_spreadsheet(Path::new("sales.CSV")));
        assert!(!is_supported_spreadsheet(Path::new("sales.html")));
    }

    #[test]
    fn report_path_must_be_html_in_existing_directory() {
        let temp_dir = std::env::temp_dir();
        let html_path = temp_dir.join("report.html");
        let script_path = temp_dir.join("report.js");

        assert!(validated_html_path(&html_path.to_string_lossy()).is_ok());
        assert!(validated_html_path(&script_path.to_string_lossy()).is_err());
    }
}
