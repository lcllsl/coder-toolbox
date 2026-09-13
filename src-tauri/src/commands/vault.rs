use crate::vault::{
    clipboard::{secure_copy, SensitiveClipboardCopyResult, SensitiveClipboardField},
    crypto::{
        decode_bytes, decrypt, derive_key, encode_bytes, encrypt, random_salt, KdfParameters,
        SALT_BYTES,
    },
    item_associated_data, now_millis,
    repository::{EncryptedVaultItem, VaultMetadata, VaultRepository},
    state::VaultState,
    CredentialPayload, VaultItemResponse, VaultPasswordRequest, VaultStatusResponse,
    VAULT_CHECK_AAD, VAULT_CHECK_PLAINTEXT, VAULT_VERSION,
};
use serde::Deserialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use tauri_plugin_sql::DbInstances;
use uuid::Uuid;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

const PANEL_WINDOW: &str = "panel-window";

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct VaultCopyTextRequest {
    text: String,
    #[zeroize(skip)]
    field: SensitiveClipboardField,
}

#[tauri::command]
pub async fn vault_status(
    window: WebviewWindow,
    databases: State<'_, DbInstances>,
    state: State<'_, Arc<VaultState>>,
) -> Result<VaultStatusResponse, String> {
    ensure_panel_window(&window)?;
    let repository = VaultRepository::from_instances(&databases)
        .await
        .map_err(|error| error.to_string())?;
    let initialized = repository
        .is_initialized()
        .await
        .map_err(|error| error.to_string())?;
    let unlocked = initialized && state.is_unlocked();
    emit_pending_lock(&window, &state);
    Ok(VaultStatusResponse {
        initialized,
        unlocked,
    })
}

#[tauri::command]
pub async fn vault_initialize(
    mut request: VaultPasswordRequest,
    window: WebviewWindow,
    databases: State<'_, DbInstances>,
    state: State<'_, Arc<VaultState>>,
) -> Result<(), String> {
    ensure_panel_window(&window)?;
    let lifecycle_generation = state.generation();
    if request.master_password.is_empty() {
        return Err("vault_master_password_required".into());
    }
    if request.master_password.chars().count() > 1_024 {
        return Err("vault_master_password_too_large".into());
    }
    let _mutation_guard = state.mutation_guard().await;
    ensure_lifecycle_generation(&window, &state, lifecycle_generation)?;
    let repository = VaultRepository::from_instances(&databases)
        .await
        .map_err(|error| error.to_string())?;
    if repository
        .is_initialized()
        .await
        .map_err(|error| error.to_string())?
    {
        return Err("vault_already_initialized".into());
    }

    let password = Zeroizing::new(std::mem::take(&mut request.master_password));
    let salt = random_salt();
    let parameters = KdfParameters::production();
    let key = derive_key_off_main_thread(password, salt.to_vec(), parameters).await?;
    let (check_ciphertext, check_nonce) = encrypt(&key, VAULT_CHECK_PLAINTEXT, VAULT_CHECK_AAD)
        .map_err(|_| "vault_initialize_failed".to_string())?;
    let now = now_millis();
    let metadata = VaultMetadata {
        vault_version: VAULT_VERSION,
        salt: encode_bytes(&salt),
        kdf_memory_kib: i64::from(parameters.memory_kib),
        kdf_iterations: i64::from(parameters.iterations),
        kdf_parallelism: i64::from(parameters.parallelism),
        check_ciphertext: encode_bytes(&check_ciphertext),
        check_nonce: encode_bytes(&check_nonce),
        created_at: now,
        updated_at: now,
    };
    ensure_lifecycle_generation(&window, &state, lifecycle_generation)?;
    repository
        .initialize(&metadata)
        .await
        .map_err(|error| error.to_string())?;
    state
        .unlock_if_generation(key, request.auto_lock_seconds, lifecycle_generation)
        .then_some(())
        .ok_or_else(|| "vault_locked".to_owned())
}

