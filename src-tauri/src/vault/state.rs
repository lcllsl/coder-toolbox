use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

const KEY_BYTES: usize = 32;
const DEFAULT_AUTO_LOCK_SECONDS: u64 = 5 * 60;

struct VaultSession {
    key: Zeroizing<[u8; KEY_BYTES]>,
    generation: u64,
    last_activity: Instant,
    timeout: Duration,
}

#[derive(Default)]
struct VaultStateInner {
    session: Option<VaultSession>,
    generation: u64,
    lock_event_pending: bool,
}

#[derive(Default)]
pub struct VaultState {
    inner: Mutex<VaultStateInner>,
    mutation_gate: tokio::sync::Mutex<()>,
}

impl VaultState {
    /// Serializes vault mutations whose database effects must be ordered with
    /// reset and unlock lifecycle changes.
    pub async fn mutation_guard(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.mutation_gate.lock().await
    }

    /// Captures the current lifecycle generation before an expensive unlock.
    /// A close/lock that happens while the KDF runs invalidates this value.
    pub fn generation(&self) -> u64 {
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        lock_if_expired_inner(&mut inner);
        inner.generation
    }

    pub fn unlock_if_generation(
        &self,
        key: Zeroizing<[u8; KEY_BYTES]>,
        auto_lock_seconds: u64,
        expected_generation: u64,
    ) -> bool {
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        lock_if_expired_inner(&mut inner);
        if inner.generation != expected_generation {
            return false;
        }
        let generation = advance_generation(&mut inner);
        inner.lock_event_pending = false;
        inner.session = Some(VaultSession {
            key,
            generation,
            last_activity: Instant::now(),
            timeout: validated_timeout(auto_lock_seconds),
        });
        true
    }

    pub fn key(&self) -> Result<(Zeroizing<[u8; KEY_BYTES]>, u64), &'static str> {
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        lock_if_expired_inner(&mut inner);
        let session = inner.session.as_mut().ok_or("vault_locked")?;
        session.last_activity = Instant::now();
        Ok((session.key.clone(), session.generation))
    }

    pub fn touch(&self, auto_lock_seconds: Option<u64>) -> bool {
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        lock_if_expired_inner(&mut inner);
        let Some(session) = inner.session.as_mut() else {
            return false;
        };
        if let Some(seconds) = auto_lock_seconds {
            session.timeout = validated_timeout(seconds);
        }
        session.last_activity = Instant::now();
        true
    }

    pub fn configure_timeout(&self, auto_lock_seconds: u64) -> bool {
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        lock_if_expired_inner(&mut inner);
        let Some(session) = inner.session.as_mut() else {
            return false;
        };
        session.timeout = validated_timeout(auto_lock_seconds);
        true
    }

    pub fn is_unlocked(&self) -> bool {
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        lock_if_expired_inner(&mut inner);
        inner.session.is_some()
    }

    pub fn lock(&self) -> bool {
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        let was_unlocked = inner.session.take().is_some();
        advance_generation(&mut inner);
        was_unlocked
    }

    pub fn lock_if_expired(&self) -> bool {
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        lock_if_expired_inner(&mut inner)
    }

    pub fn take_pending_lock_event(&self) -> bool {
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        std::mem::take(&mut inner.lock_event_pending)
    }

    pub fn is_current_generation(&self, generation: u64) -> bool {
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        lock_if_expired_inner(&mut inner);
        inner
            .session
            .as_ref()
            .is_some_and(|session| session.generation == generation)
    }

    /// Runs a short synchronous operation while holding the lifecycle lock.
    /// This is used for the final native clipboard write so a concurrent panel
    /// close is ordered strictly before or after the sensitive write.
    pub fn run_if_current_generation<T>(
        &self,
        generation: u64,
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        lock_if_expired_inner(&mut inner);
        if !inner
            .session
            .as_ref()
            .is_some_and(|session| session.generation == generation)
        {
            return Err("vault_locked".to_owned());
        }
        operation()
    }
}

fn validated_timeout(seconds: u64) -> Duration {
    let seconds = match seconds {
        60 | 300 | 900 | 1_800 => seconds,
        _ => DEFAULT_AUTO_LOCK_SECONDS,
    };
    Duration::from_secs(seconds)
}

