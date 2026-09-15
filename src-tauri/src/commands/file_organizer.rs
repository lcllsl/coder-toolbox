use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, State, WebviewWindow};

const MAX_FILES: usize = 5_000;
const PANEL_WINDOW: &str = "panel-window";

#[derive(Default)]
pub struct FileOrganizerState {
    cancelled_tasks: Mutex<HashSet<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOptions {
    recursive: bool,
    file_types: Vec<String>,
    excluded_name_keywords: Vec<String>,
    excluded_directories: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerFileMeta {
    id: String,
    name: String,
    extension: String,
    absolute_path: String,
    parent_folder_name: String,
    relative_parent: String,
    created_at: Option<u64>,
    modified_at: Option<u64>,
    size: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutePlan {
    file_id: String,
    source_path: String,
    target_segments: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMoveRecord {
    file_id: String,
    from: String,
    to: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOrganizeManifest {
    task_id: String,
    created_at: String,
    root_directory: String,
    moves: Vec<FileMoveRecord>,
    created_directories: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOrganizeFailure {
    file_id: String,
    file_name: String,
    code: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOrganizeProgress {
    completed: usize,
    total: usize,
    current_file: String,
    moved: usize,
    skipped: usize,
    failed: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOrganizeResult {
    manifest: FileOrganizeManifest,
    moved: usize,
    skipped: usize,
    failed: Vec<FileOrganizeFailure>,
    cancelled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoResult {
    restored: usize,
    conflicts: Vec<FileOrganizeFailure>,
    failed: Vec<FileOrganizeFailure>,
}

fn ensure_panel(window: &WebviewWindow) -> Result<(), String> {
    (window.label() == PANEL_WINDOW)
        .then_some(())
        .ok_or_else(|| "organizer_command_forbidden".to_owned())
}

fn millis(value: Result<SystemTime, std::io::Error>) -> Option<u64> {
    value
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|value| value.as_millis() as u64)
}

fn file_group(extension: &str) -> &'static str {
    match extension {
        ".doc" | ".docx" => "word",
        ".xls" | ".xlsx" | ".csv" => "excel",
        ".ppt" | ".pptx" => "powerpoint",
        ".pdf" => "pdf",
        ".txt" | ".md" => "text",
        _ => "other",
    }
}

#[cfg(windows)]
fn is_hidden_or_system(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & (0x2 | 0x4) != 0
}

#[cfg(not(windows))]
fn is_hidden_or_system(_metadata: &fs::Metadata) -> bool {
    false
}

fn should_exclude_file(
    name: &str,
    extension: &str,
    metadata: &fs::Metadata,
    options: &ScanOptions,
) -> bool {
    let lowered = name.to_lowercase();
    name.starts_with('.')
        || name.starts_with("~$")
        || matches!(extension, ".tmp" | ".temp")
        || is_hidden_or_system(metadata)
        || options
            .excluded_name_keywords
            .iter()
            .any(|value| !value.is_empty() && lowered.contains(&value.to_lowercase()))
}

fn scan_level(
    root: &Path,
    directory: &Path,
    options: &ScanOptions,
    output: &mut Vec<OrganizerFileMeta>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|_| "organizer_root_unreadable".to_owned())? {
        let entry = entry.map_err(|_| "organizer_root_unreadable".to_owned())?;
        let file_type = entry
            .file_type()
            .map_err(|_| "organizer_root_unreadable".to_owned())?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if file_type.is_dir() {
            let hidden_or_system = entry
                .metadata()
                .map(|value| is_hidden_or_system(&value))
                .unwrap_or(true);
            if options.recursive
                && !name.starts_with('.')
                && !hidden_or_system
                && !options
                    .excluded_directories
                    .iter()
                    .any(|value| value.eq_ignore_ascii_case(&name))
            {
                scan_level(root, &path, options, output)?;
            }
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| format!(".{}", value.to_lowercase()))
            .unwrap_or_default();
        let metadata = entry
            .metadata()
            .map_err(|_| "organizer_file_metadata_failed".to_owned())?;
        if !options
            .file_types
            .iter()
            .any(|value| value == file_group(&extension))
            || should_exclude_file(&name, &extension, &metadata, options)
        {
            continue;
        }
        if output.len() >= MAX_FILES {
            return Err("organizer_too_many_files".to_owned());
        }
        let parent = path.parent().unwrap_or(root);
        let relative_parent = parent.strip_prefix(root).unwrap_or(Path::new(""));
        output.push(OrganizerFileMeta {
            id: format!("file-{:05}", output.len() + 1),
            name,
            extension,
            absolute_path: path.to_string_lossy().into_owned(),
            parent_folder_name: parent
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_default(),
            relative_parent: relative_parent.to_string_lossy().into_owned(),
            created_at: millis(metadata.created()),
            modified_at: millis(metadata.modified()),
            size: metadata.len(),
        });
    }
    Ok(())
}

fn validated_root(path: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(path).map_err(|_| "organizer_root_invalid".to_owned())?;
    if !root.is_dir() {
        return Err("organizer_root_invalid".to_owned());
    }
    Ok(root)
}

fn validate_segment(value: &str) -> Result<(), String> {
    let invalid = value.is_empty()
        || value.len() > 240
        || value == "."
        || value == ".."
        || value.chars().any(|character| {
            matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
        })
        || value.ends_with(['.', ' ']);
    let stem = value
        .split('.')
        .next()
        .unwrap_or(value)
        .to_ascii_lowercase();
    let reserved = matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || (stem.len() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && stem[3..]
                .parse::<u8>()
                .is_ok_and(|number| (1..=9).contains(&number)));
    if invalid || reserved {
        Err("organizer_path_invalid".to_owned())
    } else {
        Ok(())
    }
}

fn numbered_target(target: &Path) -> PathBuf {
    let parent = target.parent().unwrap_or(Path::new(""));
    let stem = target
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let extension = target.extension().and_then(|value| value.to_str());
    for number in 2..=10_000 {
        let name = extension
            .map(|ext| format!("{stem} ({number}).{ext}"))
            .unwrap_or_else(|| format!("{stem} ({number})"));
        let candidate = parent.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    target.to_path_buf()
}

fn planned_target(root: &Path, plan: &ExecutePlan) -> Result<PathBuf, String> {
    if plan.target_segments.is_empty() || plan.target_segments.len() > 3 {
        return Err("organizer_path_invalid".to_owned());
    }
    let source =
        fs::canonicalize(&plan.source_path).map_err(|_| "organizer_source_missing".to_owned())?;
    if !source.starts_with(root) || !source.is_file() {
        return Err("organizer_path_invalid".to_owned());
    }
    let mut directory = root.to_path_buf();
    for segment in &plan.target_segments {
        validate_segment(segment)?;
        directory.push(segment);
        if directory.exists() {
            directory =
                fs::canonicalize(&directory).map_err(|_| "organizer_target_invalid".to_owned())?;
            if !directory.starts_with(root) || !directory.is_dir() {
                return Err("organizer_path_invalid".to_owned());
            }
        }
    }
    Ok(directory.join(
        source
            .file_name()
            .ok_or_else(|| "organizer_source_invalid".to_owned())?,
    ))
}

#[tauri::command]
pub async fn scan_organizer_directory(
    window: WebviewWindow,
    root_directory: String,
    options: ScanOptions,
) -> Result<Vec<OrganizerFileMeta>, String> {
    ensure_panel(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = validated_root(&root_directory)?;
        let mut output = Vec::new();
        scan_level(&root, &root, &options, &mut output)?;
        Ok(output)
    })
    .await
    .map_err(|_| "organizer_scan_failed".to_owned())?
}

#[tauri::command]
pub fn cancel_file_organize(
    window: WebviewWindow,
    state: State<'_, FileOrganizerState>,
    task_id: String,
) -> Result<(), String> {
    ensure_panel(&window)?;
    state
        .cancelled_tasks
        .lock()
        .map_err(|_| "organizer_state_failed".to_owned())?
        .insert(task_id);
    Ok(())
}

#[tauri::command]
pub async fn validate_organizer_plan(
    window: WebviewWindow,
    root_directory: String,
    plans: Vec<ExecutePlan>,
) -> Result<Vec<String>, String> {
    ensure_panel(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = validated_root(&root_directory)?;
        let mut targets = HashSet::new();
        let mut conflicts = Vec::new();
        for plan in plans {
            let target = planned_target(&root, &plan)?;
            let key = target.to_string_lossy().to_lowercase();
            if target.exists() || !targets.insert(key) {
                conflicts.push(plan.file_id);
            }
        }
        Ok(conflicts)
    })
    .await
    .map_err(|_| "organizer_validation_failed".to_owned())?
}

#[tauri::command]
pub async fn execute_file_organize(
    window: WebviewWindow,
    state: State<'_, FileOrganizerState>,
    root_directory: String,
    task_id: String,
    plans: Vec<ExecutePlan>,
    conflict_strategy: String,
    progress: Channel<FileOrganizeProgress>,
) -> Result<FileOrganizeResult, String> {
    ensure_panel(&window)?;
    let root = validated_root(&root_directory)?;
    let total = plans.len();
    let mut moves = Vec::new();
    let mut created_directories = Vec::new();
    let mut failures = Vec::new();
    let mut skipped = 0usize;
    let mut cancelled = false;
    for (index, plan) in plans.into_iter().enumerate() {
        if state
            .cancelled_tasks
            .lock()
            .map_err(|_| "organizer_state_failed".to_owned())?
            .contains(&task_id)
        {
            cancelled = true;
            break;
        }
        let file_name = Path::new(&plan.source_path)
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_default();
        let outcome = (|| -> Result<Option<FileMoveRecord>, String> {
            if plan.target_segments.is_empty() || plan.target_segments.len() > 3 {
                return Err("organizer_path_invalid".to_owned());
            }
            for segment in &plan.target_segments {
                validate_segment(segment)?;
            }
            let source = fs::canonicalize(&plan.source_path)
                .map_err(|_| "organizer_source_missing".to_owned())?;
            if !source.starts_with(&root) || !source.is_file() {
                return Err("organizer_path_invalid".to_owned());
            }
            let mut directory = root.clone();
            for segment in &plan.target_segments {
                directory.push(segment);
                if !directory.exists() {
                    fs::create_dir(&directory)
                        .map_err(|_| "organizer_permission_denied".to_owned())?;
                    created_directories.push(directory.to_string_lossy().into_owned());
                } else if !directory.is_dir() {
                    return Err("organizer_target_invalid".to_owned());
                }
                directory = fs::canonicalize(&directory)
                    .map_err(|_| "organizer_target_invalid".to_owned())?;
                if !directory.starts_with(&root) {
                    return Err("organizer_path_invalid".to_owned());
                }
            }
            let source_name = source
                .file_name()
                .ok_or_else(|| "organizer_source_invalid".to_owned())?;
            let mut target = directory.join(source_name);
            if target == source {
                skipped += 1;
                return Ok(None);
            }
            if target.exists() {
                match conflict_strategy.as_str() {
                    "rename" => target = numbered_target(&target),
                    "skip" | "confirm" => {
                        skipped += 1;
                        return Ok(None);
                    }
                    _ => return Err("organizer_conflict_strategy_invalid".to_owned()),
                }
            }
            fs::rename(&source, &target).map_err(|_| "organizer_move_failed".to_owned())?;
            Ok(Some(FileMoveRecord {
                file_id: plan.file_id.clone(),
                from: source.to_string_lossy().into_owned(),
                to: target.to_string_lossy().into_owned(),
            }))
        })();
        match outcome {
            Ok(Some(record)) => moves.push(record),
            Ok(None) => {}
            Err(code) => failures.push(FileOrganizeFailure {
                file_id: plan.file_id,
                file_name: file_name.clone(),
                code,
            }),
        }
        let _ = progress.send(FileOrganizeProgress {
            completed: index + 1,
            total,
            current_file: file_name,
            moved: moves.len(),
            skipped,
            failed: failures.len(),
        });
    }
    if let Ok(mut tasks) = state.cancelled_tasks.lock() {
        tasks.remove(&task_id);
    }
    Ok(FileOrganizeResult {
        moved: moves.len(),
        skipped,
        failed: failures,
        cancelled,
        manifest: FileOrganizeManifest {
            task_id,
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
                .to_string(),
            root_directory: root.to_string_lossy().into_owned(),
            moves,
            created_directories,
        },
    })
}

#[tauri::command]
pub async fn undo_file_organize(
    window: WebviewWindow,
    manifest: FileOrganizeManifest,
) -> Result<UndoResult, String> {
    ensure_panel(&window)?;
    let root = validated_root(&manifest.root_directory)?;
    let mut restored = 0;
    let mut conflicts = Vec::new();
    let mut failed = Vec::new();
    for record in manifest.moves.iter().rev() {
        let file_name = Path::new(&record.to)
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_default();
        let source = match fs::canonicalize(&record.to) {
            Ok(value) if value.starts_with(&root) && value.is_file() => value,
            _ => {
                failed.push(FileOrganizeFailure {
                    file_id: record.file_id.clone(),
                    file_name,
                    code: "organizer_undo_source_missing".to_owned(),
                });
                continue;
            }
        };
        let target = PathBuf::from(&record.from);
        let parent = match target
            .parent()
            .and_then(|value| fs::canonicalize(value).ok())
        {
            Some(value) if value.starts_with(&root) => value,
            _ => {
                failed.push(FileOrganizeFailure {
                    file_id: record.file_id.clone(),
                    file_name,
                    code: "organizer_undo_path_invalid".to_owned(),
                });
                continue;
            }
        };
        let target = parent.join(target.file_name().unwrap_or_default());
        if target.exists() {
            conflicts.push(FileOrganizeFailure {
                file_id: record.file_id.clone(),
                file_name,
                code: "organizer_undo_conflict".to_owned(),
            });
            continue;
        }
        if fs::rename(source, target).is_ok() {
            restored += 1;
        } else {
            failed.push(FileOrganizeFailure {
                file_id: record.file_id.clone(),
                file_name,
                code: "organizer_undo_failed".to_owned(),
            });
        }
    }
    Ok(UndoResult {
        restored,
        conflicts,
        failed,
    })
}

#[cfg(test)]
mod tests {
    use super::{file_group, numbered_target, validate_segment};
    use std::fs;

    #[test]
    fn file_groups_are_local_and_predictable() {
        assert_eq!(file_group(".docx"), "word");
        assert_eq!(file_group(".csv"), "excel");
        assert_eq!(file_group(".zip"), "other");
    }

    #[test]
    fn segments_reject_traversal_reserved_and_windows_characters() {
        assert!(validate_segment("财务部").is_ok());
        assert!(validate_segment("..").is_err());
        assert!(validate_segment("CON").is_err());
        assert!(validate_segment("项目/资料").is_err());
    }

    #[test]
    fn conflict_numbering_never_overwrites() {
        let root = std::env::temp_dir().join(format!("maopao-organizer-{}", std::process::id()));
        let _ = fs::create_dir_all(&root);
        let first = root.join("文件.docx");
        fs::write(&first, b"one").unwrap();
        assert_eq!(
            numbered_target(&first).file_name().unwrap(),
            "文件 (2).docx"
        );
        let _ = fs::remove_file(first);
        let _ = fs::remove_dir(root);
    }
}
