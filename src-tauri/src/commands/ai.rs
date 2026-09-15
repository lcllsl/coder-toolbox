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
const MAX_SMART_TABLE_EXPORT_BYTES: usize = 24 * 1024 * 1024;
const PANEL_WINDOW: &str = "panel-window";
const AI_SERVICE_FILE: &str = "ai-service.json";

fn restricted_organizer_files(files: Value) -> Result<Value, String> {
    const ALLOWED: [&str; 7] = [
        "id",
        "name",
        "extension",
        "parentFolder",
        "createdAt",
        "modifiedAt",
        "size",
    ];
    let items = files
        .as_array()
        .ok_or_else(|| "file_classification_input_invalid".to_owned())?;
    if items.is_empty() || items.len() > 80 {
        return Err("file_classification_input_invalid".to_owned());
    }
    let mut restricted = Vec::with_capacity(items.len());
    for item in items {
        let object = item
            .as_object()
            .ok_or_else(|| "file_classification_input_invalid".to_owned())?;
        if object.get("id").and_then(Value::as_str).is_none()
            || object.get("name").and_then(Value::as_str).is_none()
            || object.get("extension").and_then(Value::as_str).is_none()
        {
            return Err("file_classification_input_invalid".to_owned());
        }
        let mut clean = serde_json::Map::new();
        for key in ALLOWED {
            if let Some(value) = object.get(key) {
                clean.insert(key.to_owned(), value.clone());
            }
        }
        restricted.push(Value::Object(clean));
    }
    Ok(Value::Array(restricted))
}

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

fn validated_smart_table_path(path: &str, format: &str) -> Result<PathBuf, String> {
    if !matches!(format, "xlsx" | "csv") {
        return Err("smart_table_export_format_invalid".to_owned());
    }
    let target = PathBuf::from(path);
    if target
        .extension()
        .and_then(|value| value.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case(format))
    {
        return Err("smart_table_export_path_invalid".to_owned());
    }
    if target.file_name().is_none() || target.parent().is_none_or(|parent| !parent.is_dir()) {
        return Err("smart_table_export_directory_missing".to_owned());
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
pub async fn ai_detect_table_schema(
    window: WebviewWindow,
    model: String,
    source_sample: String,
    target_description: String,
    template_name: String,
    validation_reason: Option<String>,
) -> Result<Value, String> {
    ensure_panel_window(&window)?;
    let api_key = load_api_key(&window)?;
    client::detect_table_schema(
        &api_key,
        &model,
        &source_sample,
        &target_description,
        &template_name,
        validation_reason.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn ai_extract_table_rows(
    window: WebviewWindow,
    model: String,
    schema: Value,
    source_blocks: Value,
    validation_reason: Option<String>,
) -> Result<Value, String> {
    ensure_panel_window(&window)?;
    let api_key = load_api_key(&window)?;
    client::extract_table_rows(
        &api_key,
        &model,
        &schema,
        &source_blocks,
        validation_reason.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn ai_classify_organizer_files(
    window: WebviewWindow,
    model: String,
    enabled_dimensions: Value,
    allowed_values: Value,
    files: Value,
    validation_reason: Option<String>,
) -> Result<Value, String> {
    ensure_panel_window(&window)?;
    let api_key = load_api_key(&window)?;
    let files = restricted_organizer_files(files)?;
    client::classify_organizer_files(
        &api_key,
        &model,
        &enabled_dimensions,
        &allowed_values,
        &files,
        validation_reason.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn write_smart_table_export(
    window: WebviewWindow,
    path: String,
    format: String,
    base64: String,
) -> Result<String, String> {
    ensure_panel_window(&window)?;
    let target = validated_smart_table_path(&path, &format)?;
    let bytes = STANDARD
        .decode(base64)
        .map_err(|_| "smart_table_export_content_invalid".to_owned())?;
    if bytes.is_empty() || bytes.len() > MAX_SMART_TABLE_EXPORT_BYTES {
        return Err("smart_table_export_content_invalid".to_owned());
    }
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::write(&target, bytes)
            .map(|_| target.to_string_lossy().into_owned())
            .map_err(|_| "smart_table_export_write_failed".to_owned())
    })
    .await
    .map_err(|_| "smart_table_export_write_failed".to_owned())?
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
    use super::{
        is_supported_spreadsheet, restricted_organizer_files, validated_html_path,
        validated_smart_table_path,
    };
    use serde_json::json;
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

    #[test]
    fn smart_table_export_path_matches_requested_format() {
        let temp_dir = std::env::temp_dir();
        assert!(validated_smart_table_path(
            &temp_dir.join("result.xlsx").to_string_lossy(),
            "xlsx"
        )
        .is_ok());
        assert!(
            validated_smart_table_path(&temp_dir.join("result.csv").to_string_lossy(), "xlsx")
                .is_err()
        );
        assert!(
            validated_smart_table_path(&temp_dir.join("result.exe").to_string_lossy(), "exe")
                .is_err()
        );
    }

    #[test]
    fn organizer_ai_payload_drops_absolute_paths_and_unknown_fields() {
        let value = restricted_organizer_files(json!([{
            "id": "file-1", "name": "预算.xlsx", "extension": ".xlsx", "parentFolder": "资料",
            "absolutePath": "C:\\Users\\secret\\预算.xlsx", "content": "never send"
        }]))
        .unwrap();
        assert!(value[0].get("absolutePath").is_none());
        assert!(value[0].get("content").is_none());
        assert_eq!(value[0]["parentFolder"], "资料");
    }
}
