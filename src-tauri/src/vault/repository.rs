use sqlx::{sqlite::SqliteRow, Row, SqlitePool};
use std::fmt;
use tauri_plugin_sql::{DbInstances, DbPool};

const DATABASE_URL: &str = "sqlite:petal-toolbox.db";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultMetadata {
    pub vault_version: i64,
    pub salt: String,
    pub kdf_memory_kib: i64,
    pub kdf_iterations: i64,
    pub kdf_parallelism: i64,
    pub check_ciphertext: String,
    pub check_nonce: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncryptedVaultItem {
    pub id: String,
    pub ciphertext: String,
    pub nonce: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepositoryError {
    DatabaseUnavailable,
    ReadFailed,
    WriteFailed,
    AlreadyInitialized,
    NotInitialized,
    ItemNotFound,
}

impl fmt::Display for RepositoryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::DatabaseUnavailable => "vault_database_unavailable",
            Self::ReadFailed => "vault_database_read_failed",
            Self::WriteFailed => "vault_database_write_failed",
            Self::AlreadyInitialized => "vault_already_initialized",
            Self::NotInitialized => "vault_not_initialized",
            Self::ItemNotFound => "vault_item_not_found",
        })
    }
}

impl std::error::Error for RepositoryError {}

#[derive(Clone)]
pub struct VaultRepository {
    pool: SqlitePool,
}

impl VaultRepository {
    pub async fn from_instances(instances: &DbInstances) -> Result<Self, RepositoryError> {
        let databases = instances.0.read().await;
        let database = databases
            .get(DATABASE_URL)
            .ok_or(RepositoryError::DatabaseUnavailable)?;
        #[allow(unreachable_patterns)]
        let pool = match database {
            DbPool::Sqlite(pool) => pool.clone(),
            _ => return Err(RepositoryError::DatabaseUnavailable),
        };
        Ok(Self { pool })
    }

