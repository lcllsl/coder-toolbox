use keyring::{Entry, Error as KeyringError};
use zeroize::Zeroizing;

// v2 intentionally avoids probing the legacy development credential. Reading that
// item can trigger a macOS authorization dialog after an ad-hoc binary is rebuilt.
const KEYRING_SERVICE: &str = "com.petaltoolbox.desktop.ai.v2";
const KEYRING_ACCOUNT: &str = "deepseek-api-key";

fn entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|_| "ai_secure_storage_unavailable".to_owned())
}

pub fn save_api_key(api_key: String) -> Result<(), String> {
    let api_key = Zeroizing::new(api_key);
    let trimmed = api_key.trim();
    if trimmed.len() < 12 || trimmed.len() > 512 {
        return Err("ai_api_key_invalid".to_owned());
    }
    entry()?
        .set_password(trimmed)
        .map_err(|_| "ai_secure_storage_write_failed".to_owned())
}

pub fn load_api_key() -> Result<Zeroizing<String>, String> {
    let value = entry()?.get_password().map_err(|error| match error {
        KeyringError::NoEntry => "ai_api_key_missing".to_owned(),
        _ => "ai_secure_storage_read_failed".to_owned(),
    })?;
    if value.trim().is_empty() {
        return Err("ai_api_key_missing".to_owned());
    }
    Ok(Zeroizing::new(value))
}

pub fn delete_api_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(_) => Err("ai_secure_storage_delete_failed".to_owned()),
    }
}
