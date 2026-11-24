//! App updates through the official Tauri 2 updater (`tauri-plugin-updater`) with automatic
//! fallback to GitHub Releases (`SHA256SUMS.txt` verified) for fork builds without minisign keys.
//!
//! - Endpoint: `NUVIO_UPDATE_REPOSITORY=owner/repo` (set by the workflow or `local.properties`);
//!   a build without it has updates off and says so.
//! - Build number: `NUVIO_BUILD_NUMBER` (set by GitHub Actions `github.run_number`) allows comparing
//!   tags like `v0.2.0-build.15` against the running build.
//! - Install: starts the NSIS installer (`/P /UPDATE /R`), which installs over the current
//!   installation folder and reopens the app. Data in `%APPDATA%\NuvioNextGen` is never touched.
//! - The player and the P2P session are closed first (watch progress saved).

use crate::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// `owner/repo` of the GitHub repository whose releases this build follows.
pub fn repository() -> Option<&'static str> {
    option_env!("NUVIO_UPDATE_REPOSITORY").map(str::trim).filter(|r| r.contains('/') && !r.contains(' '))
}

pub fn build_number() -> u64 {
    option_env!("NUVIO_BUILD_NUMBER").and_then(|s| s.trim().parse::<u64>().ok()).unwrap_or(0)
}

fn endpoint() -> Option<String> {
    repository().map(|r| format!("https://github.com/{r}/releases/latest/download/latest.json"))
}

fn github_release_api() -> Option<String> {
    repository().map(|r| format!("https://api.github.com/repos/{r}/releases/latest"))
}

#[derive(Clone)]
pub struct GitHubReleaseUpdate {
    pub version: String,
    pub exe_name: String,
    pub exe_url: String,
    pub sha256sums_url: Option<String>,
}

#[derive(Clone)]
enum PendingUpdate {
    Tauri(Update),
    GitHubRelease(GitHubReleaseUpdate),
}

#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<PendingUpdate>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub configured: bool,
    pub current_version: String,
    pub repository: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    /// `downloading`, `verifying`, `installing`, `error`.
    pub phase: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GhRelease {
    tag_name: String,
    body: Option<String>,
    published_at: Option<String>,
    assets: Vec<GhAsset>,
}

#[derive(Debug, Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

/// Parses `(major, minor, patch, build)` from strings like `"0.2.0"`, `"v0.2.0"`, `"v0.2.0-build.15"`.
pub fn parse_version_tuple(raw: &str) -> Option<(u64, u64, u64, u64)> {
    let trimmed = raw.trim().trim_start_matches('v').trim_start_matches('V');
    let (base, build_part) = match trimmed.split_once("-build.") {
        Some((b, n)) => (b, n.split(|c: char| !c.is_ascii_digit()).next().and_then(|d| d.parse::<u64>().ok()).unwrap_or(0)),
        None => (trimmed.split('-').next().unwrap_or(trimmed), 0),
    };
    let mut parts = base.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next()?.parse::<u64>().ok()?;
    let patch = parts.next()?.parse::<u64>().ok()?;
    Some((major, minor, patch, build_part))
}

fn current_version_display(app: &AppHandle) -> String {
    let base = app.package_info().version.to_string();
    let b = build_number();
    if b > 0 {
        format!("{base}-build.{b}")
    } else {
        base
    }
}