    #[cfg(test)]
    fn from_pool(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn is_initialized(&self) -> Result<bool, RepositoryError> {
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM vault_metadata WHERE singleton_id = 1")
                .fetch_one(&self.pool)
                .await
                .map_err(|_| RepositoryError::ReadFailed)?;
        Ok(count == 1)
    }

    pub async fn metadata(&self) -> Result<VaultMetadata, RepositoryError> {
        let row = sqlx::query(
            "SELECT vault_version, salt, kdf_memory_kib, kdf_iterations, kdf_parallelism, \
             check_ciphertext, check_nonce, created_at, updated_at \
             FROM vault_metadata WHERE singleton_id = 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| RepositoryError::ReadFailed)?
        .ok_or(RepositoryError::NotInitialized)?;
        map_metadata(&row)
    }

    pub async fn initialize(&self, metadata: &VaultMetadata) -> Result<(), RepositoryError> {
        let result = sqlx::query(
            "INSERT INTO vault_metadata \
             (singleton_id, vault_version, salt, kdf_memory_kib, kdf_iterations, kdf_parallelism, \
              check_ciphertext, check_nonce, created_at, updated_at) \
             VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(metadata.vault_version)
        .bind(&metadata.salt)
        .bind(metadata.kdf_memory_kib)
        .bind(metadata.kdf_iterations)
        .bind(metadata.kdf_parallelism)
        .bind(&metadata.check_ciphertext)
        .bind(&metadata.check_nonce)
        .bind(metadata.created_at)
        .bind(metadata.updated_at)
        .execute(&self.pool)
        .await;

        match result {
            Ok(_) => Ok(()),
            Err(error)
                if error
                    .as_database_error()
                    .is_some_and(|value| value.is_unique_violation()) =>
            {
                Err(RepositoryError::AlreadyInitialized)
            }
            Err(_) => Err(RepositoryError::WriteFailed),
        }
    }

    pub async fn list_items(&self) -> Result<Vec<EncryptedVaultItem>, RepositoryError> {
        let rows = sqlx::query(
            "SELECT id, ciphertext, nonce, created_at, updated_at \
             FROM vault_items ORDER BY updated_at DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|_| RepositoryError::ReadFailed)?;
        rows.iter().map(map_item).collect()
    }

    pub async fn item(&self, id: &str) -> Result<EncryptedVaultItem, RepositoryError> {
        let row = sqlx::query(
            "SELECT id, ciphertext, nonce, created_at, updated_at FROM vault_items WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| RepositoryError::ReadFailed)?
        .ok_or(RepositoryError::ItemNotFound)?;
        map_item(&row)
    }

    pub async fn insert_item(&self, item: &EncryptedVaultItem) -> Result<(), RepositoryError> {
        sqlx::query(
            "INSERT INTO vault_items (id, ciphertext, nonce, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&item.id)
        .bind(&item.ciphertext)
        .bind(&item.nonce)
        .bind(item.created_at)
        .bind(item.updated_at)
        .execute(&self.pool)
        .await
        .map_err(|_| RepositoryError::WriteFailed)?;
        Ok(())
    }

    pub async fn update_item(
        &self,
        id: &str,
        ciphertext: &str,
        nonce: &str,
        updated_at: i64,
    ) -> Result<(), RepositoryError> {
        let result = sqlx::query(
            "UPDATE vault_items SET ciphertext = ?, nonce = ?, updated_at = ? WHERE id = ?",
        )
        .bind(ciphertext)
        .bind(nonce)
        .bind(updated_at)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|_| RepositoryError::WriteFailed)?;
        if result.rows_affected() == 0 {
            return Err(RepositoryError::ItemNotFound);
        }
        Ok(())
    }

    pub async fn delete_item(&self, id: &str) -> Result<(), RepositoryError> {
        let result = sqlx::query("DELETE FROM vault_items WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|_| RepositoryError::WriteFailed)?;
        if result.rows_affected() == 0 {
            return Err(RepositoryError::ItemNotFound);
        }
        Ok(())
    }

    pub async fn clear(&self) -> Result<(), RepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| RepositoryError::WriteFailed)?;
        sqlx::query("DELETE FROM vault_items")
            .execute(&mut *transaction)
            .await
            .map_err(|_| RepositoryError::WriteFailed)?;
        sqlx::query("DELETE FROM vault_metadata WHERE singleton_id = 1")
            .execute(&mut *transaction)
            .await
            .map_err(|_| RepositoryError::WriteFailed)?;
        transaction
            .commit()
            .await
            .map_err(|_| RepositoryError::WriteFailed)
    }
}

fn map_metadata(row: &SqliteRow) -> Result<VaultMetadata, RepositoryError> {
    Ok(VaultMetadata {
        vault_version: row
            .try_get("vault_version")
            .map_err(|_| RepositoryError::ReadFailed)?,
        salt: row
            .try_get("salt")
            .map_err(|_| RepositoryError::ReadFailed)?,
        kdf_memory_kib: row
            .try_get("kdf_memory_kib")
            .map_err(|_| RepositoryError::ReadFailed)?,
        kdf_iterations: row
            .try_get("kdf_iterations")
            .map_err(|_| RepositoryError::ReadFailed)?,
        kdf_parallelism: row
            .try_get("kdf_parallelism")
            .map_err(|_| RepositoryError::ReadFailed)?,
        check_ciphertext: row
            .try_get("check_ciphertext")
            .map_err(|_| RepositoryError::ReadFailed)?,
        check_nonce: row
            .try_get("check_nonce")
            .map_err(|_| RepositoryError::ReadFailed)?,
        created_at: row
            .try_get("created_at")
            .map_err(|_| RepositoryError::ReadFailed)?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|_| RepositoryError::ReadFailed)?,
    })
}

fn map_item(row: &SqliteRow) -> Result<EncryptedVaultItem, RepositoryError> {
    Ok(EncryptedVaultItem {
        id: row.try_get("id").map_err(|_| RepositoryError::ReadFailed)?,
        ciphertext: row
            .try_get("ciphertext")
            .map_err(|_| RepositoryError::ReadFailed)?,
        nonce: row
            .try_get("nonce")
            .map_err(|_| RepositoryError::ReadFailed)?,
        created_at: row
            .try_get("created_at")
            .map_err(|_| RepositoryError::ReadFailed)?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|_| RepositoryError::ReadFailed)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::{
        crypto::{
            decode_bytes, decrypt, derive_key, encode_bytes, encrypt, KdfParameters, SALT_BYTES,
        },
        item_associated_data, CredentialPayload, VAULT_CHECK_AAD, VAULT_CHECK_PLAINTEXT,
        VAULT_VERSION,
    };
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::{fs, path::Path};
    use uuid::Uuid;
    use zeroize::Zeroizing;

    async fn repository() -> VaultRepository {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("../../migrations/0005_vault.sql"))
            .execute(&pool)
            .await
            .unwrap();
        VaultRepository::from_pool(pool)
    }

    async fn file_repository(path: &Path) -> VaultRepository {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(path)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("../../migrations/0005_vault.sql"))
            .execute(&pool)
            .await
            .unwrap();
        VaultRepository::from_pool(pool)
    }

    fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
        haystack
            .windows(needle.len())
            .any(|window| window == needle)
    }

    fn metadata() -> VaultMetadata {
        VaultMetadata {
            vault_version: 1,
            salt: "fixed-salt".into(),
            kdf_memory_kib: 32,
            kdf_iterations: 1,
            kdf_parallelism: 1,
            check_ciphertext: "fixed-check".into(),
            check_nonce: "fixed-nonce".into(),
            created_at: 1,
            updated_at: 1,
        }
    }

    fn item() -> EncryptedVaultItem {
        EncryptedVaultItem {
            id: "item-1".into(),
            ciphertext: "encrypted-payload".into(),
            nonce: "random-nonce".into(),
            created_at: 2,
            updated_at: 2,
        }
    }

    #[test]
    fn initializes_and_survives_a_new_repository_handle() {
        tauri::async_runtime::block_on(async {
            let repository = repository().await;
            assert!(!repository.is_initialized().await.unwrap());
            repository.initialize(&metadata()).await.unwrap();
            let reopened = VaultRepository::from_pool(repository.pool.clone());
            assert!(reopened.is_initialized().await.unwrap());
            assert_eq!(reopened.metadata().await.unwrap(), metadata());
        });
    }

    #[test]
    fn inserts_updates_and_deletes_items() {
        tauri::async_runtime::block_on(async {
            let repository = repository().await;
            repository.initialize(&metadata()).await.unwrap();
            repository.insert_item(&item()).await.unwrap();
            assert_eq!(repository.list_items().await.unwrap(), vec![item()]);

            repository
                .update_item("item-1", "new-ciphertext", "new-nonce", 3)
                .await
                .unwrap();
            let updated = repository.item("item-1").await.unwrap();
            assert_eq!(updated.ciphertext, "new-ciphertext");
            assert_eq!(updated.updated_at, 3);

            repository.delete_item("item-1").await.unwrap();
            assert!(repository.list_items().await.unwrap().is_empty());
        });
    }

    #[test]
    fn clearing_vault_removes_items_and_metadata_together() {
        tauri::async_runtime::block_on(async {
            let repository = repository().await;
            repository.initialize(&metadata()).await.unwrap();
            repository.insert_item(&item()).await.unwrap();
            repository.clear().await.unwrap();
            assert!(!repository.is_initialized().await.unwrap());
            assert!(repository.list_items().await.unwrap().is_empty());
        });
    }

    #[test]
    fn persisted_database_row_contains_only_encrypted_payload() {
        tauri::async_runtime::block_on(async {
            let repository = repository().await;
            repository.initialize(&metadata()).await.unwrap();
            let key = Zeroizing::new([17_u8; 32]);
            let payload = CredentialPayload {
                title: "SQLite Test Portal".into(),
                username: "sqlite-user-001".into(),
                password: "sqlite-secret-001".into(),
                note: "sqlite-private-note".into(),
            };
            let serialized = Zeroizing::new(serde_json::to_vec(&payload).unwrap());
            let associated_data = item_associated_data("encrypted-item-1");
            let (ciphertext, nonce) = encrypt(&key, &serialized, &associated_data).unwrap();
            repository
                .insert_item(&EncryptedVaultItem {
                    id: "encrypted-item-1".into(),
                    ciphertext: encode_bytes(&ciphertext),
                    nonce: encode_bytes(&nonce),
                    created_at: 3,
                    updated_at: 3,
                })
                .await
                .unwrap();

            let (stored_ciphertext, stored_nonce): (String, String) =
                sqlx::query_as("SELECT ciphertext, nonce FROM vault_items WHERE id = ?")
                    .bind("encrypted-item-1")
                    .fetch_one(&repository.pool)
                    .await
                    .unwrap();
            let raw_database_columns = format!("{stored_ciphertext} {stored_nonce}");
            for plaintext in [
                "SQLite Test Portal",
                "sqlite-user-001",
                "sqlite-secret-001",
                "sqlite-private-note",
            ] {
                assert!(!raw_database_columns.contains(plaintext));
            }

            let stored_ciphertext = decode_bytes(&stored_ciphertext).unwrap();
            let stored_nonce = decode_bytes(&stored_nonce).unwrap();
            let decrypted = Zeroizing::new(
                decrypt(&key, &stored_ciphertext, &stored_nonce, &associated_data).unwrap(),
            );
            let restored: CredentialPayload = serde_json::from_slice(&decrypted).unwrap();
            assert_eq!(restored.title, "SQLite Test Portal");
            assert_eq!(restored.username, "sqlite-user-001");
            assert_eq!(restored.password, "sqlite-secret-001");
            assert_eq!(restored.note, "sqlite-private-note");
        });
    }

    #[test]
    fn file_database_reopens_and_unlocks_without_persisting_payload_plaintext() {
        tauri::async_runtime::block_on(async {
            let path =
                std::env::temp_dir().join(format!("maopao-vault-reopen-{}.sqlite", Uuid::new_v4()));
            let repository = file_repository(&path).await;
            let salt = [23_u8; SALT_BYTES];
            let parameters = KdfParameters::production();
            let key = derive_key(b"restart-master-password", &salt, parameters).unwrap();
            let (check_ciphertext, check_nonce) =
                encrypt(&key, VAULT_CHECK_PLAINTEXT, VAULT_CHECK_AAD).unwrap();
            repository
                .initialize(&VaultMetadata {
                    vault_version: VAULT_VERSION,
                    salt: encode_bytes(&salt),
                    kdf_memory_kib: i64::from(parameters.memory_kib),
                    kdf_iterations: i64::from(parameters.iterations),
                    kdf_parallelism: i64::from(parameters.parallelism),
                    check_ciphertext: encode_bytes(&check_ciphertext),
                    check_nonce: encode_bytes(&check_nonce),
                    created_at: 4,
                    updated_at: 4,
                })
                .await
                .unwrap();
            let payload = CredentialPayload {
                title: "Restart Test Portal".into(),
                username: "restart-user-001".into(),
                password: "restart-secret-001".into(),
                note: "restart-private-note".into(),
            };
            let serialized = Zeroizing::new(serde_json::to_vec(&payload).unwrap());
            let associated_data = item_associated_data("restart-item-1");
            let (ciphertext, nonce) = encrypt(&key, &serialized, &associated_data).unwrap();
            repository
                .insert_item(&EncryptedVaultItem {
                    id: "restart-item-1".into(),
                    ciphertext: encode_bytes(&ciphertext),
                    nonce: encode_bytes(&nonce),
                    created_at: 5,
                    updated_at: 5,
                })
                .await
                .unwrap();
            repository.pool.close().await;
            drop(repository);

            let reopened = file_repository(&path).await;
            let stored_metadata = reopened.metadata().await.unwrap();
            let stored_salt = decode_bytes(&stored_metadata.salt).unwrap();
            let reopened_key = derive_key(
                b"restart-master-password",
                &stored_salt,
                KdfParameters {
                    memory_kib: stored_metadata.kdf_memory_kib.try_into().unwrap(),
                    iterations: stored_metadata.kdf_iterations.try_into().unwrap(),
                    parallelism: stored_metadata.kdf_parallelism.try_into().unwrap(),
                },
            )
            .unwrap();
            let wrong_key =
                derive_key(b"wrong-restart-password", &stored_salt, parameters).unwrap();
            let stored_check = decode_bytes(&stored_metadata.check_ciphertext).unwrap();
            let stored_check_nonce = decode_bytes(&stored_metadata.check_nonce).unwrap();
            assert_eq!(
                decrypt(
                    &reopened_key,
                    &stored_check,
                    &stored_check_nonce,
                    VAULT_CHECK_AAD,
                )
                .unwrap(),
                VAULT_CHECK_PLAINTEXT,
            );
            assert!(decrypt(
                &wrong_key,
                &stored_check,
                &stored_check_nonce,
                VAULT_CHECK_AAD,
            )
            .is_err());

            let stored_item = reopened.item("restart-item-1").await.unwrap();
            let stored_ciphertext = decode_bytes(&stored_item.ciphertext).unwrap();
            let stored_nonce = decode_bytes(&stored_item.nonce).unwrap();
            let restored_bytes = Zeroizing::new(
                decrypt(
                    &reopened_key,
                    &stored_ciphertext,
                    &stored_nonce,
                    &associated_data,
                )
                .unwrap(),
            );
            let restored: CredentialPayload = serde_json::from_slice(&restored_bytes).unwrap();
            assert_eq!(restored.title, "Restart Test Portal");
            assert_eq!(restored.username, "restart-user-001");
            assert_eq!(restored.password, "restart-secret-001");
            assert_eq!(restored.note, "restart-private-note");
            reopened.pool.close().await;
            drop(reopened);

            let database_bytes = fs::read(&path).unwrap();
            for plaintext in [
                "Restart Test Portal",
                "restart-user-001",
                "restart-secret-001",
                "restart-private-note",
            ] {
                assert!(!contains_bytes(&database_bytes, plaintext.as_bytes()));
            }
            fs::remove_file(&path).unwrap();
        });
    }
}
