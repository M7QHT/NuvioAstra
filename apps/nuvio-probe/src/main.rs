//! `nuvio-probe` — checks the Nuvio Astra core against the real data of the current install.
//!
//! Read-only: it reads the legacy `.properties` stores, then loads every enabled addon's manifest
//! and the first page of one catalog per addon through `nuvio-core`, measuring each request.
//! Addon URLs are never printed (they can embed account tokens); addons are shown by name.
//!
//! Usage:
//!   nuvio-probe [--data-dir <dir>] [--profile <index>] [--backup <dir>]

use nuvio_core::client::AddonClient;
use nuvio_core::manifest::AddonManifest;
use nuvio_store::{default_legacy_data_dir, LegacyStore};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Semaphore;

/// Same bound as a reasonable per-app limit: avoids hammering addon hosts.
const MAX_CONCURRENT_REQUESTS: usize = 8;

struct Args {
    data_dir: Option<PathBuf>,
    profile: Option<i64>,
    backup: Option<PathBuf>,
}

fn parse_args() -> Result<Args, String> {
    let mut args = Args { data_dir: None, profile: None, backup: None };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        let mut value = || it.next().ok_or_else(|| format!("missing value for {arg}"));
        match arg.as_str() {
            "--data-dir" => args.data_dir = Some(PathBuf::from(value()?)),
            "--profile" => args.profile = Some(value()?.parse().map_err(|_| "profile must be a number")?),
            "--backup" => args.backup = Some(PathBuf::from(value()?)),
            "-h" | "--help" => {
                println!("nuvio-probe [--data-dir <dir>] [--profile <index>] [--backup <dir>]");
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument {other}")),
        }
    }
    Ok(args)
}

struct AddonResult {
    position: usize,
    name: String,
    version: String,
    catalogs: usize,
    manifest_ms: u128,
    catalog: Option<(String, u128, Result<usize, String>)>,
    error: Option<String>,
}

#[tokio::main]
async fn main() {
    if let Err(message) = run().await {
        eprintln!("error: {message}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let args = parse_args()?;
    let dir = match args.data_dir {
        Some(dir) => dir,
        None => default_legacy_data_dir().map_err(|e| e.to_string())?,
    };
    let store = LegacyStore::open(&dir).map_err(|e| e.to_string())?;
    let started = Instant::now();

    println!("Legacy data: {} stores (read-only)", store.store_names().map_err(|e| e.to_string())?.len());

    if let Some(backup_root) = args.backup {
        let label = format!("legacy-backup-{}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0));
        let report = store.backup_to(&backup_root, &label).map_err(|e| e.to_string())?;
        let total: u64 = report.files.iter().map(|f| f.bytes).sum();
        println!("Backup verified: {} files, {} bytes -> {}", report.files.len(), total, report.dir.display());
    }

    let profiles = store.profiles().map_err(|e| e.to_string())?;
    let (profile, addon_profile) = match &profiles {
        Some(p) => {
            let index = args.profile.unwrap_or(p.active_profile_index);
            println!("Profiles: {} (active {}), probing profile {}", p.profiles.len(), p.active_profile_index, index);
            (index, LegacyStore::effective_addon_profile(p, index))
        }
        None => {
            let index = args.profile.unwrap_or(1);
            println!("Profiles: none stored, probing profile {index}");
            (index, index)
        }
    };
    if addon_profile != profile {
        println!("Profile {profile} uses the primary profile's addons");
    }

    let addons = store.installed_addons(addon_profile).map_err(|e| e.to_string())?;
    let enabled: Vec<_> = addons.iter().enumerate().filter(|(_, a)| a.enabled).collect();
    println!("Addons: {} installed, {} enabled\n", addons.len(), enabled.len());

    let client = AddonClient::new().map_err(|e| e.to_string())?;
    let limit = Arc::new(Semaphore::new(MAX_CONCURRENT_REQUESTS));
    let network_start = Instant::now();

    let mut tasks = tokio::task::JoinSet::new();
    for (position, addon) in enabled {
        let client = client.clone();
        let limit = limit.clone();
        let url = addon.manifest_url.clone();
        tasks.spawn(async move {
            let t = Instant::now();
            let manifest = {
                let _permit = limit.acquire().await.expect("semaphore closed");
                client.fetch_manifest(&url).await
            };
            let manifest_ms = t.elapsed().as_millis();
            match manifest {
                Err(error) => AddonResult {
                    position, name: format!("addon #{}", position + 1), version: String::new(), catalogs: 0,
                    manifest_ms, catalog: None, error: Some(error.to_string()),
                },
                Ok(manifest) => {
                    let catalog = probe_first_catalog(&client, &limit, &manifest).await;
                    AddonResult {
                        position, name: manifest.name.clone(), version: manifest.version.clone(),
                        catalogs: manifest.catalogs.len(), manifest_ms, catalog, error: None,
                    }
                }
            }
        });
    }

    let mut results = Vec::new();
    while let Some(result) = tasks.join_next().await {
        results.push(result.map_err(|e| e.to_string())?);
    }
    results.sort_by_key(|r| r.position);
    let network_ms = network_start.elapsed().as_millis();

    println!("{:<3} {:<32} {:>9} {:>8} {:>10}  {}", "#", "addon", "version", "catalogs", "manifest", "first catalog page");
    let mut manifests_ok = 0;
    let mut items_total = 0;
    for r in &results {
        let catalog = match &r.catalog {
            None if r.error.is_some() => format!("manifest failed: {}", r.error.as_deref().unwrap_or_default()),
            None => "no listable catalog".to_string(),
            Some((name, ms, Ok(items))) => {
                items_total += items;
                format!("{} — {} items in {} ms", truncate(name, 28), items, ms)
            }
            Some((name, ms, Err(e))) => format!("{} — failed after {} ms: {}", truncate(name, 28), ms, e),
        };
        if r.error.is_none() {
            manifests_ok += 1;
        }
        println!("{:<3} {:<32} {:>9} {:>8} {:>8} ms  {}", r.position + 1, truncate(&r.name, 32), r.version, r.catalogs, r.manifest_ms, catalog);
    }
    println!(
        "\nManifests OK: {}/{} · catalog items loaded: {} · network phase: {} ms · total: {} ms",
        manifests_ok, results.len(), items_total, network_ms, started.elapsed().as_millis()
    );
    Ok(())
}

/// First catalog that can be listed without user input (no required extra besides `skip`).
async fn probe_first_catalog(
    client: &AddonClient,
    limit: &Semaphore,
    manifest: &AddonManifest,
) -> Option<(String, u128, Result<usize, String>)> {
    let catalog = manifest
        .catalogs
        .iter()
        .find(|c| !c.extra.iter().any(|e| e.is_required && !e.name.eq_ignore_ascii_case("skip")))?;
    let _permit = limit.acquire().await.ok()?;
    let t = Instant::now();
    let page = client.fetch_catalog_page(manifest, &catalog.content_type, &catalog.id, None, None).await;
    Some((
        format!("{} ({})", catalog.name, catalog.content_type),
        t.elapsed().as_millis(),
        page.map(|p| p.items.len()).map_err(|e| e.to_string()),
    ))
}

fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        value.to_string()
    } else {
        value.chars().take(max.saturating_sub(1)).collect::<String>() + "…"
    }
}
