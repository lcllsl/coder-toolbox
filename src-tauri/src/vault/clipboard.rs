use std::{
    collections::VecDeque,
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, WebviewWindow};
#[cfg(not(target_os = "windows"))]
use tauri_plugin_clipboard_manager::ClipboardExt;
use zeroize::Zeroizing;

use super::state::VaultState;

const PANEL_WINDOW: &str = "panel-window";
const PASSWORD_CLEAR_DELAY: Duration = Duration::from_secs(15);
const USERNAME_CLEAR_DELAY: Duration = Duration::from_secs(30);
const CLEAR_RETRY_ATTEMPTS: usize = 3;
const CLEAR_RETRY_DELAY: Duration = Duration::from_millis(150);

type ClipboardDigest = [u8; 32];

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SensitiveClipboardField {
    Username,
    Password,
}

impl SensitiveClipboardField {
    fn clear_delay(self) -> Duration {
        match self {
            Self::Username => USERNAME_CLEAR_DELAY,
            Self::Password => PASSWORD_CLEAR_DELAY,
        }
    }
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub enum ClipboardHistoryProtection {
    Applied,
    Failed,
    Unsupported,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SensitiveClipboardCopyResult {
    pub clear_after_seconds: u64,
    pub history_protection: ClipboardHistoryProtection,
}

#[derive(Clone)]
struct SensitiveWriteMarker {
    sequence: u64,
    digest: ClipboardDigest,
}

#[derive(Default)]
struct SensitiveClipboardInner {
    generation: u64,
    latest_generation: Option<u64>,
    recent_writes: VecDeque<SensitiveWriteMarker>,
}

/// Process-local coordination for sensitive clipboard writes.
///
/// The state contains only sequence numbers and SHA-256 digests. Clipboard
/// plaintext is never retained here. `write_gate` closes the small race between
/// changing the OS clipboard and publishing the matching ignore marker to the
/// clipboard listener running in the other WebView.
#[derive(Default)]
pub struct SensitiveClipboardState {
    write_gate: Mutex<()>,
    inner: Mutex<SensitiveClipboardInner>,
}

impl SensitiveClipboardState {
    fn write_guard(&self) -> MutexGuard<'_, ()> {
        self.write_gate
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn inner(&self) -> MutexGuard<'_, SensitiveClipboardInner> {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn register_write(&self, sequence: u64, digest: ClipboardDigest) -> u64 {
        let mut inner = self.inner();
        inner.generation = inner.generation.wrapping_add(1).max(1);
        let generation = inner.generation;
        inner.latest_generation = Some(generation);
        inner
            .recent_writes
            .push_back(SensitiveWriteMarker { sequence, digest });
        generation
    }

    /// Matches an ignore marker produced by a sensitive write.
    ///
    /// Both the OS sequence number and the content digest must match. This lets
    /// the orb-window listener skip vault copies without sharing plaintext
    /// module state with panel-window.
    pub fn should_ignore(&self, text: &str, observed_sequence: u64) -> bool {
        let _write_guard = self.write_guard();
        let digest = clipboard_digest(text);
        let inner = self.inner();
        inner
            .recent_writes
            .iter()
            .any(|marker| marker.sequence == observed_sequence && marker.digest == digest)
    }

    fn is_latest_generation(&self, generation: u64) -> bool {
        self.inner().latest_generation == Some(generation)
    }

    fn finish_generation(&self, generation: u64) {
        let mut inner = self.inner();
        if inner.latest_generation == Some(generation) {
            inner.latest_generation = None;
        }
        // Do not expire or capacity-evict a sensitive marker. An orb poll can
        // be suspended after reading plaintext and resume arbitrarily later.
        // Markers contain only a sequence number and SHA-256 digest. They stay
        // process-local for the process lifetime so a listener crash/retry
        // cannot turn a previously protected copy into ordinary history.
    }
}

fn clipboard_digest(text: &str) -> ClipboardDigest {
    Sha256::digest(text.as_bytes()).into()
}

#[cfg(test)]
fn should_clear_snapshot(
    expected_generation: u64,
    latest_generation: Option<u64>,
    expected_sequence: u64,
    observed_sequence: u64,
    expected_digest: &ClipboardDigest,
    observed_digest: &ClipboardDigest,
) -> bool {
    latest_generation == Some(expected_generation)
        && clipboard_snapshot_matches(
            expected_sequence,
            observed_sequence,
            expected_digest,
            observed_digest,
        )
}

#[cfg(any(target_os = "windows", test))]
fn clipboard_snapshot_matches(
    expected_sequence: u64,
    observed_sequence: u64,
    expected_digest: &ClipboardDigest,
    observed_digest: &ClipboardDigest,
) -> bool {
    observed_sequence == expected_sequence && observed_digest == expected_digest
}

/// Returns the platform clipboard change counter used by the existing polling
/// listener and the sensitive-write ignore marker.
pub fn current_sequence_number() -> u64 {
    platform_sequence_number()
}

/// Writes one vault field and schedules a guarded clear without returning the
/// plaintext to the frontend.
pub async fn secure_copy(
    app: AppHandle,
    window: WebviewWindow,
    vault_state: Arc<VaultState>,
    vault_generation: u64,
    text: String,
    field: SensitiveClipboardField,
) -> Result<SensitiveClipboardCopyResult, String> {
    let sensitive_text = Zeroizing::new(text);
    if window.label() != PANEL_WINDOW {
        return Err("sensitive_clipboard_forbidden".to_owned());
    }
    if sensitive_text.is_empty() {
        return Err("sensitive_clipboard_empty".to_owned());
    }
    if sensitive_text.contains('\0') {
        // CF_UNICODETEXT is NUL terminated. Rejecting embedded NULs keeps the
        // digest/sequence marker aligned with what consumers can actually read.
        return Err("sensitive_clipboard_invalid_text".to_owned());
    }

    let clipboard_state = app
        .try_state::<Arc<SensitiveClipboardState>>()
        .ok_or_else(|| "sensitive_clipboard_state_missing".to_owned())?
        .inner()
        .clone();
    let digest = clipboard_digest(sensitive_text.as_str());
    let write_app = app.clone();
    let write_window = window.clone();
    let write_state = clipboard_state.clone();
    let (generation, sequence, history_protection) =
        tauri::async_runtime::spawn_blocking(move || {
            let _write_guard = write_state.write_guard();
            let (history_protection, sequence) = vault_state
                .run_if_current_generation(vault_generation, || {
                    platform_write_sensitive(&write_app, &write_window, sensitive_text.as_str())
                })?;
            let generation = write_state.register_write(sequence, digest);
            Ok::<_, String>((generation, sequence, history_protection))
        })
        .await
        .map_err(|_| "sensitive_clipboard_task_failed".to_owned())??;

    let clear_delay = field.clear_delay();
    schedule_guarded_clear(
        app,
        window,
        clipboard_state,
        generation,
        sequence,
        digest,
        clear_delay,
    );

    Ok(SensitiveClipboardCopyResult {
        clear_after_seconds: clear_delay.as_secs(),
        history_protection,
    })
}

fn schedule_guarded_clear(
    app: AppHandle,
    window: WebviewWindow,
    state: Arc<SensitiveClipboardState>,
    generation: u64,
    sequence: u64,
    digest: ClipboardDigest,
    delay: Duration,
) {
    let _clear_task = tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        for attempt in 0..CLEAR_RETRY_ATTEMPTS {
            let clear_state = state.clone();
            let clear_app = app.clone();
            let clear_window = window.clone();
            let result = tauri::async_runtime::spawn_blocking(move || {
                let _write_guard = clear_state.write_guard();
                if !clear_state.is_latest_generation(generation) {
                    return Ok::<_, String>(false);
                }
                platform_clear_if_unchanged(&clear_app, &clear_window, sequence, &digest)
            })
            .await;

            match result {
                Ok(Ok(_)) => break,
                Ok(Err(_)) | Err(_) if attempt + 1 < CLEAR_RETRY_ATTEMPTS => {
                    tokio::time::sleep(CLEAR_RETRY_DELAY).await;
                }
                Ok(Err(_)) | Err(_) => break,
            }
        }
        state.finish_generation(generation);
    });
}

