# Nuvio account, PIN, avatars and cloud sync (stage 12)

Nuvio Astra signs in to the **same Nuvio account** as the original app and talks to the same backend
(Supabase: GoTrue for auth, PostgREST RPCs for data). The contracts were taken from the original's
Kotlin sources (`composeApp/src/commonMain/.../features/{auth,sync,profiles,library,watchprogress,
watched,addons}`); nothing was invented on the server side and no table or function was added.

## Architecture

```
React (Settings → Conta, sidebar dot, PIN dialog, avatar picker)
   │  IPC: account_status / sign_in / sign_up / sign_out / sync_now, avatars_catalog,
   │       profile_unlock / profile_pin_set / profile_pin_clear      (no token ever crosses)
   ▼
apps/nuvio-desktop/src/account.rs   sync loop (start 2.5 s, debounce 3 s, every 15 min), events
   │                                 `sync-status`, `sync-applied`, `library-changed`; PIN gate
   ▼
crates/nuvio-sync                   Engine: session, refresh, sync steps, PIN, avatars
   ├─ remote.rs   HTTP to Supabase (anon key + user JWT), fallback URL, pt-BR errors
   └─ crypto.rs   DPAPI protect/unprotect, SHA-256 and random bytes (Windows BCrypt)
   ▼
crates/nuvio-store::sync_state      pending changes (offline queue), cursors, merge rules
   ▼
%APPDATA%\NuvioNextGen              local data stays the source the UI reads
```

- The local store is always what the screens read; sync only merges into it. Without an account,
  or offline, everything works as before and changes are queued.
- Every local write (favorite, progress, watched, history removal, addons, profiles) records a
  `Change` with a revision number in `sync-state.json`. A push sends the snapshot of pending keys;
  only the keys whose revision did not change meanwhile are cleared (`clear_sent`), so an edit made
  during a push is sent again — no change is lost and resending is idempotent (upserts by key).

## Server configuration and secrets

- `NUVIO_SUPABASE_URL`, `NUVIO_SUPABASE_ANON_KEY`, optional `NUVIO_SUPABASE_FALLBACK_URL` are read at
  build time from the environment or from the repository root `local.properties` (git-ignored), as in
  the original. `build.rs` refuses a key whose JWT role is not `anon` (service/admin keys can never be
  embedded). Without them the build works and the account shows "Conta indisponível nesta versão".
