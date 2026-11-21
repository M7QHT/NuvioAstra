//! Application services: data for the UI, built on `nuvio-core` and `nuvio-store`.
//! No UI code and no Tauri commands here (those live in `api.rs`).

pub mod addons;
pub mod epg;
pub mod home;
pub mod language_aliases;
pub mod livetv;
pub mod meta;
pub mod playback;
pub mod progress;
pub mod search;
