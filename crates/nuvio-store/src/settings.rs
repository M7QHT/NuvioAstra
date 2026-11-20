//! Per-profile settings of NextGen, with the original's keys, defaults and ranges.
//!
//! Only settings that NextGen applies for real are here (see docs/FEATURE_PARITY.md):
//! - player (`PlayerSettingsRepository` / `PlayerSettingsStorage.desktop.kt`, store
//!   `nuvio_player_settings`, keys `<name>_<profile>`): resize mode, decoder priority, NVIDIA RTX
//!   VSR/HDR, audio/subtitle language preferences, subtitle style;
//! - home (`HomeCatalogSettingsRepository`): hero, catalog type in titles, unreleased content,
//!   catalog visibility/order/custom titles.
//! In the original all of them are profile-scoped (`ProfileScopedKey`); so are they here.

use crate::{HomeCatalogSettings, LegacyStore, StoreError};
use serde::{Deserialize, Serialize};

pub const RESIZE_MODES: &[&str] = &["Fit", "Fill", "Zoom", "Stretch"];
pub const FONT_SIZE_RANGE: (i64, i64) = (6, 40); // desktop `subtitleFontSizeRangeSp`
pub const OUTLINE_WIDTH_RANGE: (i64, i64) = (1, 5);
pub const BOTTOM_OFFSET_RANGE: (i64, i64) = (0, 200);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SubtitleSettings {
    /// `#AARRGGBB`, as `Color.toStorageHexString`.
    pub text_color: String,
    pub background_color: String,
    pub outline_color: String,
    pub outline_enabled: bool,
    pub outline_width: i64,
    pub bold: bool,
    pub font_size_sp: i64,
    pub bottom_offset: i64,
    pub strip_sdh: bool,
}