- Only https URLs are accepted (http only for `127.0.0.1`, used by the tests' mock server).
- The anon key is public by design (row-level security on the server); all user data access uses the
  user's own access token.

## Session security

- The session (access token, refresh token, expiry, user id, e-mail) lives only in Rust and is saved
  in `account.dat` encrypted with **DPAPI** (`CryptProtectData`, current Windows user, extra entropy
  `NuvioAstra.Account.v1`). Another Windows user or another machine cannot decrypt it; a damaged file
  means "signed out".
- The frontend only receives `AccountStatus` (configured, signed in, e-mail, state, pending count,
  last sync, last error, last report). No token in the DOM, `localStorage`, IPC or logs (checked by the
  UI test). The password is sent once to GoTrue and never stored.
- Refresh: before a call when the token is near expiry, and once after a 401. A refused refresh ends
  in the "Sessão expirada" state (data and pending changes kept; signing in again resumes).
- Sign-out calls `/auth/v1/logout?scope=local` (5 s limit), deletes `account.dat`, keeps local data
  and the queue; a sync running at that moment is discarded (generation counter).

## Login methods

| Method | Original | Astra |
|---|---|---|
| E-mail + password | ✅ | ✅ `grant_type=password` |
| Create account | ✅ | ✅ `/auth/v1/signup` (when the server requires e-mail confirmation, the UI says so) |
| Anonymous / guest | ✅ (anonymous sign-in) | ⏳ local mode without account covers the use case |
| TV/device link (QR) | ✅ | ⏳ |

## Data synchronized

| Entity | Local source | Remote (RPC) | Identifier | Push | Pull | Conflict rule (original) |
|---|---|---|---|---|---|---|
| Profiles (name, color, avatar, uses primary addons) | `profiles.json` | `sync_pull_profiles`, `sync_push_profiles {p_client_max_profiles: 6, p_profiles, p_origin_client_id}`, `sync_delete_profile_data` | profile index 1–6 | whole list when dirty | every sync | local changes pushed first, then the account list is taken |
| Addons per profile | `addons-<p>.json` | `sync_push_addons {p_addons}`, table `addons?profile_id=eq.N` | manifest URL | whole list when dirty | every sync (active profile) | same as profiles; enabled state + order kept; new manifests fetched by URL |
| Saved items (library) | `library-<p>.json` | `sync_push_library_items`, `sync_delete_library_items`, `sync_pull_library`, `sync_pull_library_delta`, `sync_get_library_delta_cursor` | `content_id` + `content_type` | pending keys | snapshot first time, then delta by event id | snapshot replaces local except keys with pending local upsert/delete; deltas applied in order skipping pending keys |
| Watch progress | `progress-<p>.json` | `sync_*_watch_progress*` | `<id>` / `<id>_s<S>e<E>` | pending keys, on player flush (pause, seek, end, close) | snapshot then delta | remote wins unless the local entry is pending **and** newer; a delta delete never removes a pending entry |
| Watched marks | `watched-<p>.json` | `sync_*_watched_items*` (pages from 1) | `content_id` + season + episode | pending keys | snapshot then delta | same as library |
| PIN | server only (+ offline hash) | `verify_profile_pin`, `set_profile_pin`, `clear_profile_pin` | profile index | immediate | with profiles (`pin_enabled`, `updated_at`) | server is the authority |
| Avatars | `avatars.json` cache | `get_avatar_catalog`, image `storage/v1/object/public/avatars/<path>` | avatar id | with profiles | on demand | — |

Not synchronized, on purpose: the profile settings blob (`sync_push_profile_settings_blob` replaces
the other devices' preferences wholesale), provider/debrid credentials, collections, media servers,
plugins, watch party, member avatars.

## Sync flow

1. Profile deletions queued locally (`sync_delete_profile_data`).
2. Push profiles (only once the account is linked, see below), pull profiles, apply.
3. First link: push the local-only items found by the join.
4. Push pending library / progress / watched / addon changes of **every** profile.
5. Pull addons, library, progress and watched of the **active** profile (on the first link: of
   **every** profile), then push again what changed meanwhile.

- **Initial sync**: snapshot pull (pages of 500), the delta cursor is stored afterwards.
- **Incremental**: `*_delta {p_since_event_id}`; the cursor moves to the largest event id applied.
- **Per profile**: every RPC carries `p_profile_id`; queues and cursors are per profile; data of one
  profile never goes to another. Profile 1 with `uses_primary_addons` sharing follows the original.
- **Stale answers**: each run carries the session generation; a run started before a sign-out or
  account change is dropped, and a merge never overwrites a key changed locally after the request.
- **Failures**: each step is independent; failed steps are reported (`last_report`) and retried on the
  next run; offline aborts the run and the state shows "Sem conexão".
- **Triggers**: 2.5 s after start, 3 s after a local change (debounced), every 15 min, the "Sincronizar
  agora" button. Progress is pushed only at the player's flush points, as in the original.

### First link of an account (Astra decision)

The original assumes a fresh install. Astra already has local data (migrated from the original), so
the first sync with an account **joins** both sides: account items are added, local-only items are
queued for upload, nothing is deleted. Whole-list pushes (profiles, addons) wait until the join is
done, and deletions made before the link are dropped, so local history can never erase account data.

Since stage 13 the first link is **never automatic**:

1. Signing in only stores the session. The state is "Revise a primeira sincronização" (`needsReview`)
   and every automatic run (start, local changes, 15 min) stops before any request.
2. Settings → Conta loads the **preview** (`Engine::preview`, command `account_sync_preview`): per
   profile, local and account counts of profiles, addons, saved items, progress and watched marks,
   items only here (to send), only on the account (to receive), differing versions (conflicts: addon
   enabled state, progress position/date with the newer side, profile name/color/avatar), duplicate
   keys, pending local changes. It calls only the account's read functions (`sync_pull_profiles`,
   `sync_pull_library`, `sync_pull_watch_progress`, `sync_pull_watched_items`, `GET addons`) and
   writes nothing locally except the sanitized log. Data from another account is announced there.
3. "Iniciar primeira sincronização" (with a confirmation dialog) runs it: a verified copy of every
   local document is made first (`backups/before-first-sync-<ms>/`), then the join above for every
   profile in the same run.
4. Afterwards "Comparar com a conta" runs the same read-only comparison as a check: after a
   successful sync every count of "only here", "only on the account" and "differing" is 0.

First-link rules refined in stage 13: a progress entry present on both sides keeps the **newer**
version (a newer local position is kept and sent; before, the account's version always won when
nothing was pending); an addon list sent back keeps the account's addon names (never blank).

`sync-log.json` keeps the last 50 previews, backups and runs with counts, entity names and error
texts only (no token, e-mail, title or address); `tools/migration-audit/audit-sync.ps1` reads it with
the sync state from outside the app package.

## PIN

- 4 digits, validated by the server (`verify_profile_pin` → `unlocked`, `retry_after_seconds`); the
  server's lockout is shown ("tente novamente em N s").
- Setting/changing/removing needs the account (and the current PIN to change/remove), as in the original.
- Offline: after a successful online check the app keeps `salt + SHA-256("profile:<i>:<salt>:<pin>")`
  in `pin-cache.json`; it unlocks offline only with that hash, and the cache is dropped when the
  profile's `updated_at` changes. The PIN is never stored in clear and is not the account password.
- Enforcement is in Rust: switching to a protected profile, and every command that reads the active
  profile's data while it is locked (`ensure_unlocked`), fail until the PIN is accepted. A protected
  active profile is locked at every start.

## UI

- Settings → **Conta**: sign in / create account, e-mail, status, last sync time, pending changes,
  "Sincronizar agora", last report, link confirmation, sign out.
- Sidebar: dot on Configurações — green synced, blue syncing, amber pending/confirmation, grey
  offline/signed out, red error/expired (with screen-reader text).
- Profile editor: avatar grid from the account catalog (by category), PIN section.

## Tests

- `crates/nuvio-sync/tests/contract.rs` against an in-memory Supabase (`tests/mock`, std TCP server
  implementing every route used, with failure switches): auth + DPAPI file, refresh + expiry, first
  sync join then incremental, deletions not resurrected, progress conflicts + offline queue, failed
  steps + idempotent retry, different-account confirmation + pre-link deletions, PIN online/offline/
  lockout + avatars, first sync only after the reviewed read-only preview (exact counts, backup, all
  profiles, newer local progress kept, addon names kept, identical comparison afterwards). 9/9.
- `nuvio-store::sync_state` unit tests (4), `crypto` tests, `manage.rs` IPC test with the PIN gate.
- UI phases `account-ui` (11) and `account-verify` (3) on a copy of the data, signed out; the only
  network access is the public avatar catalog. The real account is never used by tests.

## Limitations

- Not tested against the user's real account (by rule: no destructive operation on it). The contracts
  are the original's and the anon configuration was verified, but a first real sign-in is the first
  end-to-end run; it is non-destructive by design (join).
- Anonymous sign-in, TV/QR device link, password reset screen, Trakt/Simkl, settings blob,
  collections, watch party: not implemented.
- After the first link, non-active profiles pull their data when they become active (as the original).
- No realtime channel: other devices' changes arrive on the next sync (≤ 15 min, or the button).