fn pt_error(e: tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error as E;
    match e {
        E::Minisign(_) | E::Base64(_) | E::SignatureUtf8(_) => "A assinatura da atualização não confere: a instalação foi cancelada por segurança.".into(),
        E::Network(m) => format!("Sem conexão com o servidor de atualizações ({m})."),
        E::Reqwest(e) => format!("Sem conexão com o servidor de atualizações ({e})."),
        E::ReleaseNotFound => "Nenhuma versão publicada ainda.".into(),
        other => format!("Não foi possível atualizar: {other}"),
    }
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> UpdateStatus {
    UpdateStatus {
        configured: endpoint().is_some(),
        current_version: current_version_display(&app),
        repository: repository().map(str::to_string),
    }
}

/// Asks the release endpoint whether a newer version exists (nothing is downloaded).
/// Tries the official Tauri `latest.json` endpoint first, then falls back to GitHub Releases API.
#[tauri::command]
pub async fn update_check(app: AppHandle, state: State<'_, AppState>) -> Result<Option<UpdateInfo>, String> {
    let url = endpoint().ok_or("Atualizações automáticas não estão configuradas nesta compilação.")?;
    let handle = app.clone();
    let updater = app
        .updater_builder()
        .endpoints(vec![url.parse().map_err(|e| format!("{e}"))?])
        .map_err(pt_error)?
        .timeout(std::time::Duration::from_secs(30))
        .on_before_exit(move || {
            let state = handle.state::<AppState>();
            state.close();
            state.p2p.stop();
        })
        .build()
        .map_err(pt_error)?;

    match updater.check().await {
        Ok(Some(u)) => {
            let info = UpdateInfo {
                version: u.version.clone(),
                current_version: u.current_version.clone(),
                notes: u.body.clone().filter(|b| !b.trim().is_empty()),
                date: u.date.map(|d| d.to_string()),
            };
            *state.updates.pending.lock().expect("update lock") = Some(PendingUpdate::Tauri(u));
            return Ok(Some(info));
        }
        Ok(None) if build_number() == 0 => {
            *state.updates.pending.lock().expect("update lock") = None;
            return Ok(None);
        }
        Ok(None) | Err(_) => {
            // Fall back to GitHub Releases API (supports `vX.Y.Z-build.N` + `SHA256SUMS.txt`).
        }
    }

    let api_url = github_release_api().ok_or("Atualizações automáticas não estão configuradas nesta compilação.")?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Erro de rede: {e}"))?;
    let resp = client
        .get(&api_url)
        .header("User-Agent", "NuvioAstra-Updater")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Sem conexão com o servidor de atualizações ({e})."))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        *state.updates.pending.lock().expect("update lock") = None;
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(format!("Não foi possível verificar atualizações (HTTP {}).", resp.status()));
    }

    let release: GhRelease = resp.json().await.map_err(|e| format!("Resposta inválida do GitHub: {e}"))?;
    let current_ver = current_version_display(&app);
    let current_tuple = parse_version_tuple(&current_ver).unwrap_or((0, 0, 0, 0));
    let remote_tuple = parse_version_tuple(&release.tag_name);

    if remote_tuple.is_none_or(|r| r <= current_tuple) {
        *state.updates.pending.lock().expect("update lock") = None;
        return Ok(None);
    }

    let exe_asset = release
        .assets
        .iter()
        .find(|a| a.name.ends_with("-x64-setup.exe") || a.name.ends_with("-setup.exe"));
    let Some(exe) = exe_asset else {
        *state.updates.pending.lock().expect("update lock") = None;
        return Ok(None);
    };

    let sha_url = release
        .assets
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case("SHA256SUMS.txt"))
        .map(|a| a.browser_download_url.clone());

    let remote_ver = release.tag_name.trim_start_matches('v').to_string();
    let info = UpdateInfo {
        version: remote_ver.clone(),
        current_version: current_ver,
        notes: release.body.filter(|b| !b.trim().is_empty()),
        date: release.published_at,
    };

    *state.updates.pending.lock().expect("update lock") = Some(PendingUpdate::GitHubRelease(GitHubReleaseUpdate {
        version: remote_ver,
        exe_name: exe.name.clone(),
        exe_url: exe.browser_download_url.clone(),
        sha256sums_url: sha_url,
    }));

    Ok(Some(info))
}

