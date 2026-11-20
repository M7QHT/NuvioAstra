//! Embedded libmpv player for the Windows x64 desktop app.
//!
//! - [`mpv`]: runtime binding to `libmpv-2.dll` (no build-time SDK).
//! - [`player`]: one playback session embedded in a host window, with typed commands and state
//!   snapshots for the UI.

#![cfg(windows)]

pub mod mpv;
pub mod player;
pub mod win;

use std::path::PathBuf;
use thiserror::Error;

pub use player::{
    DecoderPriority, LoadRequest, Player, PlayerCommand, PlayerSnapshot, ResizeMode, SnapshotSink, SubtitleStyle, Track,
    VideoConfig,
};

#[derive(Debug, Error)]
pub enum PlayerError {
    #[error("libmpv: {0}")]
    Library(String),
    #[error("mpv: {0}")]
    Mpv(String),
    #[error("invalid argument: {0}")]
    InvalidArgument(String),
}

/// Finds `libmpv-2.dll`: `NUVIO_LIBMPV` (full path) first, then next to the executable.
pub fn locate_libmpv() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("NUVIO_LIBMPV").map(PathBuf::from).filter(|p| p.is_file()) {
        return Some(path);
    }
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    Some(exe_dir.join("libmpv-2.dll")).filter(|p| p.is_file())
}

