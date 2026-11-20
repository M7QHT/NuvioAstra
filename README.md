# Nuvio Astra

<img src="packaging/branding/nuvio-astra.png" width="96" alt="Nuvio Astra" />

**Nuvio Astra** is a Windows x64 desktop app for the Stremio addon ecosystem: Home catalogs, search,
details with YouTube trailers, live TV, library (favorites, history, Continue watching), addon and profile
management, Nuvio account sync, torrent (P2P) sources and an embedded libmpv player. Built with Rust + Tauri 2 + React + TypeScript.

It is a fork of **Nuvio Desktop** (the Kotlin app in the repository root, untouched, kept as the
reference implementation): it reads the original's data once (migration with verified backups) and
works with the same addons. The development folder keeps its technical name, `nextgen/`.

- Architecture decision: [`ARCHITECTURE_DECISION.md`](ARCHITECTURE_DECISION.md)
- Identity and technical names: [`docs/BRANDING.md`](docs/BRANDING.md)
- Feature parity with Nuvio Desktop: [`docs/FEATURE_PARITY.md`](docs/FEATURE_PARITY.md)
- Changes: [`docs/CHANGELOG.md`](docs/CHANGELOG.md) · Publishing and updates: [`GITHUB_PUBLISH.md`](GITHUB_PUBLISH.md) · Testing policy: [`docs/TESTING_POLICY.md`](docs/TESTING_POLICY.md)
- Audit and baseline: [`docs/AUDIT.md`](docs/AUDIT.md) · Comparison: [`docs/COMPARISON.md`](docs/COMPARISON.md)
- Player: [`docs/PLAYER_SPIKE.md`](docs/PLAYER_SPIKE.md), [`docs/PLAYER_PORT.md`](docs/PLAYER_PORT.md), [`docs/RENDER_FIX.md`](docs/RENDER_FIX.md)

## Download

Get **`Nuvio-Astra-<version>-x64-setup.exe`** from the [latest release](../../releases/latest)
(Windows 10/11 x64). After that, new versions arrive inside the app: a notice at the top shows the
version and what changed, with **Atualizar agora** / **Depois** (also *Configurações → Atualizações*).
Every update is verified by its signature before it is installed; profiles, addons, settings,
library and the account session are kept. Checksums: `SHA256SUMS.txt` in each release.

The installer and the executable are not code-signed yet, so Windows SmartScreen may ask for
confirmation on the first run (*Mais informações → Executar assim mesmo*).

Maintainers: how releases are built and published — [`GITHUB_PUBLISH.md`](GITHUB_PUBLISH.md).

## Install (Windows x64)

Run `Nuvio-Astra-<version>-x64-setup.exe`. It installs for the current user (no administrator rights)
into `%LOCALAPPDATA%\Programs\Nuvio Astra`, adds **Nuvio Astra** to the Start menu and the desktop, and
registers an uninstaller in *Apps & features*. A portable copy is also produced
(`dist\Nuvio Astra\Nuvio Astra.exe`, next to `libmpv-2.dll` and `nuvio_engine.dll`).

Files installed: `Nuvio Astra.exe`, `libmpv-2.dll` (player), `nuvio_engine.dll` (P2P engine of the
original app, libtorrent; it needs only Windows system DLLs and the Universal CRT of Windows 10/11),
the icon and the uninstaller. The app looks for both DLLs next to its executable.

User data lives in `%APPDATA%\NuvioNextGen` (profiles, addons, settings, library, progress, migration
records, backups, the encrypted account session). The folder keeps its technical name so existing data
is used as is; installing, updating or uninstalling never touches it. The torrent piece cache lives in
`%LOCALAPPDATA%\NuvioNextGen\p2p-cache` (size and "Limpar cache" in Settings → Torrent / P2P).

## Layout

| Path | Purpose |
|---|---|
| `crates/nuvio-core` | Stremio addon protocol (URLs, manifests, catalogs, streams) and HTTP client — UI-free |
| `crates/nuvio-store` | App data (profiles, addons, settings, library) and the migration from Nuvio Desktop |
| `crates/nuvio-player` | Embedded libmpv player (Windows), runtime-loaded `libmpv-2.dll` |
| `crates/nuvio-p2p` | Torrent streaming with the original's `nuvio_engine.dll` (runtime-loaded C ABI) |
| `crates/nuvio-sync` | Nuvio account (auth, DPAPI session) and cloud sync |
| `apps/nuvio-desktop` | The Nuvio Astra app: Tauri 2 shell (Rust) + React UI (`web/`) |
| `apps/nuvio-probe` | CLI validating the core against the real install (read-only) |
| `packaging/` | Official artwork, icon generation, Windows installer |
| `tools/migration-audit` | Read-only audit / simulation of the real data folder |
| `bench/` | Reproducible measurements |

## Build

```powershell
cargo test --workspace
# Release: frontend + Rust build, portable folder and installer in dist\ (libmpv-2.dll from -LibMpv,
# NUVIO_LIBMPV or the release folder; nuvio_engine.dll from -Engine, NUVIO_ENGINE_DLL, the release
# folder or the original app's copy in composeApp\src\desktopMain\native\windows\engine, checked for
# x64, the C API and system-only dependencies; makensis from NSIS_HOME or the NSIS kept by the Tauri
# bundler). In Windows PowerShell 5.1, build with cargo first and pass -SkipBuild (cargo's progress on
# stderr stops the script there).
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\windows\build-release.ps1 -LibMpv C:\path\to\libmpv-2.dll
# Icons (only when the artwork changes): regenerates icons\*.ico/*.png and the web icons.
python packaging\branding\make_icons.py .
```

The Cargo binary is `nuvio-desktop.exe` (internal name); the packaging step names the distributed
executable `Nuvio Astra.exe`. Developer tools: `nuvio-desktop.exe --selftest <report.json>` (player
self-test), `--uitest <report.json> [phase]` (automated UI test on a copy of the data; phases include `p2p`,
`trailer` and `install-check`, the last one run from the installed folder),
`cargo run --release -p nuvio-probe -- --profile 1`.

`nuvio-probe --backup <dir>` copies the original's stores to `<dir>` and verifies the copy. Those files
contain account tokens: keep backups in a private folder, never inside the repository.