/// Downloads the update found by `update_check` (progress in `update-progress` events), verifies
/// its signature/checksum and runs the installer; the app then closes and the installer reopens it.
#[tauri::command]
pub async fn update_install(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let pending = state
        .updates
        .pending
        .lock()
        .expect("update lock")
        .clone()
        .ok_or("Nenhuma atualização pendente: verifique de novo.")?;

    let progress = |phase: &str, downloaded: u64, total: Option<u64>, error: Option<String>| {
        let _ = app.emit("update-progress", UpdateProgress { phase: phase.into(), downloaded, total, error });
    };

    match pending {
        PendingUpdate::Tauri(update) => {
            let mut downloaded = 0u64;
            let mut last_emit = std::time::Instant::now();
            let result = update
                .download(
                    |chunk, total| {
                        downloaded += chunk as u64;
                        if last_emit.elapsed().as_millis() >= 150 || total.is_some_and(|t| downloaded >= t) {
                            last_emit = std::time::Instant::now();
                            progress("downloading", downloaded, total, None);
                        }
                    },
                    || {},
                )
                .await;
            let bytes = match result {
                Ok(b) => b,
                Err(e) => {
                    let text = pt_error(e);
                    progress("error", 0, None, Some(text.clone()));
                    return Err(text);
                }
            };
            progress("verifying", bytes.len() as u64, Some(bytes.len() as u64), None);
            progress("installing", bytes.len() as u64, Some(bytes.len() as u64), None);
            update.install(&bytes).map_err(|e| {
                let text = pt_error(e);
                progress("error", 0, None, Some(text.clone()));
                text
            })
        }
        PendingUpdate::GitHubRelease(rel) => {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(600))
                .build()
                .map_err(|e| format!("Erro de rede: {e}"))?;

            let mut resp = client
                .get(&rel.exe_url)
                .header("User-Agent", "NuvioAstra-Updater")
                .send()
                .await
                .map_err(|e| {
                    let text = format!("Erro ao baixar atualização: {e}");
                    progress("error", 0, None, Some(text.clone()));
                    text
                })?;

            if !resp.status().is_success() {
                let text = format!("Falha ao baixar instalador (HTTP {}).", resp.status());
                progress("error", 0, None, Some(text.clone()));
                return Err(text);
            }

            let total = resp.content_length();
            let mut bytes = Vec::with_capacity(total.unwrap_or(0) as usize);
            let mut last_emit = std::time::Instant::now();
            while let Some(chunk) = resp.chunk().await.map_err(|e| {
                let text = format!("Erro durante o download: {e}");
                progress("error", 0, None, Some(text.clone()));
                text
            })? {
                bytes.extend_from_slice(&chunk);
                if last_emit.elapsed().as_millis() >= 150 || total.is_some_and(|t| bytes.len() as u64 >= t) {
                    last_emit = std::time::Instant::now();
                    progress("downloading", bytes.len() as u64, total, None);
                }
            }

            let len = bytes.len() as u64;
            progress("verifying", len, Some(len), None);

            if let Some(sums_url) = &rel.sha256sums_url {
                let sums_text = client
                    .get(sums_url)
                    .header("User-Agent", "NuvioAstra-Updater")
                    .send()
                    .await
                    .and_then(|r| r.error_for_status())
                    .map_err(|e| format!("Erro ao baixar SHA256SUMS.txt: {e}"))?
                    .text()
                    .await
                    .map_err(|e| format!("Erro ao ler SHA256SUMS.txt: {e}"))?;

                if let Some(expected) = find_sha256_for_asset(&sums_text, &rel.exe_name) {
                    let actual = sha256_hex(&bytes);
                    if actual != expected {
                        let text = "A verificação SHA-256 da atualização falhou: a instalação foi cancelada por segurança.".to_string();
                        progress("error", len, Some(len), Some(text.clone()));
                        return Err(text);
                    }
                }
            }

            let safe_ver: String = rel
                .version
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' })
                .collect();
            let installer_path = std::env::temp_dir().join(format!("Nuvio-Astra-update-{safe_ver}.exe"));
            std::fs::write(&installer_path, &bytes).map_err(|e| {
                let text = format!("Erro ao salvar instalador: {e}");
                progress("error", len, Some(len), Some(text.clone()));
                text
            })?;

            progress("installing", len, Some(len), None);
            state.close();
            state.p2p.stop();

            std::process::Command::new(&installer_path)
                .args(["/P", "/UPDATE", "/R"])
                .spawn()
                .map_err(|e| {
                    let text = format!("Erro ao iniciar o instalador: {e}");
                    progress("error", len, Some(len), Some(text.clone()));
                    text
                })?;

            app.exit(0);
            Ok(())
        }
    }
}

