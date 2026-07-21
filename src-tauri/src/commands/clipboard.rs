#[cfg(target_os = "macos")]
fn system_clipboard_sequence() -> u64 {
    use objc2::{msg_send, rc::Retained, ClassType};
    use objc2_app_kit::NSPasteboard;

    let pasteboard: Option<Retained<NSPasteboard>> =
        unsafe { msg_send![NSPasteboard::class(), generalPasteboard] };
    pasteboard
        .map(|pasteboard| pasteboard.changeCount().max(0) as u64)
        .unwrap_or(0)
}

#[cfg(target_os = "windows")]
fn system_clipboard_sequence() -> u64 {
    unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() as u64 }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn system_clipboard_sequence() -> u64 {
    0
}

#[tauri::command]
pub fn clipboard_sequence_number() -> u64 {
    system_clipboard_sequence()
}
