use std::path::Path;

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationStatus {
    exists: bool,
    launchable: bool,
}

fn is_launchable_application(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }

    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::PermissionsExt;
        let is_bundle = path.is_dir()
            && path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("app"));
        let is_executable = path.is_file()
            && path
                .metadata()
                .is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0);
        is_bundle || is_executable
    }

    #[cfg(target_os = "windows")]
    {
        path.is_file()
            && path.extension().is_some_and(|extension| {
                extension.eq_ignore_ascii_case("exe") || extension.eq_ignore_ascii_case("lnk")
            })
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        use std::os::unix::fs::PermissionsExt;
        path.is_file()
            && path
                .metadata()
                .is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
    }
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|_| "url_invalid".to_owned())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("url_protocol_forbidden".to_owned());
    }
    tauri_plugin_opener::open_url(parsed.as_str(), None::<&str>)
        .map_err(|_| "url_open_failed".to_owned())
}

#[tauri::command]
pub fn application_status(path: String) -> ApplicationStatus {
    let path = Path::new(&path);
    ApplicationStatus {
        exists: path.exists(),
        launchable: is_launchable_application(path),
    }
}

#[tauri::command]
pub fn open_application(path: String) -> Result<(), String> {
    let canonical = std::fs::canonicalize(path).map_err(|_| "application_missing".to_owned())?;
    if !is_launchable_application(&canonical) {
        return Err("application_not_launchable".to_owned());
    }
    tauri_plugin_opener::open_path(canonical, None::<&str>)
        .map_err(|_| "application_open_failed".to_owned())
}

#[cfg(test)]
mod tests {
    use super::open_external_url;

    #[test]
    fn external_url_rejects_non_http_protocols() {
        assert_eq!(
            open_external_url("file:///tmp/private".to_owned()),
            Err("url_protocol_forbidden".to_owned())
        );
        assert_eq!(
            open_external_url("not a url".to_owned()),
            Err("url_invalid".to_owned())
        );
    }
}