#[cfg(target_os = "macos")]
fn platform_sequence_number() -> u64 {
    use objc2_app_kit::NSPasteboard;

    NSPasteboard::generalPasteboard().changeCount().max(0) as u64
}

#[cfg(target_os = "windows")]
fn platform_sequence_number() -> u64 {
    unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() as u64 }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_sequence_number() -> u64 {
    0
}

#[cfg(not(target_os = "windows"))]
fn platform_write_sensitive(
    app: &AppHandle,
    _window: &WebviewWindow,
    text: &str,
) -> Result<(ClipboardHistoryProtection, u64), String> {
    app.clipboard()
        .write_text(text)
        .map_err(|_| "sensitive_clipboard_write_failed".to_owned())?;
    Ok((
        ClipboardHistoryProtection::Unsupported,
        platform_sequence_number(),
    ))
}

#[cfg(not(target_os = "windows"))]
fn platform_clear_if_unchanged(
    app: &AppHandle,
    _window: &WebviewWindow,
    expected_sequence: u64,
    expected_digest: &ClipboardDigest,
) -> Result<bool, String> {
    if platform_sequence_number() != expected_sequence {
        return Ok(false);
    }
    let current = Zeroizing::new(
        app.clipboard()
            .read_text()
            .map_err(|_| "sensitive_clipboard_read_failed".to_owned())?,
    );
    let observed_digest = clipboard_digest(current.as_str());
    if platform_sequence_number() != expected_sequence || observed_digest != *expected_digest {
        return Ok(false);
    }
    app.clipboard()
        .clear()
        .map_err(|_| "sensitive_clipboard_clear_failed".to_owned())?;
    Ok(true)
}

