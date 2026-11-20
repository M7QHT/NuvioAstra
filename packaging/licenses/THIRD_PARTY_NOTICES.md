# Nuvio Astra — third-party notices

Nuvio Astra is free software under the **GNU General Public License v3.0**
(`NUVIO-ASTRA-LICENSE-GPL-3.0.txt`). It is a fork of **Nuvio Desktop**
(https://github.com/NuvioMedia/NuvioDesktop, GPL-3.0). Its complete source code is published in the
same GitHub repository as the installers (tag of each release).

The Windows installer ships these separately built components:

## Nuvio Engine — `nuvio_engine.dll`

- Project: https://github.com/NuvioMedia/nuvio-engine (GPL-3.0-or-later), release **v0.1.6**,
  asset `nuvio-engine-windows-x86_64-0.1.6.zip`, unmodified.
- DLL SHA-256: `84a149c16bea5ac376a7468c61c7bb2d5f3d8fc8e1b74a7980af2edd8f426743`.
- Contains libtorrent 2.0.12 (BSD-3-Clause), Boost 1.86.0 headers (BSL-1.0), OpenSSL 3.5.7
  (Apache-2.0), try_signal (MIT), built with llvm-mingw (Apache-2.0 with LLVM exception).
- Its license texts, notices and build information are in `nuvio-engine/`, as published by the
  project. Corresponding source: the project's repository at tag `v0.1.6`.

## libmpv — `libmpv-2.dll`

- mpv **v0.40.0-465-gf6c116491** (https://github.com/mpv-player/mpv, commit `f6c116491`), the same
  Windows x64 build Nuvio Desktop ships, unmodified.
- mpv is GPL-2.0-or-later (LGPL-2.1-or-later when built without GPL parts); this Windows build links
  GPL components (FFmpeg built with GPL options, libass, libplacebo, LuaJIT, and others), so it is
  distributed under the **GPL**, compatible with Nuvio Astra's GPL-3.0.
- Sources: mpv — https://github.com/mpv-player/mpv ; FFmpeg — https://ffmpeg.org/download.html ;
  Windows build recipe used by these builds — https://github.com/shinchiro/mpv-winbuild-cmake .
  On request, the maintainers of this repository provide the corresponding source of the exact
  build as required by the GPL.

## Rust crates and the web interface (compiled into `Nuvio Astra.exe`)

- Tauri 2 and its plugins (`tauri`, `tauri-plugin-updater`): MIT or Apache-2.0.
- React, React DOM: MIT. Vite and TypeScript are build tools only (MIT / Apache-2.0).
- Other Rust crates (tokio, reqwest, serde, libloading, windows, webview2-com, minisign-verify and
  their dependencies): MIT and/or Apache-2.0 (some BSD-3-Clause, ISC, Zlib, Unicode-3.0). The full
  list with licenses can be produced with `cargo license` or `cargo about` from the source tree.

## Not shipped

- Microsoft Edge WebView2 Runtime: part of Windows 10/11 (or installed by Microsoft), not
  redistributed by this installer.
- No codec, font or media file is included.
