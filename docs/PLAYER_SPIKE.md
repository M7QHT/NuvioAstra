# Player Feasibility Test — libmpv embedded in Tauri 2 (Windows x64)

Date: 2026-11-19 · Machine: Windows 11 Pro 26200, 12 logical cores, NVIDIA GPU · libmpv client API 2.5
(`libmpv-2.dll`, the same file shipped by the current app).

## What was built

- `crates/nuvio-player`: libmpv loaded at runtime with `libloading` (no SDK at build time), typed
  commands, property observation (`mpv_observe_property`) instead of the current bridge's 500 ms
  polling, snapshots throttled to ≤ 4/s for the UI, deterministic shutdown (wake → join event
  thread → `mpv_terminate_destroy`).
- `apps/nuvio-desktop`: Tauri 2.12.7 window. Window model copied from the shipping
  `player_bridge.cpp`: mpv gets the window as `wid` and creates its own child video window; the
  WebView2 is a sibling with a transparent default background (`ICoreWebView2Controller2`) and
  stays above mpv in the z-order. The video area is set with `video-margin-ratio-*`, so preview ⇄
  fullscreen and resizing never recreate the player.
- mpv options mirror the current app (`vo=gpu-next`, `hwdec=auto`, software fallback, demuxer
  cache 150 MiB / 50 MiB back, HTTP reconnect, `http-header-fields` with the bridge's escaping).
- UI ↔ Rust: typed Tauri commands only (`player_open`, `player_command`, `player_video_rect`,
  `player_snapshot`, `player_close`, `window_set_fullscreen`); capability `core:default` only — no
  file system, shell or HTTP plugins exposed to the webview.
- Self-test (`--selftest <report.json>`) drives the real window, and `bench/sample-run.ps1` samples
  the whole process tree (app + WebView2) including GPU engine counters.

## Results (self-test runs 2–4, all 27/27 checks passed)

| Source | First frame | Decode | Video | Tracks | Fullscreen ⇄ preview | Resize | Audio switch | External sub | Seek | Close |
|---|---|---|---|---|---|---|---|---|---|---|
| HLS (Apple fMP4 master) | 6.6–19.2 s | d3d11va | 1920×1080 @ 60 | 3 audio, 2 sub | ✅ same session | ✅ | ✅ 1→2 | ✅ | ✅ | ✅ ~115 ms |
| MP4 (H.264, 5.1 audio, 10 min) | 2.9 s | d3d11va | 640×360 @ 24 | 1 audio | ✅ | ✅ | n/a (1 track) | ✅ | ✅ | ✅ ~134 ms |
| MKV (Matroska test5) | 1.3–1.7 s | d3d11va | 1024×576 @ 24 | 2 audio, 8 sub | ✅ | ✅ | ✅ 1→2 | ✅ | ✅ | ✅ ~113 ms |

- Dropped frames: 0 (output) and 0 (decoder) in every run.
- After each close: 0 mpv windows left; after app exit: **0 residual processes**.
- Visual evidence (screen captures of the composed window): [`evidence/hls-preview.png`](evidence/hls-preview.png),
  [`evidence/hls-fullscreen.png`](evidence/hls-fullscreen.png), [`evidence/mkv-subtitle.png`](evidence/mkv-subtitle.png):
  video renders inside the window, WebView2 controls overlay it, embedded WebVTT subtitles render in fullscreen.

## Resource measurements

Idle, same script and conditions as the baseline (`bench/measure-startup.ps1`, 2 runs, 45 s idle):

| | Window shown | Working set | Private bytes | Idle CPU |
|---|---|---|---|---|
| Current Nuvio 0.1.38 (JVM) | 2.58 / 2.67 s | 525 / 495 MB | 723 / 690 MB | 0.68 / 0.85 % |
| NextGen shell (Tauri + WebView2, 7 processes) | **0.75 / 0.15 s** | 330 / 332 MB | **158 / 158 MB** | **0.09 / 0.02 %** |

> The NextGen shell shows only the test screen; the current app shows the full home with catalogs
> and artwork. This is a floor for the shell, **not an app-to-app comparison** yet. Working set
> double-counts pages shared by the WebView2 processes; private bytes are the better indicator.

During playback (`bench/sample-run.ps1`, 1 s samples, whole tree):

| Phase | Private bytes | CPU (all cores) | GPU 3D | GPU video decode | GPU dedicated memory |
|---|---|---|---|---|---|
| HLS 1080p60 | 521–674 MB | 1.3–3.4 % | 2.3–2.4 % | 2.7–3.4 % | 65–249 MB |
| MP4 360p24 | 437–522 MB | 0.5–2.3 % | 0–2.7 % | 0–1.0 % | 0–151 MB |
| MKV 576p24 | 438–484 MB | 0.7–1.6 % | 0–2.7 % | 0–1.4 % | 0–173 MB |

Per process during HLS: `nuvio-desktop` 405 MB (mpv demuxer cache + decoder + renderer), WebView2
GPU process 157 MB, the rest < 40 MB each.

**Memory after closing every session** (25 s idle hold, per process): `nuvio-desktop` 55.6 MB
(libmpv and the D3D11 driver stay loaded after the first playback), WebView2 GPU process 112 MB
(Chromium keeps compositing textures), total ≈ 257 MB. It does not grow from one session to the
next, so it is a one-time cost, not a leak. Not measured yet: the current app's RAM during
playback (it needs the UI driven to a stream). That is the comparison that matters next.

## Findings and open items

1. **HLS start time** (6.6–19.2 s for Apple's multi-rendition master playlist; ~5.5 s even without
   a window). Hypothesis tested and **rejected**: `demuxer-lavf-probe-info=nostreams` made no
   difference (`crates/nuvio-player/examples/startup_bench.rs`). The current app uses the same
   libmpv and options; the next step is to measure both on the same addon HLS URLs.
2. **External subtitle text** loads and is selected (mpv reports it), but the capture does not show
   its text in preview: it sits at the bottom of the video under the controls gradient.
   *Correction (stage 3):* the original does not move subtitles with the controls; it applies a fixed
   style with `sub-pos = 100 − bottomOffset/2` (90 by default), which the spike had not ported yet.
   Ported in stage 3 — see `PLAYER_PORT.md`.
3. **Retained memory after the first playback** (≈ +100 MB total, see above). Candidate to measure
   next: WebView2 `MemoryUsageTargetLevel = Low` while no video is playing.
4. Not covered by this test: HEVC/4K (no public source reachable), DASH, A/V-sync metrics, the
   RTX VSR/HDR filters and PiP of the current app, real addon streams with HTTP headers (header
   escaping is unit-tested; playback through headers still needs a real source).

## Verdict

The architecture works on Windows x64: libmpv renders inside the Tauri window with hardware
decoding, the WebView2 UI overlays the video, fullscreen and resize do not restart playback, track
switching and external subtitles work, and sessions close without residual windows or processes.
Idle cost of the shell is far below the current app; playback cost is dominated by mpv itself, as
in the current app. Next: port the remaining player features and measure both apps on the same
real streams.
