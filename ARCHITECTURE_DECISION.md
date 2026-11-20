# Architecture Decision — Nuvio Desktop Next-Gen

Status: **accepted for the next-gen track** · Date: 2026-11-19 · Inputs: [`docs/AUDIT.md`](docs/AUDIT.md), [`docs/PLAYER_SPIKE.md`](docs/PLAYER_SPIKE.md)

> **Scope (decided 2026-11-19): Windows desktop x64 only.** No Android, iOS, macOS or Linux builds,
> toolchains or abstractions. Windows-native APIs (WebView2, Win32 windows, D3D11 decoding) are used
> directly where they bring real benefits. Cross-platform notes below are kept only as history.

## 1. Current technology

Kotlin Multiplatform 2.4 + Compose Multiplatform 1.13 running on a bundled JVM (JDK 17) with Skia
rendering. About 193k lines of Kotlin are shared with Android and iOS. Heavy media work is
**already native**: video is decoded by libmpv (loaded by a C++ bridge, controls drawn by a WebView2
HTML/JS layer on Windows), and P2P streaming uses a C++ libtorrent engine. Data lives in Java
`.properties` files holding JSON values, scoped by profile id.

## 2. Problems found (measured, see AUDIT §5)

| Indicator | Official 0.1.38 (Windows) |
|---|---|
| Window shown | 2.58–2.67 s |
| Idle working set | 495–525 MB |
| Idle private bytes | 690–723 MB |
| Idle CPU (all cores) | 0.68–0.85 % |

- **Memory** is the clear weak point: a large fixed floor from the JVM, Skia/Compose and in-heap caches.
- **Startup** is acceptable but bounded by JVM start and class loading.
- **CPU at rest** is not a problem. Video decoding is not on the JVM.
- The slow start reported earlier was a **configuration** issue (missing backend settings), not a language issue.

So a rewrite can realistically improve **RAM floor, startup time and package size**. It will not
make video decoding faster (libmpv stays), and it does not fix problems that are not there (idle CPU).

## 3. Alternatives evaluated

Ratings are qualitative. Numbers are only stated where they were measured.

| Criterion | A. Rust core + Tauri 2 + React/TS | B. Rust + native UI (Slint / iced / egui) | C. Keep Kotlin, move hot spots to Rust | D. Tune the current JVM app |
|---|---|---|---|---|
| RAM floor | Low core; WebView2 adds its own processes (Windows ships it) | Lowest | Unchanged (JVM still loaded) | Some reduction (heap limits, cache sizes) |
| Startup | Fast (no JVM) | Fastest | Unchanged | Small gain (class-data sharing) |
| Rich media UI (posters, blur, animations, long lists) | Very good (web platform, virtualization) | Slint good but young for this scope; iced/egui weak for a polished media UI | Very good (current) | Very good (current) |
| Video embedding | Native child window under transparent webview, the same model as today's WebView2 controls | Render through libmpv render API into the toolkit's GL surface; per-toolkit work | Current, proven | Current, proven |
| Reuse of existing code | Player HTML/JS controls (≈5.4k lines) reusable; protocol logic ported | Nothing from the UI reusable | Everything | Everything |
| Windows / macOS / Linux | WebView2 / WKWebView / WebKitGTK; all supported by Tauri 2 | Supported | Supported | Supported |
| Plugins (QuickJS) | `rquickjs` (0.14, maintained) | Same | Current | Current |
| Supabase | No official Rust SDK; REST/WebSocket by hand | Same | Current SDK | Current SDK |
| Android/iOS sharing | Lost for desktop UI; core shareable via UniFFI later | Same | Kept | Kept |
| Migration effort / risk | High (~210k lines to reach parity) | Highest (UI rebuilt in a less proven toolkit) | Medium, but low gain | Low |

Notes:
- **B** wins raw efficiency but loses on UI maturity for a media app of this size, and nothing of the current UI can be reused. The player embedding would be custom work per toolkit.
- **C** keeps the JVM, which is the source of the memory floor. Moving pieces to Rust adds a JNI boundary without changing the main cost.
- **D** is cheap and measurable, and it is worth doing on the current app in parallel. It cannot remove the JVM floor.

## 4. Decision