pub fn find_sha256_for_asset(sums_text: &str, asset_name: &str) -> Option<String> {
    sums_text.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?.to_ascii_lowercase();
        let name = parts.next()?.trim_start_matches('*');
        if hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()) && name == asset_name {
            Some(hash)
        } else {
            None
        }
    })
}

/// Minimal FIPS 180-4 SHA-256 implementation (no external crate required).
pub fn sha256_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut padded = data.to_vec();
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[4 * i], chunk[4 * i + 1], chunk[4 * i + 2], chunk[4 * i + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = String::with_capacity(64);
    for word in h {
        use std::fmt::Write;
        let _ = write!(out, "{word:08x}");
    }
    out
}

#[cfg(test)]
mod tests {
    use tauri_plugin_updater::RemoteRelease;

    /// `latest.json` exactly as the release workflow writes it (PowerShell `ConvertTo-Json` spacing,
    /// accents in the notes) is read by the official updater: version, notes, date, URL, signature.
    #[test]
    fn release_manifest_is_understood_by_the_updater() {
        let manifest = r#"{
    "version":  "0.1.1",
    "notes":  "- Primeira versão pública\n- Correção",
    "pub_date":  "2026-11-20T18:48:18Z",
    "platforms":  {
                      "windows-x86_64":  {
                                             "signature":  "c2ln",
                                             "url":  "https://github.com/dono/Nuvio-Astra/releases/download/v0.1.1/Nuvio-Astra-0.1.1-x64-setup.exe"
                                         }
                  }
}"#;
        let r: RemoteRelease = serde_json::from_str(manifest).expect("manifest parsed");
        assert_eq!(r.version.to_string(), "0.1.1");
        assert!(r.notes.as_deref().unwrap().contains("versão pública"));
        assert!(r.pub_date.is_some());
        assert!(r.download_url("windows-x86_64").unwrap().as_str().ends_with("/v0.1.1/Nuvio-Astra-0.1.1-x64-setup.exe"));
        assert_eq!(r.signature("windows-x86_64").unwrap(), "c2ln");
    }

    #[test]
    fn repository_and_endpoint() {
        // Built without NUVIO_UPDATE_REPOSITORY in tests: updates off, nothing contacted.
        if super::repository().is_none() {
            assert!(super::endpoint().is_none());
        } else {
            assert!(super::endpoint().unwrap().ends_with("/releases/latest/download/latest.json"));
        }
    }

    #[test]
    fn parses_version_and_build_tuples() {
        assert_eq!(super::parse_version_tuple("0.2.0"), Some((0, 2, 0, 0)));
        assert_eq!(super::parse_version_tuple("v0.2.0-build.15"), Some((0, 2, 0, 15)));
        assert!(super::parse_version_tuple("v0.2.0-build.16") > super::parse_version_tuple("0.2.0-build.15"));
        assert!(super::parse_version_tuple("v0.2.1-build.1") > super::parse_version_tuple("v0.2.0-build.99"));
    }

    #[test]
    fn sha256_and_checksum_lookup() {
        assert_eq!(
            super::sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let sums = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  Nuvio-Astra-0.2.0-x64-setup.exe\n";
        assert_eq!(
            super::find_sha256_for_asset(sums, "Nuvio-Astra-0.2.0-x64-setup.exe").as_deref(),
            Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        );
    }
}
