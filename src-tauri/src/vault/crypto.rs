use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand::{rngs::OsRng, RngCore};
use std::fmt;
use zeroize::Zeroizing;

pub const SALT_BYTES: usize = 16;
pub const NONCE_BYTES: usize = 24;
const KEY_BYTES: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KdfParameters {
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

impl KdfParameters {
    pub const fn production() -> Self {
        Self {
            memory_kib: 65_536,
            iterations: 3,
            parallelism: 1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CryptoError {
    InvalidParameters,
    InvalidEncoding,
    InvalidLength,
    KeyDerivationFailed,
    EncryptionFailed,
    DecryptionFailed,
}

impl fmt::Display for CryptoError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidParameters => "vault_crypto_invalid_parameters",
            Self::InvalidEncoding => "vault_crypto_invalid_encoding",
            Self::InvalidLength => "vault_crypto_invalid_length",
            Self::KeyDerivationFailed => "vault_key_derivation_failed",
            Self::EncryptionFailed => "vault_encrypt_failed",
            Self::DecryptionFailed => "vault_decrypt_failed",
        })
    }
}

impl std::error::Error for CryptoError {}

pub fn random_salt() -> [u8; SALT_BYTES] {
    let mut salt = [0_u8; SALT_BYTES];
    OsRng.fill_bytes(&mut salt);
    salt
}

pub fn derive_key(
    password: &[u8],
    salt: &[u8],
    parameters: KdfParameters,
) -> Result<Zeroizing<[u8; KEY_BYTES]>, CryptoError> {
    if password.is_empty() || salt.len() < 8 {
        return Err(CryptoError::InvalidLength);
    }
    let params = Params::new(
        parameters.memory_kib,
        parameters.iterations,
        parameters.parallelism,
        Some(KEY_BYTES),
    )
    .map_err(|_| CryptoError::InvalidParameters)?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0_u8; KEY_BYTES]);
    argon2
        .hash_password_into(password, salt, key.as_mut())
        .map_err(|_| CryptoError::KeyDerivationFailed)?;
    Ok(key)
}

pub fn encrypt(
    key: &[u8; KEY_BYTES],
    plaintext: &[u8],
    associated_data: &[u8],
) -> Result<(Vec<u8>, [u8; NONCE_BYTES]), CryptoError> {
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| CryptoError::InvalidLength)?;
    let mut nonce = [0_u8; NONCE_BYTES];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: associated_data,
            },
        )
        .map_err(|_| CryptoError::EncryptionFailed)?;
    Ok((ciphertext, nonce))
}

pub fn decrypt(
    key: &[u8; KEY_BYTES],
    ciphertext: &[u8],
    nonce: &[u8],
    associated_data: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    if nonce.len() != NONCE_BYTES {
        return Err(CryptoError::InvalidLength);
    }
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| CryptoError::InvalidLength)?;
    cipher
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: associated_data,
            },
        )
        .map_err(|_| CryptoError::DecryptionFailed)
}

pub fn encode_bytes(bytes: &[u8]) -> String {
    STANDARD_NO_PAD.encode(bytes)
}

pub fn decode_bytes(encoded: &str) -> Result<Vec<u8>, CryptoError> {
    STANDARD_NO_PAD
        .decode(encoded)
        .map_err(|_| CryptoError::InvalidEncoding)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_parameters() -> KdfParameters {
        KdfParameters {
            memory_kib: 32,
            iterations: 1,
            parallelism: 1,
        }
    }

    #[test]
    fn correct_password_decrypts_and_wrong_password_does_not() {
        let salt = [7_u8; SALT_BYTES];
        let key = derive_key(b"correct password", &salt, test_parameters()).unwrap();
        let wrong_key = derive_key(b"wrong password", &salt, test_parameters()).unwrap();
        let (ciphertext, nonce) = encrypt(&key, b"fixed vault test data", b"test-aad").unwrap();

        assert_eq!(
            decrypt(&key, &ciphertext, &nonce, b"test-aad").unwrap(),
            b"fixed vault test data"
        );
        assert!(decrypt(&wrong_key, &ciphertext, &nonce, b"test-aad").is_err());
    }

    #[test]
    fn repeated_encryption_uses_distinct_nonces_and_ciphertexts() {
        let key = Zeroizing::new([3_u8; KEY_BYTES]);
        let first = encrypt(&key, b"same plaintext", b"same-aad").unwrap();
        let second = encrypt(&key, b"same plaintext", b"same-aad").unwrap();

        assert_ne!(first.1, second.1);
        assert_ne!(first.0, second.0);
    }

    #[test]
    fn modified_ciphertext_is_rejected() {
        let key = Zeroizing::new([5_u8; KEY_BYTES]);
        let (mut ciphertext, nonce) = encrypt(&key, b"authenticated", b"item-1").unwrap();
        ciphertext[0] ^= 0x80;
        assert!(decrypt(&key, &ciphertext, &nonce, b"item-1").is_err());
    }

    #[test]
    fn salts_and_nonces_are_generated_at_the_expected_random_lengths() {
        let first_salt = random_salt();
        let second_salt = random_salt();
        let key = Zeroizing::new([9_u8; KEY_BYTES]);
        let (_, first_nonce) = encrypt(&key, b"one", b"aad").unwrap();
        let (_, second_nonce) = encrypt(&key, b"two", b"aad").unwrap();

        assert_eq!(first_salt.len(), SALT_BYTES);
        assert_eq!(first_nonce.len(), NONCE_BYTES);
        assert_ne!(first_salt, second_salt);
        assert_ne!(first_nonce, second_nonce);
    }
}