#[tauri::command]
pub async fn vault_unlock(
    mut request: VaultPasswordRequest,
    window: WebviewWindow,
    databases: State<'_, DbInstances>,
    state: State<'_, Arc<VaultState>>,
) -> Result<(), String> {
    ensure_panel_window(&window)?;
    let lifecycle_generation = state.generation();
    if request.master_password.is_empty() {
        return Err("invalid_password".into());
    }
    if request.master_password.chars().count() > 1_024 {
        return Err("invalid_password".into());
    }
    let _mutation_guard = state.mutation_guard().await;
    ensure_lifecycle_generation(&window, &state, lifecycle_generation)?;
    let repository = VaultRepository::from_instances(&databases)
        .await
        .map_err(|error| error.to_string())?;
    let metadata = repository
        .metadata()
        .await
        .map_err(|error| error.to_string())?;
    if metadata.vault_version != VAULT_VERSION {
        return Err("vault_version_unsupported".into());
    }
    let parameters = metadata_parameters(&metadata)?;
    let salt = decode_bytes(&metadata.salt).map_err(|_| "vault_unlock_failed".to_string())?;
    if salt.len() != SALT_BYTES {
        return Err("vault_unlock_failed".into());
    }
    let password = Zeroizing::new(std::mem::take(&mut request.master_password));
    let key = derive_key_off_main_thread(password, salt, parameters).await?;
    let check_ciphertext =
        decode_bytes(&metadata.check_ciphertext).map_err(|_| "vault_unlock_failed".to_string())?;
    let check_nonce =
        decode_bytes(&metadata.check_nonce).map_err(|_| "vault_unlock_failed".to_string())?;
    let check = decrypt(&key, &check_ciphertext, &check_nonce, VAULT_CHECK_AAD)
        .map_err(|_| "invalid_password".to_string())?;
    if check.as_slice() != VAULT_CHECK_PLAINTEXT {
        return Err("invalid_password".into());
    }
    state
        .unlock_if_generation(key, request.auto_lock_seconds, lifecycle_generation)
        .then_some(())
        .ok_or_else(|| "vault_locked".to_owned())
}

#[tauri::command]
pub async fn vault_list_items(
    window: WebviewWindow,
    databases: State<'_, DbInstances>,
    state: State<'_, Arc<VaultState>>,
) -> Result<Vec<VaultItemResponse>, String> {
    ensure_panel_window(&window)?;
    let (key, generation) = session_key(&window, &state)?;
    let repository = VaultRepository::from_instances(&databases)
        .await
        .map_err(|error| error.to_string())?;
    let encrypted_items = repository
        .list_items()
        .await
        .map_err(|error| error.to_string())?;
    let items = encrypted_items
        .into_iter()
        .map(|item| decrypt_item(&key, item))
        .collect::<Result<Vec<_>, _>>()?;
    ensure_current_generation(&window, &state, generation)?;
    Ok(items)
}

