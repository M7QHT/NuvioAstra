//! Windows cryptography used by the account (no extra crate):
//! - DPAPI (`CryptProtectData`, current user scope) protects the session file: only this Windows
//!   user on this computer can read it, and a copy of the file is useless elsewhere. Chosen over the
//!   Credential Manager because Supabase access tokens can exceed its 2560-byte blob limit.
//! - SHA-256 (`BCryptHash`) for the offline PIN check, as the original (`ProfilePinCrypto`).
//! - Random bytes (`BCryptGenRandom`) for PIN salts and the sync client id.

use windows::Win32::Foundation::{HLOCAL, LocalFree};
use windows::Win32::Security::Cryptography::{
    BCryptGenRandom, BCryptHash, CryptProtectData, CryptUnprotectData, BCRYPT_SHA256_ALG_HANDLE, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
    CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

const ENTROPY: &[u8] = b"NuvioAstra.Account.v1";

fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
}

/// Encrypts for the current Windows user.
pub fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
    let input = blob(plain);
    let entropy = blob(ENTROPY);
    let mut out = CRYPT_INTEGER_BLOB::default();
    // SAFETY: input/entropy point to live slices for the duration of the call; the output buffer is
    // allocated by DPAPI and released with LocalFree after copying.
    unsafe {
        CryptProtectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out).map_err(|e| e.message())?;
        let bytes = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData as _)));
        Ok(bytes)
    }
}

pub fn unprotect(cipher: &[u8]) -> Result<Vec<u8>, String> {
    let input = blob(cipher);
    let entropy = blob(ENTROPY);
    let mut out = CRYPT_INTEGER_BLOB::default();
    // SAFETY: as in `protect`.
    unsafe {
        CryptUnprotectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out).map_err(|e| e.message())?;
        let bytes = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData as _)));
        Ok(bytes)
    }
}

pub fn sha256_hex(value: &str) -> String {
    let mut out = [0u8; 32];
    // SAFETY: pseudo-handle algorithm, slices valid for the call.
    let status = unsafe { BCryptHash(BCRYPT_SHA256_ALG_HANDLE, None, value.as_bytes(), &mut out) };
    assert!(status.is_ok(), "BCryptHash failed");
    out.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn random_bytes(n: usize) -> Vec<u8> {
    let mut buf = vec![0u8; n];
    // SAFETY: system RNG, buffer valid for the call.
    let status = unsafe { BCryptGenRandom(None, &mut buf, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
    assert!(status.is_ok(), "BCryptGenRandom failed");
    buf
}

/// Lowercase alphanumeric string of `n` characters.
pub fn random_token(n: usize) -> String {
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    random_bytes(n).iter().map(|b| ALPHABET[*b as usize % ALPHABET.len()] as char).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dpapi_round_trip_and_tamper() {
        let secret = br#"{"refresh_token":"abc"}"#;
        let cipher = protect(secret).unwrap();
        assert!(!cipher.windows(3).any(|w| w == b"abc"), "not stored in clear");
        assert_eq!(unprotect(&cipher).unwrap(), secret);
        let mut bad = cipher.clone();
        let last = bad.len() - 1;
        bad[last] ^= 0xff;
        assert!(unprotect(&bad).is_err());
    }

    #[test]
    fn sha256_matches_known_vector_and_original_pin_format() {
        assert_eq!(sha256_hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(random_token(32).len(), 32);
    }
}
