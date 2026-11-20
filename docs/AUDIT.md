# Nuvio Desktop — Technical Audit (Phase 1)

Audit of the repository at `NuvioDesktop-Dev` (desktop version 0.1.38-alpha, `composeApp/Configuration/DesktopVersion.properties`).

> The folder is **not a git repository** (it was downloaded as an archive), so git history could
> not be inspected. Everything below comes from the files themselves.

## 1. Technology stack (verified in the files)

| Area | Technology | Evidence |
|---|---|---|
| Main language | Kotlin 2.4.10 (Kotlin Multiplatform) | `gradle/libs.versions.toml`, `composeApp/build.gradle.kts` |
| Targets sharing the code | Desktop (JVM), Android, iOS | source sets `commonMain`, `desktopMain`, `androidMain`, `iosMain` |
| UI | Compose Multiplatform 1.13.0-beta01 (Skia/Skiko on desktop), Material 3 | `libs.versions.toml` |
| Desktop runtime | JVM (JDK 17 bundled by jpackage), Swing/AWT host window | `Main.kt`, `createReleaseDistributable` output |
| Navigation | Navigation 3 (`org.jetbrains.androidx.navigation3`) + custom `RootTabHost` | `navigation/`, `RootTabHost.kt` |
| State | Kotlin coroutines + `StateFlow` held by `object` repositories (singletons) | e.g. `AddonRepository`, `StreamsRepository` |
| HTTP | Ktor 3.4.1 (OkHttp engine on desktop) + raw OkHttp for addons | `AddonPlatform.desktop.kt` |
| JSON | kotlinx.serialization 1.10 | parsers in `features/*` |
| Images | Coil 3.6.3 (+ GIF/SVG/animated decoders) | `libs.versions.toml`, `core/ui/AsyncImage*` |
| Backend / accounts | Supabase (auth, postgrest, storage, realtime, functions) via `supabase-kt` 3.4.1 | `core/network/SupabaseProvider.kt` |
| Plugin runtime | QuickJS through `quickjs-kt` 1.0.15, with host bridges (DOM via ksoup, crypto, fetch) | `features/plugins`, `fullCommonMain/.../plugins/runtime` |
| Video player (Windows) | **libmpv** loaded dynamically (`libmpv-2.dll`) by a C++ JNI bridge, video in a native child window, controls drawn by **WebView2** (HTML/JS) | `native/windows/player_bridge.cpp` (3,068 lines), `resources/player-ui/*.js` (≈5.4k lines) |
| Video player (macOS / Linux) | libmpv (bundled dylib / system libmpv, X11 `wid`) | `build.gradle.kts` player bridge tasks |
| P2P / torrent | `nuvio_engine` native library — **C++ libtorrent 2.0.12** (strings in the DLL), not Rust | `native/windows/engine/nuvio_engine.dll` |
| Persistence | One Java `.properties` file per store in `%APPDATA%\Nuvio`, values mostly JSON, keys suffixed by profile id | `core/storage/DesktopStorage.kt` |
| Disk cache | `%LOCALAPPDATA%\Nuvio\Cache` (3.3 GB on this machine) | measured |
| Diagnostics | Sentry (JVM) | `desktopSentry/` |
| Build | Gradle 9.4.1, Compose Desktop packaging (MSI/DMG/DEB/RPM/AppImage), MSVC + WebView2 SDK for the bridge | `build.gradle.kts`, `.github/workflows/desktop-release.yml` |

## 2. Size

| Source set | Kotlin files | Lines |
|---|---:|---:|
| commonMain (shared by all platforms) | 862 | 192,652 |
| desktopMain | 162 | 14,982 |
| fullCommonMain (plugins/P2P builds) | 17 | 4,261 |
| androidMain / iosMain | 167 / 115 | 19,749 / 8,009 |
| Tests (common / desktop / Android host) | 263 / 28 / 76 | 37,106 / 3,982 / 11,368 |

Plus C++ (player bridge), Objective-C++ (macOS), and ≈6k lines of HTML/JS player controls.

## 3. Feature inventory (by module, shared lines / desktop-specific lines)

| Module | Lines | What it does |
|---|---:|---|
| player | 26,836 / 5,477 | Player screen, controls, tracks, subtitles (styling, SDH filter, cues), chapters, skip intro/outro, next episode, source fallback, PiP, audio delay/amplification, external player |
| settings | 23,906 / 535 | All settings pages, layout, themes, navigation layout, playback, integrations |
| details | 14,182 | Movie/series details, seasons and episodes, cast, comments, trailers |
| autosync | 9,047 / 225 | Subtitle auto-sync (cue parsing, alignment, mpv integration) |
| home | 8,636 / 377 | Home catalogs, hero, continue watching, catalog settings |
| servers | 7,285 | Plex / Emby / Jellyfin / Silo media servers |
| collection | 7,006 | Collections and folders |
| trakt / simkl / mdblist | 6,980 / 5,474 / 4,677 | External tracking, sync, ratings, lists |
| streams | 6,255 | Stream search sessions, autoplay policy, badges, link cache, debrid presentation |
| library / watched / watchprogress / watching | 4,873 / 2,143 / 3,870 / 2,124 | Library, watched state, progress, resume |
| party | 4,712 | Watch party (realtime) |
| profiles / auth / membership | 4,661 / 1,953 / 733 | Profiles, avatars, PIN, account, supporter assets |
| debrid | 4,510 | Real-Debrid / Premiumize / TorBox resolution and cache checks |
| tmdb | 2,768 | TMDB enrichment |
| downloads | 2,130 / 331 | Offline downloads |
| addons / catalog / search | 1,884 / 1,124 / 1,708 | Stremio addon protocol, catalogs, search and discover |
| plugins | 284 / 3,777 | QuickJS scraper plugins (repositories, host API) |
| p2p | 441 / 762 | Torrent streaming through `nuvio_engine` |
| trailer | 459 / 1,101 | Trailer playback (YouTube resolution) |
| updater | 1,160 / 371 | GitHub release updater (**disabled in this custom build**) |
| livetv | 2,185 / 16 | TV tab added in this workspace |
| others | — | cloud library, notifications, shuffle, tracking consent |