**A. Rust core + Tauri 2 (stable 2.12.x) + React + TypeScript**, with libmpv kept as the media engine.

Why this is the best balance for Nuvio specifically:
1. The desktop player is already "native engine + HTML controls in a webview". Tauri uses the same model, so the most delicate part (the player UI, ≈5.4k lines of JS) can move over almost as is, and libmpv (`libmpv-2.dll`, already shipped) stays.
2. Rust removes the JVM, which is where the measured memory and startup costs come from.
3. React/TS gives a mature path for a rich, animated, virtualized media UI. That was hard to get with B.
4. The Rust core stays UI-free, which keeps it testable without the window. (Exposing it to other platforms is out of scope: Windows x64 only.)

Not chosen now: Tauri 3 (alpha only). The `libmpv2` crate stays an option to evaluate; the
first choice is loading libmpv dynamically with `libloading`, like the current C++ bridge does.

## 5. Target architecture

```
nextgen/
  crates/
    nuvio-core      # protocol + domain: addons (manifest, catalog, meta, stream, URLs), models, errors
    nuvio-net       # (later) shared HTTP client, de-dup, cache, retries, timeouts
    nuvio-store     # (later) SQLite storage + legacy .properties importer with backup/rollback
    nuvio-player    # (later) libmpv via libloading, window embedding per OS
    nuvio-plugins   # (later) rquickjs runtime with the same host API
  apps/
    nuvio-probe     # CLI used to validate the core against real data (phase 4)
    desktop         # (phase 5) Tauri 2 shell + React/TS UI
  bench/            # reproducible measurements (same scripts for old and new app)
```

- **One process for the app** (plus the system webview processes and libmpv threads). No
  microservices, no extra helper processes.
- **Typed IPC**: Tauri commands with typed request/response structs and request ids. The webview
  never gets file system, shell or raw network permissions; tokens stay in Rust.
- **Async** on Tokio with bounded concurrency per addon host; cancellation through request ids.
- **Errors**: `thiserror` enums per crate, mapped to typed UI errors at the IPC boundary.

## 6. Highest-risk features and how compatibility is preserved

| Risk | Plan |
|---|---|
| Player (embedding, tracks, subtitles, HW decode, fullscreen, resume) | Keep libmpv and its options from `player_bridge.cpp`; reuse `player-ui`; test matrix HLS/DASH/MP4/MKV, embedded and external subtitles, multiple audio tracks, HW decode on/off, fullscreen transitions |
| Plugin runtime API | Port host functions one by one; run real plugins against both runtimes and diff the results |
| Accounts, sync, watch party (Supabase) | Same endpoints and payloads; record real responses as contract fixtures |
| External integrations (Trakt, Simkl, MDBList, TMDB, debrid, media servers) | Port per module behind contract tests built from the Kotlin tests and recorded responses |
| User data | Read the existing `.properties` stores read-only, back them up, import into SQLite, validate counts and ids, keep the originals untouched (rollback = keep using the old app) |
| Addon protocol | Byte-for-byte compatible URL building and parsing, verified with tests mirrored from the Kotlin test suite |

## 7. Phases and gates

| Phase | Deliverable | Gate to continue |
|---|---|---|
| 1 Audit | `docs/AUDIT.md`, baseline CSV | done |
| 2 Decision | this document | done |
| 3 Structure | `nextgen/` Cargo workspace, original app untouched | builds, tests run |
| 4 Core | addon protocol + legacy store reader + probe against real addons | contract tests pass; real addons load |
| 5 UI | Tauri shell: home, catalogs, search, details | parity checklist for those screens |
| 6 Player | libmpv embedding + reused controls | full playback test matrix — **feasibility passed 27/27, see PLAYER_SPIKE.md** |
| 7 Compatibility | plugins, accounts, integrations, downloads, P2P | per-module contract tests |
| 8 Optimization | same bench scripts on both apps | measured improvement, no regressions |
| 9 Distribution | Windows x64 installer (MSI/NSIS), data dirs, icons, libmpv/WebView2 runtime | installer verified on Windows |
| 10 Transition | replace only after parity and stability | rollback path documented |

The original Kotlin app stays compilable and remains the reference during all phases.