#[cfg(target_os = "windows")]
mod windows {
    use std::{ffi::c_void, mem, ptr, slice, thread, time::Duration};

    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use tauri::WebviewWindow;
    use windows_sys::Win32::{
        Foundation::{GlobalFree, HGLOBAL, HWND},
        System::{
            DataExchange::{
                CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber,
                OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
            },
            Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE},
        },
    };
    use zeroize::Zeroizing;

    use super::{
        clipboard_digest, clipboard_snapshot_matches, ClipboardDigest, ClipboardHistoryProtection,
    };

    const CF_UNICODETEXT_FORMAT: u32 = 13;
    const MAX_CLIPBOARD_TEXT_BYTES: usize = 16 * 1024 * 1024;
    const CLIPBOARD_OPEN_ATTEMPTS: usize = 8;
    const CLIPBOARD_RETRY_DELAY: Duration = Duration::from_millis(12);

    struct ClipboardGuard;

    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                CloseClipboard();
            }
        }
    }

    struct GlobalMemory(HGLOBAL);

    impl GlobalMemory {
        fn allocate_copy(bytes: &[u8]) -> Result<Self, String> {
            let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len()) };
            if handle.is_null() {
                return Err("sensitive_clipboard_allocate_failed".to_owned());
            }
            let target = unsafe { GlobalLock(handle) };
            if target.is_null() {
                unsafe {
                    GlobalFree(handle);
                }
                return Err("sensitive_clipboard_allocate_failed".to_owned());
            }
            unsafe {
                ptr::copy_nonoverlapping(bytes.as_ptr(), target.cast::<u8>(), bytes.len());
                GlobalUnlock(handle);
            }
            Ok(Self(handle))
        }

        fn transfer(mut self, format: u32) -> bool {
            let accepted = unsafe { SetClipboardData(format, self.0) };
            if accepted.is_null() {
                return false;
            }
            self.0 = ptr::null_mut();
            true
        }
    }

    impl Drop for GlobalMemory {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    let size = GlobalSize(self.0);
                    let data = GlobalLock(self.0);
                    if !data.is_null() {
                        ptr::write_bytes(data.cast::<u8>(), 0, size);
                        GlobalUnlock(self.0);
                    }
                    GlobalFree(self.0);
                }
            }
        }
    }

    fn owner_hwnd(window: &WebviewWindow) -> Result<HWND, String> {
        let handle = window
            .window_handle()
            .map_err(|_| "sensitive_clipboard_window_handle_failed".to_owned())?;
        match handle.as_raw() {
            RawWindowHandle::Win32(handle) => Ok(handle.hwnd.get() as isize as *mut c_void),
            _ => Err("sensitive_clipboard_window_handle_failed".to_owned()),
        }
    }

    fn open_clipboard(window: &WebviewWindow) -> Result<ClipboardGuard, String> {
        let owner = owner_hwnd(window)?;
        for attempt in 0..CLIPBOARD_OPEN_ATTEMPTS {
            if unsafe { OpenClipboard(owner) } != 0 {
                return Ok(ClipboardGuard);
            }
            if attempt + 1 < CLIPBOARD_OPEN_ATTEMPTS {
                thread::sleep(CLIPBOARD_RETRY_DELAY);
            }
        }
        Err("sensitive_clipboard_busy".to_owned())
    }

    fn wide_null(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn set_registered_value(name: &str, value: u32) -> bool {
        let name = wide_null(name);
        let format = unsafe { RegisterClipboardFormatW(name.as_ptr()) };
        if format == 0 {
            return false;
        }
        GlobalMemory::allocate_copy(&value.to_ne_bytes())
            .is_ok_and(|memory| memory.transfer(format))
    }

    fn unicode_text_bytes(text: &str) -> Zeroizing<Vec<u8>> {
        let wide = Zeroizing::new(
            text.encode_utf16()
                .chain(std::iter::once(0))
                .collect::<Vec<u16>>(),
        );
        let bytes = unsafe {
            slice::from_raw_parts(
                wide.as_ptr().cast::<u8>(),
                wide.len() * mem::size_of::<u16>(),
            )
        };
        Zeroizing::new(bytes.to_vec())
    }

    pub(super) fn write_sensitive(
        window: &WebviewWindow,
        text: &str,
    ) -> Result<(ClipboardHistoryProtection, u64), String> {
        let _clipboard = open_clipboard(window)?;
        if unsafe { EmptyClipboard() } == 0 {
            return Err("sensitive_clipboard_write_failed".to_owned());
        }

        let text_bytes = unicode_text_bytes(text);
        let text_written =
            GlobalMemory::allocate_copy(text_bytes.as_slice())?.transfer(CF_UNICODETEXT_FORMAT);
        if !text_written {
            return Err("sensitive_clipboard_write_failed".to_owned());
        }

        let exclude_monitor =
            set_registered_value("ExcludeClipboardContentFromMonitorProcessing", 1);
        let exclude_history = set_registered_value("CanIncludeInClipboardHistory", 0);
        let exclude_cloud = set_registered_value("CanUploadToCloudClipboard", 0);

        // The monitor-exclusion format blocks both processors by itself; the
        // two opt-out formats provide the equivalent explicit fallback.
        let history_protection = if exclude_monitor || (exclude_history && exclude_cloud) {
            ClipboardHistoryProtection::Applied
        } else {
            ClipboardHistoryProtection::Failed
        };
        let sequence = unsafe { GetClipboardSequenceNumber() as u64 };
        Ok((history_protection, sequence))
    }

    fn read_unicode_text_digest() -> Result<Option<ClipboardDigest>, String> {
        let handle = unsafe { GetClipboardData(CF_UNICODETEXT_FORMAT) };
        if handle.is_null() {
            return Ok(None);
        }
        let size = unsafe { GlobalSize(handle) };
        if size < mem::size_of::<u16>() || size > MAX_CLIPBOARD_TEXT_BYTES {
            return Ok(None);
        }
        let data = unsafe { GlobalLock(handle) };
        if data.is_null() {
            return Err("sensitive_clipboard_read_failed".to_owned());
        }
        let units =
            unsafe { slice::from_raw_parts(data.cast::<u16>(), size / mem::size_of::<u16>()) };
        let end = units
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(units.len());
        let text = Zeroizing::new(String::from_utf16_lossy(&units[..end]));
        unsafe {
            GlobalUnlock(handle);
        }
        Ok(Some(clipboard_digest(text.as_str())))
    }

    pub(super) fn clear_if_unchanged(
        window: &WebviewWindow,
        expected_sequence: u64,
        expected_digest: &ClipboardDigest,
    ) -> Result<bool, String> {
        let _clipboard = open_clipboard(window)?;
        let observed_sequence = unsafe { GetClipboardSequenceNumber() as u64 };
        let Some(observed_digest) = read_unicode_text_digest()? else {
            return Ok(false);
        };
        if !clipboard_snapshot_matches(
            expected_sequence,
            observed_sequence,
            expected_digest,
            &observed_digest,
        ) {
            return Ok(false);
        }
        if unsafe { EmptyClipboard() } == 0 {
            return Err("sensitive_clipboard_clear_failed".to_owned());
        }
        Ok(true)
    }
}

