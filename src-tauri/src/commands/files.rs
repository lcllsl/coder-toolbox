use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathStatus {
    exists: bool,
    is_directory: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemDirectories {
    desktop: Option<String>,
    documents: Option<String>,
    downloads: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryCreationResult {
    path: String,
    existed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemporaryTransferCopy {
    stored_path: String,
    kind: &'static str,
    size_bytes: u64,
}

fn path_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

fn validated_folder_name(name: &str) -> Result<&str, String> {
    let mut components = Path::new(name).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) if name != "." && name != ".." => Ok(name),
        _ => Err("invalid_folder_name".to_owned()),
    }
}

fn validated_transfer_id(id: &str) -> Result<&str, String> {
    let mut components = Path::new(id).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None)
            if !id.is_empty()
                && id
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || character == '-') =>
        {
            Ok(id)
        }
        _ => Err("invalid_transfer_id".to_owned()),
    }
}

fn transfer_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("temporary-transfer"))
        .map_err(|_| "app_data_directory_unavailable".to_owned())
}

fn copy_directory(source: &Path, target: &Path) -> Result<u64, String> {
    std::fs::create_dir(target).map_err(|_| "transfer_copy_failed".to_owned())?;
    let mut total = 0_u64;
    for entry in std::fs::read_dir(source).map_err(|_| "transfer_source_unreadable".to_owned())? {
        let entry = entry.map_err(|_| "transfer_source_unreadable".to_owned())?;
        let file_type = entry
            .file_type()
            .map_err(|_| "transfer_source_unreadable".to_owned())?;
        let destination = target.join(entry.file_name());
        if file_type.is_symlink() {
            return Err("transfer_symlink_unsupported".to_owned());
        }
        if file_type.is_dir() {
            total = total.saturating_add(copy_directory(&entry.path(), &destination)?);
        } else if file_type.is_file() {
            total = total.saturating_add(
                std::fs::copy(entry.path(), destination)
                    .map_err(|_| "transfer_copy_failed".to_owned())?,
            );
        }
    }
    Ok(total)
}

#[tauri::command]
pub fn system_directories(app: tauri::AppHandle) -> SystemDirectories {
    SystemDirectories {
        desktop: app.path().desktop_dir().ok().map(path_string),
        documents: app.path().document_dir().ok().map(path_string),
        downloads: app.path().download_dir().ok().map(path_string),
    }
}

#[tauri::command]
pub fn directory_status(path: String) -> PathStatus {
    let metadata = std::fs::metadata(path).ok();
    PathStatus {
        exists: metadata.is_some(),
        is_directory: metadata.is_some_and(|value| value.is_dir()),
    }
}

#[tauri::command]
pub fn open_directory(path: String) -> Result<(), String> {
    let canonical = std::fs::canonicalize(path).map_err(|_| "directory_missing".to_owned())?;
    if !canonical.is_dir() {
        return Err("path_is_not_directory".to_owned());
    }
    tauri_plugin_opener::open_path(canonical, None::<&str>)
        .map_err(|_| "directory_open_failed".to_owned())
}

#[tauri::command]
pub fn create_date_directory(
    parent_path: String,
    folder_name: String,
) -> Result<DirectoryCreationResult, String> {
    let name = validated_folder_name(&folder_name)?;
    let parent =
        std::fs::canonicalize(parent_path).map_err(|_| "parent_directory_missing".to_owned())?;
    if !parent.is_dir() {
        return Err("parent_path_is_not_directory".to_owned());
    }
    let target = parent.join(name);
    let existed = target.exists();
    if existed && !target.is_dir() {
        return Err("target_exists_as_file".to_owned());
    }
    if !existed {
        std::fs::create_dir(&target).map_err(|_| "directory_create_failed".to_owned())?;
    }
    tauri_plugin_opener::open_path(&target, None::<&str>)
        .map_err(|_| "directory_open_failed".to_owned())?;
    Ok(DirectoryCreationResult {
        path: path_string(target),
        existed,
    })
}

#[tauri::command]
pub async fn copy_to_temporary_transfer(
    app: tauri::AppHandle,
    source_path: String,
    id: String,
) -> Result<TemporaryTransferCopy, String> {
    validated_transfer_id(&id)?;
    let root = transfer_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let source =
            std::fs::canonicalize(source_path).map_err(|_| "transfer_source_missing".to_owned())?;
        let name = source
            .file_name()
            .ok_or_else(|| "transfer_source_invalid".to_owned())?;
        let item_root = root.join(id);
        if item_root.exists() {
            return Err("transfer_id_exists".to_owned());
        }
        std::fs::create_dir_all(&item_root).map_err(|_| "transfer_directory_failed".to_owned())?;
        let target = item_root.join(name);
        let result = if source.is_dir() {
            copy_directory(&source, &target).map(|size_bytes| TemporaryTransferCopy {
                stored_path: path_string(target),
                kind: "directory",
                size_bytes,
            })
        } else if source.is_file() {
            std::fs::copy(&source, &target)
                .map(|size_bytes| TemporaryTransferCopy {
                    stored_path: path_string(target),
                    kind: "file",
                    size_bytes,
                })
                .map_err(|_| "transfer_copy_failed".to_owned())
        } else {
            Err("transfer_source_unsupported".to_owned())
        };
        if result.is_err() {
            let _ = std::fs::remove_dir_all(item_root);
        }
        result
    })
    .await
    .map_err(|_| "transfer_task_failed".to_owned())?
}

#[tauri::command]
pub async fn delete_temporary_transfer_copy(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    validated_transfer_id(&id)?;
    let target = transfer_root(&app)?.join(id);
    tauri::async_runtime::spawn_blocking(move || {
        if !target.exists() {
            return Ok(());
        }
        std::fs::remove_dir_all(target).map_err(|_| "transfer_delete_failed".to_owned())
    })
    .await
    .map_err(|_| "transfer_task_failed".to_owned())?
}

#[tauri::command]
pub fn open_temporary_transfer_copy(app: tauri::AppHandle, id: String) -> Result<(), String> {
    validated_transfer_id(&id)?;
    let root = transfer_root(&app)?;
    let item_root = root.join(id);
    let target = std::fs::read_dir(&item_root)
        .map_err(|_| "transfer_copy_missing".to_owned())?
        .next()
        .ok_or_else(|| "transfer_copy_missing".to_owned())?
        .map_err(|_| "transfer_copy_missing".to_owned())?
        .path();
    let canonical_root =
        std::fs::canonicalize(root).map_err(|_| "transfer_copy_missing".to_owned())?;
    let canonical_target =
        std::fs::canonicalize(target).map_err(|_| "transfer_copy_missing".to_owned())?;
    if !canonical_target.starts_with(canonical_root) {
        return Err("transfer_path_invalid".to_owned());
    }
    tauri_plugin_opener::open_path(canonical_target, None::<&str>)
        .map_err(|_| "transfer_open_failed".to_owned())
}

#[cfg(test)]
mod tests {
    use super::{validated_folder_name, validated_transfer_id};

    #[test]
    fn folder_name_rejects_traversal_and_separators() {
        assert!(validated_folder_name("2026-07-21").is_ok());
        assert!(validated_folder_name("../escape").is_err());
        assert!(validated_folder_name("nested/folder").is_err());
    }

    #[test]
    fn transfer_id_accepts_uuid_and_rejects_paths() {
        assert!(validated_transfer_id("550e8400-e29b-41d4-a716-446655440000").is_ok());
        assert!(validated_transfer_id("../outside").is_err());
        assert!(validated_transfer_id("nested/item").is_err());
    }
}