#[tauri::command]
pub async fn vault_create_item(
    request: CredentialPayload,
    window: WebviewWindow,
    databases: State<'_, DbInstances>,
    state: State<'_, Arc<VaultState>>,
) -> Result<VaultItemResponse, String> {
    ensure_panel_window(&window)?;
    request.validate().map_err(str::to_string)?;
    let _mutation_guard = state.mutation_guard().await;
    let (key, generation) = session_key(&window, &state)?;
    let repository = VaultRepository::from_instances(&databases)
        .await
        .map_err(|error| error.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = now_millis();
    let encrypted = encrypt_item(&key, &id, &request, now, now)?;
    ensure_current_generation(&window, &state, generation)?;
    repository
        .insert_item(&encrypted)
        .await
        .map_err(|error| error.to_string())?;
    ensure_current_generation(&window, &state, generation)?;
    Ok(VaultItemResponse::from_payload(id, request, now, now))
}

#[tauri::command]
pub async fn vault_update_item(
    id: String,
    request: CredentialPayload,
    window: WebviewWindow,
    databases: State<'_, DbInstances>,
    state: State<'_, Arc<VaultState>>,
) -> Result<VaultItemResponse, String> {
    ensure_panel_window(&window)?;
    request.validate().map_err(str::to_string)?;
    let _mutation_guard = state.mutation_guard().await;
    let (key, generation) = session_key(&window, &state)?;
    let repository = VaultRepository::from_instances(&databases)
        .await
        .map_err(|error| error.to_string())?;
    let existing = repository
        .item(&id)
        .await
        .map_err(|error| error.to_string())?;
    let updated_at = now_millis();
    let encrypted = encrypt_item(&key, &id, &request, existing.created_at, updated_at)?;
    ensure_current_generation(&window, &state, generation)?;
    repository
        .update_item(
            &id,
            &encrypted.ciphertext,
            &encrypted.nonce,
            encrypted.updated_at,
        )
        .await
        .map_err(|error| error.to_string())?;
    ensure_current_generation(&window, &state, generation)?;
    Ok(VaultItemResponse::from_payload(
        id,
        request,
        existing.created_at,
        updated_at,
    ))
}

#[tauri::command]
pub async fn vault_delete_item(
    id: String,
    window: WebviewWindow,
    databases: State<'_, DbInstances>,
    state: State<'_, Arc<VaultState>>,
) -> Result<(), String> {
    ensure_panel_window(&window)?;
    let _mutation_guard = state.mutation_guard().await;
    let (_key, generation) = session_key(&window, &state)?;
    let repository = VaultRepository::from_instances(&databases)
        .await
        .map_err(|error| error.to_string())?;
    ensure_current_generation(&window, &state, generation)?;
    repository
        .delete_item(&id)
        .await
        .map_err(|error| error.to_string())?;
    ensure_current_generation(&window, &state, generation)
}

#[tauri::command]
pub async fn vault_copy_item_field(
    id: String,
    field: SensitiveClipboardField,
    app: AppHandle,
    window: WebviewWindow,
    databases: State<'_, DbInstances>,
    state: State<'_, Arc<VaultState>>,
) -> Result<SensitiveClipboardCopyResult, String> {
    ensure_panel_window(&window)?;
    let (mut item, generation) = decrypted_item(&id, &window, &databases, &state).await?;
    let text = match field {
        SensitiveClipboardField::Username => std::mem::take(&mut item.username),
        SensitiveClipboardField::Password => std::mem::take(&mut item.password),
    };
    let result = secure_copy(
        app,
        window.clone(),
        state.inner().clone(),
        generation,
        text,
        field,
    )
    .await;
    if result.is_err() {
        emit_pending_lock(&window, &state);
    }
    result
}

#[tauri::command]
pub async fn vault_copy_text(
    mut request: VaultCopyTextRequest,
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<VaultState>>,
) -> Result<SensitiveClipboardCopyResult, String> {
    ensure_panel_window(&window)?;
    let max_characters = match request.field {
        SensitiveClipboardField::Username => 4_096,
        SensitiveClipboardField::Password => 32_768,
    };
    if request.text.chars().count() > max_characters {
        return Err("sensitive_clipboard_text_too_large".into());
    }
    let (_key, generation) = session_key(&window, &state)?;
    let text = std::mem::take(&mut request.text);
    let result = secure_copy(
        app,
        window.clone(),
        state.inner().clone(),
        generation,
        text,
        request.field,
    )
    .await;
    if result.is_err() {
        emit_pending_lock(&window, &state);
    }
    result
}

#[tauri::command]
pub fn vault_lock(window: WebviewWindow, state: State<'_, Arc<VaultState>>) -> Result<(), String> {
    ensure_panel_window(&window)?;
    state.lock();
    let _ = window.emit("vault:locked", ());
    Ok(())
}

#[tauri::command]
pub fn vault_touch(
    auto_lock_seconds: u64,
    window: WebviewWindow,
    state: State<'_, Arc<VaultState>>,
) -> Result<(), String> {
    ensure_panel_window(&window)?;
    let touched = state
        .touch(Some(auto_lock_seconds))
        .then_some(())
        .ok_or_else(|| "vault_locked".to_string());
    if touched.is_err() {
        emit_pending_lock(&window, &state);
    }
    touched
}

#[tauri::command]
pub fn vault_configure_auto_lock(
    auto_lock_seconds: u64,
    window: WebviewWindow,
    state: State<'_, Arc<VaultState>>,
) -> Result<(), String> {
    ensure_panel_window(&window)?;
    state.configure_timeout(auto_lock_seconds);
    emit_pending_lock(&window, &state);
    Ok(())
}

#[tauri::command]
pub async fn vault_reset(
    window: WebviewWindow,
    databases: State<'_, DbInstances>,
    state: State<'_, Arc<VaultState>>,
) -> Result<(), String> {
    ensure_panel_window(&window)?;
    let _mutation_guard = state.mutation_guard().await;
    state.lock();
    let _ = window.emit("vault:locked", ());
    let repository = VaultRepository::from_instances(&databases)
        .await
        .map_err(|error| error.to_string())?;
    repository.clear().await.map_err(|error| error.to_string())
}

pub(crate) async fn decrypted_item(
    id: &str,
    window: &WebviewWindow,
    databases: &DbInstances,
    state: &VaultState,
) -> Result<(VaultItemResponse, u64), String> {
    let (key, generation) = session_key(window, state)?;
    let repository = VaultRepository::from_instances(databases)
        .await
        .map_err(|error| error.to_string())?;
    let item = repository
        .item(id)
        .await
        .map_err(|error| error.to_string())?;
    let decrypted = decrypt_item(&key, item)?;
    ensure_current_generation(window, state, generation)?;
    Ok((decrypted, generation))
}

fn session_key(
    window: &WebviewWindow,
    state: &VaultState,
) -> Result<(Zeroizing<[u8; 32]>, u64), String> {
    let key = state.key().map_err(str::to_string);
    if key.is_err() {
        emit_pending_lock(window, state);
    }
    key
}

fn ensure_current_generation(
    window: &WebviewWindow,
    state: &VaultState,
    generation: u64,
) -> Result<(), String> {
    if state.is_current_generation(generation) {
        return Ok(());
    }
    emit_pending_lock(window, state);
    Err("vault_locked".to_owned())
}

fn ensure_lifecycle_generation(
    window: &WebviewWindow,
    state: &VaultState,
    generation: u64,
) -> Result<(), String> {
    if state.generation() == generation {
        return Ok(());
    }
    emit_pending_lock(window, state);
    Err("vault_locked".to_owned())
}

fn emit_pending_lock(window: &WebviewWindow, state: &VaultState) {
    if state.take_pending_lock_event() {
        let _ = window.emit("vault:locked", ());
    }
}

fn ensure_panel_window(window: &WebviewWindow) -> Result<(), String> {
    (window.label() == PANEL_WINDOW)
        .then_some(())
        .ok_or_else(|| "vault_command_forbidden".to_string())
}

fn metadata_parameters(metadata: &VaultMetadata) -> Result<KdfParameters, String> {
    let parameters = KdfParameters {
        memory_kib: u32::try_from(metadata.kdf_memory_kib)
            .map_err(|_| "vault_unlock_failed".to_string())?,
        iterations: u32::try_from(metadata.kdf_iterations)
            .map_err(|_| "vault_unlock_failed".to_string())?,
        parallelism: u32::try_from(metadata.kdf_parallelism)
            .map_err(|_| "vault_unlock_failed".to_string())?,
    };
    // Version 1 uses one audited parameter set. Refuse tampered metadata before
    // Argon2 can be coerced into excessive memory or CPU use.
    if parameters != KdfParameters::production() {
        return Err("vault_unlock_failed".into());
    }
    Ok(parameters)
}

async fn derive_key_off_main_thread(
    password: Zeroizing<String>,
    salt: Vec<u8>,
    parameters: KdfParameters,
) -> Result<Zeroizing<[u8; 32]>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        derive_key(password.as_bytes(), &salt, parameters)
            .map_err(|_| "vault_key_derivation_failed".to_string())
    })
    .await
    .map_err(|_| "vault_key_derivation_failed".to_string())?
}

