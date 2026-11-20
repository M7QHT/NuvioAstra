# Testing policy (permanent)

Applies to every NextGen stage from 2026-11-19 on.

## 1. Test what the change can affect

Before running tests, list the files and modules changed and the features they can affect, and run
only the tests relevant to them:

| Change in | Run |
|---|---|
| Library (favorites, history, progress) | `nuvio-store` library tests, progress tracker tests, library IPC contract test, UI phases `library-write` / `library-verify` |
| Home | catalog/home tests, UI full flow (Home part) |
| Search | search tests, UI full flow (Search part) |
| Settings | settings store tests, `settings_set` IPC test, UI phases `settings-write` / `settings-verify` |
| Addons management, profiles | `nuvio-store::profiles` tests, `manage.rs` IPC contract test (local addon server), UI phases `manage-write` / `manage-verify` |
| Addons | client/manifest/catalog tests, contract tests with the local addon server |
| Account, PIN, avatars, cloud sync | `nuvio-sync` unit + contract tests (`tests/contract.rs`, mock Supabase on 127.0.0.1), `nuvio-store::sync_state` tests, `manage.rs` IPC test (PIN gate), UI phases `account-ui` / `account-verify` |
| Player | the targeted player self-test of the changed feature first (see 3) |

Always, when code changed: `cargo test --workspace`, TypeScript check (`npm run build`), Windows x64
release build when the app changed.

## 2. Media baseline already validated

libmpv, HLS, MP4, MKV, DASH, HEVC, 4K, hardware decoding, fullscreen, preview and picture-in-picture
were validated in earlier stages (results summarized in `CHANGELOG.md` and `COMPARISON.md`). They are
the baseline and are **not** repeated by default:

- no new downloads of test files (Internet Archive or other public videos) to re-check codecs;
- no full media suite (138/161 checks) for changes that do not touch the player;
- no fullscreen / resize / PiP re-runs when that code did not change.

## 3. When player tests are required

Only when a change directly affects `crates/nuvio-player`, `win.rs`, the libmpv integration, the
WebView2 composition, decoding, session management, stream headers/resolution, playback controls,
subtitles/audio, preview/fullscreen/PiP, or settings that change the player's behavior. Even then,
start with the test of the changed feature; the full media suite only for a broad change or a
concrete suspicion of regression.

Playing a real addon stream inside a UI phase (to check progress, resume, picture) is a targeted test
of that feature, with sources explicitly chosen by the script — not a media suite run.

## 4. Prefer light, existing tests

Unit tests of the changed modules, relevant integration tests, Rust/TypeScript contract tests through
Tauri's mock IPC, the automated UI phases of the affected screens, type checking, x64 build. Reuse
existing fixtures, local addon servers and captures; do not add heavy tests when a targeted one
already proves the behavior. UI tests run on a copy of the NextGen data (`uitest::data_dir`), never on
the user's files.

## 5. Reporting

Every stage report lists the tests run and the ones skipped because they are unrelated to the change.
A test that was not run is never reported as passed.

## 6. The user's Nuvio account

Tests never sign in to, write to or delete from the user's real account (profiles, addons, saved items,
progress, watched marks, PIN). Sync behavior is proven against the mock Supabase; UI phases run signed
out on a copy of the data (the only network access allowed is the public avatar catalog). No
credential, token or key is printed in logs or reports.

## 7. Real user data and app packages

Tools started by a packaged app (the Claude desktop app included) see `%APPDATA%` through the
package's private copy and write existing files into it. Therefore:

- never start NextGen in normal mode from such tools against the real `%APPDATA%` (UI tests use the
  `uitest::data_dir` copy; ad-hoc runs use an isolated `APPDATA`);
- read or simulate the real data only outside the package (`tools/migration-audit`, via WMI or a
  normal PowerShell window);
- migration changes are validated on faithful copies of the real data, opened twice (idempotence),
  before the user's next normal start.
