use std::sync::Arc;

use tauri::{State, WebviewWindow};
use zeroize::Zeroizing;

use crate::vault::clipboard::{current_sequence_number, SensitiveClipboardState};

const CLIPBOARD_LISTENER_WINDOW: &str = "orb-window";

#[tauri::command]
pub fn clipboard_sequence_number() -> u64 {
    current_sequence_number()
}

/// Lets the orb listener check a process-local marker for a vault copy.
///
/// Plaintext is used only to calculate the digest and is zeroized when this
/// command returns. The state itself never retains clipboard text.
#[tauri::command]
pub async fn clipboard_should_ignore_sensitive(
    window: WebviewWindow,
    state: State<'_, Arc<SensitiveClipboardState>>,
    text: String,
    sequence: u64,
) -> Result<bool, String> {
    let text = Zeroizing::new(text);
    if window.label() != CLIPBOARD_LISTENER_WINDOW {
        return Err("sensitive_clipboard_marker_forbidden".to_owned());
    }
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.should_ignore(text.as_str(), sequence))
        .await
        .map_err(|_| "sensitive_clipboard_marker_task_failed".to_owned())
}