#[cfg(target_os = "windows")]
fn platform_write_sensitive(
    _app: &AppHandle,
    window: &WebviewWindow,
    text: &str,
) -> Result<(ClipboardHistoryProtection, u64), String> {
    windows::write_sensitive(window, text)
}

#[cfg(target_os = "windows")]
fn platform_clear_if_unchanged(
    _app: &AppHandle,
    window: &WebviewWindow,
    expected_sequence: u64,
    expected_digest: &ClipboardDigest,
) -> Result<bool, String> {
    windows::clear_if_unchanged(window, expected_sequence, expected_digest)
}

#[cfg(test)]
mod tests {
    use super::{clipboard_digest, should_clear_snapshot, SensitiveClipboardState};

    #[test]
    fn clear_requires_the_same_generation_sequence_and_content() {
        let digest = clipboard_digest("credential-secret");
        assert!(should_clear_snapshot(4, Some(4), 91, 91, &digest, &digest));
        assert!(!should_clear_snapshot(4, Some(5), 91, 91, &digest, &digest));
        assert!(!should_clear_snapshot(4, Some(4), 91, 92, &digest, &digest));
        assert!(!should_clear_snapshot(
            4,
            Some(4),
            91,
            91,
            &digest,
            &clipboard_digest("new clipboard value"),
        ));
    }

    #[test]
    fn clipboard_digest_is_content_sensitive_and_deterministic() {
        assert_eq!(clipboard_digest("same"), clipboard_digest("same"));
        assert_ne!(clipboard_digest("same"), clipboard_digest("changed"));
    }

    #[test]
    fn clear_completion_keeps_marker_for_an_in_flight_listener() {
        let state = SensitiveClipboardState::default();
        let digest = clipboard_digest("in-flight-value");
        let generation = {
            let _write_guard = state.write_guard();
            state.register_write(17, digest)
        };
        {
            let _write_guard = state.write_guard();
            state.finish_generation(generation);
        }

        assert!(state.should_ignore("in-flight-value", 17));
        assert!(state.should_ignore("in-flight-value", 17));
    }

    #[test]
    fn unacknowledged_markers_are_not_evicted_by_later_sensitive_copies() {
        let state = SensitiveClipboardState::default();
        for sequence in 1..=16 {
            let value = format!("sensitive-{sequence}");
            let _write_guard = state.write_guard();
            state.register_write(sequence, clipboard_digest(&value));
        }

        assert!(state.should_ignore("sensitive-1", 1));
        assert!(state.should_ignore("sensitive-16", 16));
    }
}