impl Default for SubtitleSettings {
    /// `SubtitleStyleState.DEFAULT`.
    fn default() -> Self {
        Self {
            text_color: "#FFFFFFFF".into(),
            background_color: "#00000000".into(),
            outline_color: "#FF000000".into(),
            outline_enabled: true,
            outline_width: 2,
            bold: false,
            font_size_sp: 18,
            bottom_offset: 20,
            strip_sdh: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlayerSettings {
    /// `PlayerResizeMode` name: Fit, Fill, Zoom, Stretch.
    pub resize_mode: String,
    /// 0 hardware only, 1 hardware preferred (default), 2 software only.
    pub decoder_priority: i64,
    pub nvidia_rtx_super_resolution: bool,
    pub nvidia_rtx_hdr: bool,
    /// `default`, `device`, `original` or a language code (`AudioLanguageOption`).
    pub preferred_audio_language: String,
    pub secondary_preferred_audio_language: Option<String>,
    /// `none`, `device`, `forced` or a language code (`SubtitleLanguageOption`).
    pub preferred_subtitle_language: String,
    pub secondary_preferred_subtitle_language: Option<String>,
    pub subtitle: SubtitleSettings,
}

impl Default for PlayerSettings {
    /// `PlayerSettingsUiState()` defaults.
    fn default() -> Self {
        Self {
            resize_mode: "Fit".into(),
            decoder_priority: 1,
            nvidia_rtx_super_resolution: false,
            nvidia_rtx_hdr: false,
            preferred_audio_language: "device".into(),
            secondary_preferred_audio_language: None,
            preferred_subtitle_language: "none".into(),
            secondary_preferred_subtitle_language: None,
            subtitle: SubtitleSettings::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProfileSettings {
    pub player: PlayerSettings,
    pub home: HomeCatalogSettings,
    pub p2p: P2pSettings,
}

pub const P2P_PROFILES: &[&str] = &["SOFT", "BALANCED", "FAST"];
/// `P2pCacheSize` names and sizes.
pub const P2P_CACHE_SIZES: &[(&str, u64)] = &[
    ("NONE", 0),
    ("GB_2", 2 << 30),
    ("GB_5", 5 << 30),
    ("GB_10", 10 << 30),
];

/// P2P streaming (`P2pSettingsRepository`, profile-scoped in the original). Off until the user
/// accepts the P2P notice (`P2pConsentDialog`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct P2pSettings {
    pub enabled: bool,
    pub enable_upload: bool,
    pub hide_torrent_stats: bool,
    /// `P2pTorrentProfile` name.
    pub torrent_profile: String,
    /// `P2pCacheSize` name.
    pub cache_size: String,
}

impl Default for P2pSettings {
    fn default() -> Self {
        Self { enabled: false, enable_upload: true, hide_torrent_stats: false, torrent_profile: "BALANCED".into(), cache_size: "GB_2".into() }
    }
}

impl P2pSettings {
    pub fn sanitized(mut self) -> Self {
        let d = Self::default();
        if !P2P_PROFILES.contains(&self.torrent_profile.as_str()) {
            self.torrent_profile = d.torrent_profile;
        }
        if !P2P_CACHE_SIZES.iter().any(|(n, _)| *n == self.cache_size) {
            self.cache_size = d.cache_size;
        }
        self
    }

    pub fn cache_bytes(&self) -> u64 {
        P2P_CACHE_SIZES.iter().find(|(n, _)| *n == self.cache_size).map_or(2 << 30, |(_, b)| *b)
    }

    /// Native `NuvioTorrentProfile` value (Soft 0, Balanced 1, Fast 2).
    pub fn profile_value(&self) -> i32 {
        P2P_PROFILES.iter().position(|p| *p == self.torrent_profile).map_or(1, |i| i as i32)
    }
}

fn normalize_color(value: &str, fallback: &str) -> String {
    // `subtitleColorFromStorage`: 6 or 8 hex digits, optional '#'; 6 digits = opaque.
    let hex = value.trim().trim_start_matches('#');
    let ok = (hex.len() == 6 || hex.len() == 8) && hex.chars().all(|c| c.is_ascii_hexdigit());
    match (ok, hex.len()) {
        (true, 6) => format!("#FF{}", hex.to_uppercase()),
        (true, _) => format!("#{}", hex.to_uppercase()),
        _ => fallback.to_string(),
    }
}

fn optional_language(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

impl PlayerSettings {
    /// Brings every value into the original's ranges/sets (invalid values become the defaults),
    /// so a malformed write from the UI can never reach the player.
    pub fn sanitized(mut self) -> Self {
        let d = Self::default();
        if !RESIZE_MODES.contains(&self.resize_mode.as_str()) {
            self.resize_mode = d.resize_mode;
        }
        if !(0..=2).contains(&self.decoder_priority) {
            self.decoder_priority = d.decoder_priority;
        }
        if self.preferred_audio_language.trim().is_empty() {
            self.preferred_audio_language = d.preferred_audio_language;
        }
        if self.preferred_subtitle_language.trim().is_empty() {
            self.preferred_subtitle_language = d.preferred_subtitle_language;
        }
        self.preferred_audio_language = self.preferred_audio_language.trim().to_string();
        self.preferred_subtitle_language = self.preferred_subtitle_language.trim().to_string();
        self.secondary_preferred_audio_language = optional_language(self.secondary_preferred_audio_language);
        self.secondary_preferred_subtitle_language = optional_language(self.secondary_preferred_subtitle_language);
        let s = &mut self.subtitle;
        let ds = SubtitleSettings::default();
        s.text_color = normalize_color(&s.text_color, &ds.text_color);
        s.background_color = normalize_color(&s.background_color, &ds.background_color);
        s.outline_color = normalize_color(&s.outline_color, &ds.outline_color);
        s.outline_width = s.outline_width.clamp(OUTLINE_WIDTH_RANGE.0, OUTLINE_WIDTH_RANGE.1);
        s.font_size_sp = s.font_size_sp.clamp(FONT_SIZE_RANGE.0, FONT_SIZE_RANGE.1);
        s.bottom_offset = s.bottom_offset.clamp(BOTTOM_OFFSET_RANGE.0, BOTTOM_OFFSET_RANGE.1);
        self
    }
}

impl ProfileSettings {
    pub fn sanitized(mut self) -> Self {
        self.player = self.player.sanitized();
        self.p2p = self.p2p.sanitized();
        let mut seen = std::collections::HashSet::new();
        self.home.items.retain(|i| !i.key.trim().is_empty() && seen.insert(i.key.clone()));
        self
    }
}

impl LegacyStore {
    /// Player settings of one profile as the original stores them (missing keys = defaults).
    pub fn player_settings(&self, profile_index: i64) -> Result<PlayerSettings, StoreError> {
        let store = self.read_store("nuvio_player_settings")?;
        let get = |name: &str| store.get(&format!("{name}_{profile_index}")).map(|v| v.trim().to_string());
        let boolean = |name: &str| get(name).and_then(|v| v.parse::<bool>().ok());
        let int = |name: &str| get(name).and_then(|v| v.parse::<i64>().ok());
        let d = PlayerSettings::default();
        let ds = SubtitleSettings::default();
        Ok(PlayerSettings {
            resize_mode: get("resize_mode").unwrap_or(d.resize_mode),
            decoder_priority: int("decoder_priority").unwrap_or(d.decoder_priority),
            nvidia_rtx_super_resolution: boolean("nvidia_rtx_super_resolution_enabled").unwrap_or(false),
            nvidia_rtx_hdr: boolean("nvidia_rtx_hdr_enabled").unwrap_or(false),
            preferred_audio_language: get("preferred_audio_language").unwrap_or(d.preferred_audio_language),
            secondary_preferred_audio_language: get("secondary_preferred_audio_language"),
            preferred_subtitle_language: get("preferred_subtitle_language").unwrap_or(d.preferred_subtitle_language),
            secondary_preferred_subtitle_language: get("secondary_preferred_subtitle_language"),
            subtitle: SubtitleSettings {
                text_color: get("subtitle_text_color").unwrap_or(ds.text_color),
                background_color: get("subtitle_background_color").unwrap_or(ds.background_color),
                outline_color: get("subtitle_outline_color").unwrap_or(ds.outline_color),
                outline_enabled: boolean("subtitle_outline_enabled").unwrap_or(ds.outline_enabled),
                outline_width: int("subtitle_outline_width").unwrap_or(ds.outline_width),
                bold: boolean("subtitle_bold").unwrap_or(ds.bold),
                font_size_sp: int("subtitle_font_size_sp").unwrap_or(ds.font_size_sp),
                bottom_offset: int("subtitle_bottom_offset").unwrap_or(ds.bottom_offset),
                strip_sdh: boolean("subtitle_strip_sdh").unwrap_or(ds.strip_sdh),
            },
        }
        .sanitized())
    }

    /// Everything NextGen ports for one profile, read from the original's stores.
    pub fn profile_settings(&self, profile_index: i64) -> Result<ProfileSettings, StoreError> {
        Ok(ProfileSettings {
            player: self.player_settings(profile_index)?,
            home: self.home_catalog_settings(profile_index)?.unwrap_or_default(),
            // P2P starts off in Astra: the notice is accepted again here.
            p2p: P2pSettings::default(),
        }
        .sanitized())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_keeps_original_ranges() {
        let mut p = PlayerSettings { resize_mode: "Huge".into(), decoder_priority: 7, ..Default::default() };
        p.subtitle.font_size_sp = 99;
        p.subtitle.outline_width = 0;
        p.subtitle.bottom_offset = -3;
        p.subtitle.text_color = "00ff00".into();
        p.subtitle.outline_color = "nope".into();
        p.secondary_preferred_audio_language = Some("  ".into());
        let s = p.sanitized();
        assert_eq!(s.resize_mode, "Fit");
        assert_eq!(s.decoder_priority, 1);
        assert_eq!((s.subtitle.font_size_sp, s.subtitle.outline_width, s.subtitle.bottom_offset), (40, 1, 0));
        assert_eq!(s.subtitle.text_color, "#FF00FF00");
        assert_eq!(s.subtitle.outline_color, "#FF000000");
        assert_eq!(s.secondary_preferred_audio_language, None);
    }

    #[test]
    fn serializes_in_camel_case_for_the_ui() {
        let json = serde_json::to_value(ProfileSettings::default()).unwrap();
        assert_eq!(json["player"]["resizeMode"], "Fit");
        assert_eq!(json["player"]["subtitle"]["fontSizeSp"], 18);
        assert_eq!(json["home"]["heroEnabled"], true);
    }
}