## 4. Architecture observations

- **Startup**: `AppGate` restores the Supabase session (`AuthRepository.initialize`), loads cached profiles, then pulls profiles; the home screen renders after the gate. Without backend configuration this path slowed the app down (fixed earlier by providing the official public backend settings).
- **State**: global `object` repositories exposing `StateFlow`; screens collect them. Simple and fast, but everything lives for the whole process and is shared by all screens.
- **Tabs**: `RootTabHost` keeps every visited tab composed (unplaced) to keep state — fast tab switches, higher memory.
- **Networking**: addon calls go through OkHttp with 60 s timeouts and in-flight de-duplication for catalogs; streams use `StreamSearchSessions` (shared, 15 min TTL in memory).
- **Persistence**: whole `.properties` files rewritten on each change (`persist()`); large stores exist (`nuvio_collections` 465 KB, `nuvio_watch_progress` 179 KB).
- **Player**: already native (libmpv). The JVM only drives it through JNI; video decoding never runs on the JVM.
- **Plugins**: QuickJS with a custom host API (DOM, crypto, fetch). This API is a compatibility contract for third-party plugins.

## 5. Performance baseline (measured)

Machine: Windows 11 Pro 26200, 12 logical cores. Script: `nextgen/bench/measure-startup.ps1` (raw data: `nextgen/bench/baseline-windows.csv`). Each app opened twice; idle sampled for 45 s after a 15 s settle, across the whole process tree.

| Build | Window shown | Working set | Private bytes | Idle CPU (all cores) |
|---|---:|---:|---:|---:|
| Official 0.1.38 — run 1 | 2.58 s | 525 MB | 723 MB | 0.68 % |
| Official 0.1.38 — run 2 | 2.67 s | 495 MB | 690 MB | 0.85 % |
| Local build (with TV tab) — run 1 | 5.43 s | 698 MB | 720 MB | 1.45 % |
| Local build (with TV tab) — run 2 | 2.80 s | 701 MB | 736 MB | 0.74 % |

Notes and limits:
- "Window shown" = Windows reports a main window for the process tree (≈250 ms polling resolution). It is **not** "home finished loading".
- OS file cache cannot be flushed without admin rights: run 1 is "first launch of the session", not a true cold boot. The local build's 5.4 s first run followed a fresh rebuild (new JAR, no class-data cache yet).
- Not measured yet (need an interactive or scripted UI session): page open times, catalog load times, RAM during navigation and playback, long-session stability. Planned method: same script plus UI automation, and JFR/heap histograms for the JVM app.

### Diagnosis

- **Idle CPU is already low** (< 1 %). CPU is not the problem at rest.
- **Memory is the main cost**: ≈500–700 MB working set at idle on the home screen. The JVM heap, Skia/Compose and in-memory image caches account for this floor; decoding is native and is not included at idle.
- **Startup to window ≈2.6 s** for the official build: JVM start + class loading + Compose first frame.
- The slow start the user saw earlier was caused by **missing backend configuration**, not by the language.

## 6. Hard-to-migrate dependencies

| Dependency | Why it is hard | Rust-side option (to verify per phase) |
|---|---|---|
| Plugin runtime (QuickJS + host API) | Third-party plugins depend on its exact API and DOM behavior | `rquickjs` + `scraper`/`html5ever` for the DOM bridge; contract tests against real plugins |
| Supabase (auth, postgrest, realtime, storage) | No official Rust SDK; realtime powers watch party and sync | Plain REST/WebSocket clients (`reqwest`, `tokio-tungstenite`) against the same endpoints |
| Player on three OSes | Native window embedding differs per OS; HTML controls tied to the C++ bridge | Load libmpv dynamically (`libloading`), embed with `wid` under a transparent webview; reuse `player-ui` HTML/JS |
| libtorrent engine | C++ library with Kotlin bindings | Keep the same native library behind a small C ABI |
| Integrations (Trakt, Simkl, MDBList, TMDB, debrid, media servers) | ≈30k lines of API logic and sync rules | Port module by module with contract tests on recorded responses |
| Shared code with Android/iOS | A desktop-only rewrite stops sharing ≈190k lines | Keep the Rust core UI-free so it can later be shared through UniFFI |
