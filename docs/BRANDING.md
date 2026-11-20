# Nuvio Astra — identity and technical names

Official name: **Nuvio Astra** (exactly this spelling). Official artwork:
`packaging/branding/nuvio-astra.png` (500×500, transparent), used as is; every icon is a high-quality
downscale of it (`packaging/branding/make_icons.py`): no crop, padding, redraw or effect.

## Where the identity appears

| Place | Value |
|---|---|
| Window title, taskbar | `Nuvio Astra` (`main.rs`) + window icon from `icons/icon.ico` |
| Executable metadata | ProductName / FileDescription / CompanyName `Nuvio Astra` (`tauri.conf.json` `productName`, `bundle.publisher`), version 0.1.0 |
| Executable icon | `icons/icon.ico` (16, 20, 24, 32, 40, 48, 64, 96, 128, 256 px) embedded by `tauri-build` |
| Distributed executable | `Nuvio Astra.exe` (portable folder and installer) |
| Installer | `Nuvio-Astra-<version>-x64-setup.exe`: name, icon, version info, Start menu / desktop shortcuts `Nuvio Astra`, *Apps & features* entry `Nuvio Astra` (`packaging/windows/nuvio-astra.nsi`) |
| UI | sidebar logo + name, page title and favicon, Settings → Perfil e dados (logo, name, version), picture-in-picture window title |
| Docs | `README.md`, this file |

Functional icons (Início, TV, Buscar, Biblioteca, Configurações, play, favorites…) and logos of
addons, channels, movies and series are unchanged.

## Names kept on purpose (technical or historical)

| Name | Where | Why it stays |
|---|---|---|
| `%APPDATA%\NuvioNextGen` | `nuvio-store::nextgen::default_app_dir` | the real data folder (profiles, addons, settings, library, progress, migration, backups). Renaming it would make the app start empty or require a migration. Independent of `productName`. |
| `%LOCALAPPDATA%\NuvioNextGen\Cache` | `nuvio-player` (shader cache) | cache path of the player crate; changing it only discards the cache, not worth touching the player |
| `tv.nuvio.nextgen` | `tauri.conf.json` `identifier` | Tauri/WebView2 data folder of the webview (`%LOCALAPPDATA%\tv.nuvio.nextgen`) and Windows app identity; changing it gives a new webview profile. Not shown to the user. |
| `NuvioNextGen/<version>` | HTTP User-Agent (`nuvio-core::client`) | identification sent to addon servers; kept stable (protocol behavior) |
| `NuvioNextGenVideoContainer`, `NuvioNextGenPictureInPicture` | window classes in `nuvio-player/src/win.rs` | internal, invisible; `win.rs` holds the rendering fix and is not modified |
| `nuvio_store::nextgen` module, `nextgen/` folder, `nuvio-desktop` crate/binary | code | internal names; the distributed file is named `Nuvio Astra.exe` by packaging |
| `[nextgen]` log prefix | stderr diagnostics | developer logs, not UI |
| "NextGen"/"Next-Gen" in `COMPARISON.md`, `AUDIT.md`, `PLAYER_*.md`, `RENDER_FIX.md`, `ARCHITECTURE_DECISION.md`, bench data | history | records of what was built and measured under the development name |
| "Nuvio" / "Nuvio original" / "Nuvio Desktop" | UI texts about the original app's data, account and compatibility, docs | the original product this fork comes from and migrates from |
| `apps/nuvio-desktop/ui/` | early player test page | not shipped (the app uses `web/dist`) |
