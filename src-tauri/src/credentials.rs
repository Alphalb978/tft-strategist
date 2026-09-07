use secrecy::{ExposeSecret, SecretString};

pub trait CredentialStore: Send + Sync {
    fn load(&self) -> Result<Option<SecretString>, &'static str>;
    fn save(&self, key: &SecretString) -> Result<(), &'static str>;
    fn remove(&self) -> Result<(), &'static str>;
}
pub struct WindowsCredentialStore {
    target: String,
}
impl Default for WindowsCredentialStore {
    fn default() -> Self {
        Self {
            target: TARGET.into(),
        }
    }
}
const TARGET: &str = "TFTStrategist/RiotApiKey";
const ERROR: &str = "Windows credential storage unavailable";

#[cfg(windows)]
impl CredentialStore for WindowsCredentialStore {
    fn load(&self) -> Result<Option<SecretString>, &'static str> {
        use windows_sys::Win32::{
            Foundation::{GetLastError, ERROR_NOT_FOUND},
            Security::Credentials::*,
        };
        let target: Vec<u16> = self.target.encode_utf16().chain(Some(0)).collect();
        let mut credential = std::ptr::null_mut();
        // Windows owns the returned allocation; copy only the secret, wipe the blob, then free it.
        unsafe {
            if CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) == 0 {
                return if GetLastError() == ERROR_NOT_FOUND {
                    Ok(None)
                } else {
                    Err(ERROR)
                };
            }
            let size = (*credential).CredentialBlobSize as usize;
            let result = if size == 0 || size > 512 || (*credential).CredentialBlob.is_null() {
                Err(ERROR)
            } else {
                let bytes = std::slice::from_raw_parts_mut((*credential).CredentialBlob, size);
                let value = std::str::from_utf8(bytes)
                    .map(|s| Some(SecretString::from(s)))
                    .map_err(|_| ERROR);
                for byte in bytes {
                    std::ptr::write_volatile(byte, 0);
                }
                value
            };
            CredFree(credential.cast());
            result
        }
    }
    fn save(&self, key: &SecretString) -> Result<(), &'static str> {
        use windows_sys::Win32::Security::Credentials::*;
        let mut target: Vec<u16> = self.target.encode_utf16().chain(Some(0)).collect();
        let bytes = key.expose_secret().as_bytes();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            CredentialBlobSize: bytes.len() as u32,
            CredentialBlob: bytes.as_ptr() as *mut u8,
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        // Generic credentials are stored by Windows for this user; no app JSON/SQLite secret copy.
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            Err(ERROR)
        } else {
            Ok(())
        }
    }
    fn remove(&self) -> Result<(), &'static str> {
        use windows_sys::Win32::{
            Foundation::{GetLastError, ERROR_NOT_FOUND},
            Security::Credentials::*,
        };
        let target: Vec<u16> = self.target.encode_utf16().chain(Some(0)).collect();
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } != 0
            || unsafe { GetLastError() } == ERROR_NOT_FOUND
        {
            Ok(())
        } else {
            Err(ERROR)
        }
    }
}
#[cfg(not(windows))]
impl CredentialStore for WindowsCredentialStore {
    fn load(&self) -> Result<Option<SecretString>, &'static str> {
        Err(ERROR)
    }
    fn save(&self, _: &SecretString) -> Result<(), &'static str> {
        Err(ERROR)
    }
    fn remove(&self) -> Result<(), &'static str> {
        Err(ERROR)
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn windows_vault_roundtrip_with_isolated_fixture() {
        let vault = WindowsCredentialStore {
            target: format!(
                "TFTStrategist/TestOnly/{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ),
        };
        assert!(vault.load().unwrap().is_none());
        vault
            .save(&SecretString::from("RGAPI-dummy-fixture-only"))
            .unwrap();
        let loaded = vault.load();
        // Always remove the isolated fixture before asserting its contents.
        vault.remove().unwrap();
        assert_eq!(
            loaded.unwrap().unwrap().expose_secret(),
            "RGAPI-dummy-fixture-only"
        );
        assert!(vault.load().unwrap().is_none());
    }
}
