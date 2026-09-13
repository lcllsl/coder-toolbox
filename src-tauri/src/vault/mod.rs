pub mod clipboard;
pub mod crypto;
pub mod repository;
pub mod state;

use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

pub const VAULT_VERSION: i64 = 1;
pub const VAULT_CHECK_PLAINTEXT: &[u8] = b"maopao-vault-check-v1";
pub const VAULT_CHECK_AAD: &[u8] = b"maopao-vault-metadata-v1";

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct VaultPasswordRequest {
    pub master_password: String,
    #[zeroize(skip)]
    pub auto_lock_seconds: u64,
}

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct CredentialPayload {
    pub title: String,
    pub username: String,
    pub password: String,
    pub note: String,
}

impl CredentialPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.title.trim().is_empty() {
            return Err("vault_title_required");
        }
        if self.password.is_empty() {
            return Err("vault_password_required");
        }
        if self.title.chars().count() > 512
            || self.username.chars().count() > 4_096
            || self.password.chars().count() > 32_768
            || self.note.chars().count() > 65_536
        {
            return Err("vault_item_too_large");
        }
        Ok(())
    }
}

#[derive(Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct VaultItemResponse {
    pub id: String,
    pub title: String,
    pub username: String,
    pub password: String,
    pub note: String,
    #[zeroize(skip)]
    pub created_at: i64,
    #[zeroize(skip)]
    pub updated_at: i64,
}

impl VaultItemResponse {
    pub fn from_payload(
        id: String,
        mut payload: CredentialPayload,
        created_at: i64,
        updated_at: i64,
    ) -> Self {
        Self {
            id,
            title: std::mem::take(&mut payload.title),
            username: std::mem::take(&mut payload.username),
            password: std::mem::take(&mut payload.password),
            note: std::mem::take(&mut payload.note),
            created_at,
            updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatusResponse {
    pub initialized: bool,
    pub unlocked: bool,
}

pub fn item_associated_data(id: &str) -> Vec<u8> {
    format!("maopao-vault-item-v1:{id}").into_bytes()
}

pub fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