fn lock_if_expired_inner(inner: &mut VaultStateInner) -> bool {
    let expired = inner
        .session
        .as_ref()
        .is_some_and(|session| session.last_activity.elapsed() >= session.timeout);
    if expired {
        inner.session = None;
        advance_generation(inner);
        inner.lock_event_pending = true;
    }
    expired
}

fn advance_generation(inner: &mut VaultStateInner) -> u64 {
    inner.generation = inner.generation.wrapping_add(1).max(1);
    inner.generation
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lock_releases_the_session_key() {
        let state = VaultState::default();
        let generation = state.generation();
        assert!(state.unlock_if_generation(Zeroizing::new([4_u8; KEY_BYTES]), 300, generation));
        assert!(state.is_unlocked());
        assert!(state.lock());
        assert!(!state.is_unlocked());
        assert_eq!(state.key().unwrap_err(), "vault_locked");
    }

    #[test]
    fn a_lock_invalidates_an_unlock_already_in_flight() {
        let state = VaultState::default();
        let generation = state.generation();
        state.lock();
        assert!(!state.unlock_if_generation(Zeroizing::new([5_u8; KEY_BYTES]), 300, generation,));
        assert!(!state.is_unlocked());
    }

    #[test]
    fn expired_access_records_a_lock_event_for_the_watchdog() {
        let state = VaultState::default();
        let generation = state.generation();
        assert!(state.unlock_if_generation(Zeroizing::new([6_u8; KEY_BYTES]), 60, generation));
        {
            let mut inner = state.inner.lock().unwrap();
            inner.session.as_mut().unwrap().timeout = Duration::ZERO;
        }

        assert_eq!(state.key().unwrap_err(), "vault_locked");
        assert!(state.take_pending_lock_event());
        assert!(!state.take_pending_lock_event());
    }

    #[test]
    fn unsupported_timeout_falls_back_to_five_minutes() {
        assert_eq!(validated_timeout(2), Duration::from_secs(300));
        assert_eq!(validated_timeout(60), Duration::from_secs(60));
        assert_eq!(validated_timeout(1_800), Duration::from_secs(1_800));
    }

    #[test]
    fn mutation_gate_orders_overlapping_lifecycle_operations() {
        tauri::async_runtime::block_on(async {
            use std::sync::{
                atomic::{AtomicBool, Ordering},
                Arc,
            };

            let state = Arc::new(VaultState::default());
            let lifecycle_generation = state.generation();
            assert!(state.unlock_if_generation(
                Zeroizing::new([7_u8; KEY_BYTES]),
                300,
                lifecycle_generation,
            ));
            let (_, session_generation) = state.key().unwrap();
            let first_guard = state.mutation_guard().await;
            let second_entered = Arc::new(AtomicBool::new(false));
            let second_state = state.clone();
            let second_flag = second_entered.clone();
            let (attempting_tx, attempting_rx) = tokio::sync::oneshot::channel();
            let second = tauri::async_runtime::spawn(async move {
                attempting_tx.send(()).unwrap();
                let _second_guard = second_state.mutation_guard().await;
                second_state.lock();
                second_flag.store(true, Ordering::SeqCst);
            });

            attempting_rx.await.unwrap();
            tokio::task::yield_now().await;
            assert!(!second_entered.load(Ordering::SeqCst));
            assert!(state.is_current_generation(session_generation));

            drop(first_guard);
            second.await.unwrap();
            assert!(second_entered.load(Ordering::SeqCst));
            assert!(!state.is_current_generation(session_generation));
        });
    }

    #[test]
    fn auth_waiting_for_the_mutation_gate_cannot_unlock_after_a_lock() {
        tauri::async_runtime::block_on(async {
            use std::sync::Arc;

            let state = Arc::new(VaultState::default());
            let first_guard = state.mutation_guard().await;
            let auth_generation = state.generation();
            let auth_state = state.clone();
            let (attempting_tx, attempting_rx) = tokio::sync::oneshot::channel();
            let auth = tauri::async_runtime::spawn(async move {
                attempting_tx.send(()).unwrap();
                let _auth_guard = auth_state.mutation_guard().await;
                auth_state.unlock_if_generation(
                    Zeroizing::new([8_u8; KEY_BYTES]),
                    300,
                    auth_generation,
                )
            });

            attempting_rx.await.unwrap();
            tokio::task::yield_now().await;
            state.lock();
            drop(first_guard);

            assert!(!auth.await.unwrap());
            assert!(!state.is_unlocked());
        });
    }
}