fn encrypt_item(
    key: &[u8; 32],
    id: &str,
    payload: &CredentialPayload,
    created_at: i64,
    updated_at: i64,
) -> Result<EncryptedVaultItem, String> {
    let serialized = Zeroizing::new(
        serde_json::to_vec(payload).map_err(|_| "vault_encrypt_failed".to_string())?,
    );
    let (ciphertext, nonce) = encrypt(key, &serialized, &item_associated_data(id))
        .map_err(|_| "vault_encrypt_failed".to_string())?;
    Ok(EncryptedVaultItem {
        id: id.to_string(),
        ciphertext: encode_bytes(&ciphertext),
        nonce: encode_bytes(&nonce),
        created_at,
        updated_at,
    })
}

fn decrypt_item(
    key: &[u8; 32],
    encrypted: EncryptedVaultItem,
) -> Result<VaultItemResponse, String> {
    let ciphertext =
        decode_bytes(&encrypted.ciphertext).map_err(|_| "vault_decrypt_failed".to_string())?;
    let nonce = decode_bytes(&encrypted.nonce).map_err(|_| "vault_decrypt_failed".to_string())?;
    let plaintext = Zeroizing::new(
        decrypt(
            key,
            &ciphertext,
            &nonce,
            &item_associated_data(&encrypted.id),
        )
        .map_err(|_| "vault_decrypt_failed".to_string())?,
    );
    let payload: CredentialPayload =
        serde_json::from_slice(&plaintext).map_err(|_| "vault_decrypt_failed".to_string())?;
    payload
        .validate()
        .map_err(|_| "vault_decrypt_failed".to_string())?;
    Ok(VaultItemResponse::from_payload(
        encrypted.id,
        payload,
        encrypted.created_at,
        encrypted.updated_at,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_database_row_does_not_contain_payload_plaintext() {
        let key = Zeroizing::new([11_u8; 32]);
        let payload = CredentialPayload {
            title: "Test Admin Portal".into(),
            username: "fixed-user-001".into(),
            password: "fixed-secret-001".into(),
            note: "fixed-production-note".into(),
        };
        let encrypted = encrypt_item(&key, "item-1", &payload, 1, 1).unwrap();
        let database_text = format!("{} {}", encrypted.ciphertext, encrypted.nonce);

        for plaintext in [
            "Test Admin Portal",
            "fixed-user-001",
            "fixed-secret-001",
            "fixed-production-note",
        ] {
            assert!(!database_text.contains(plaintext));
        }
        let decrypted = decrypt_item(&key, encrypted).unwrap();
        assert_eq!(decrypted.password, "fixed-secret-001");
    }
}
