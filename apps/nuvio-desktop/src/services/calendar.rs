//! Release calendar for tracked series/anime in the active profile (favorites + watched/in-progress).
//! Built in Rust from `AppStore` data and addon episode release dates (`MetaVideo.released`).

use nuvio_core::meta::MetaDetails;
use nuvio_store::library::{self, LibraryItem, ProgressEntry, WatchedItem};
use nuvio_store::next_up::iso_day;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::Arc;

const DAY_MS: i64 = 86_400_000;
const MAX_TRACKED: usize = 48;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEpisode {
    pub meta_id: String,
    pub meta_type: String,
    pub series_name: String,
    pub poster: Option<String>,
    pub video_id: String,
    pub season: i32,
    pub episode: i32,
    pub episode_title: String,
    pub thumbnail: Option<String>,
    pub overview: Option<String>,
    pub air_date: String,
    pub days_from_today: i64,
    pub watched: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarView {
    pub today: String,
    pub tracked_series: usize,
    pub episodes: Vec<CalendarEpisode>,
}

fn is_series_content(content_type: &str) -> bool {
    library::is_series_like(content_type) || content_type.trim().eq_ignore_ascii_case("anime")
}

/// Collects unique series/anime `(content_type, id)` pairs to check for release dates, ordered by
/// favorites first, then most recently watched/progressed titles, capped at `MAX_TRACKED`.
pub fn tracked_series(favorites: &[LibraryItem], progress: &[ProgressEntry], watched: &[WatchedItem]) -> Vec<(String, String)> {
    let mut favs: Vec<&LibraryItem> = favorites.iter().filter(|f| is_series_content(&f.content_type)).collect();
    favs.sort_by(|a, b| b.saved_at_epoch_ms.cmp(&a.saved_at_epoch_ms));

    let mut prog: Vec<&ProgressEntry> = progress.iter().filter(|p| is_series_content(&p.parent_meta_type)).collect();
    prog.sort_by(|a, b| b.last_updated_epoch_ms.cmp(&a.last_updated_epoch_ms));

    let mut wlist: Vec<&WatchedItem> = watched.iter().filter(|w| is_series_content(&w.content_type)).collect();
    wlist.sort_by(|a, b| b.marked_at_epoch_ms.cmp(&a.marked_at_epoch_ms));

    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<(String, String)> = Vec::new();
    let mut push = |ctype: &str, id: &str| {
        let id = id.trim();
        let ctype = ctype.trim();
        if id.is_empty() || ctype.is_empty() || out.len() >= MAX_TRACKED {
            return;
        }
        if seen.insert(id.to_string()) {
            out.push((ctype.to_string(), id.to_string()));
        }
    };

    for f in favs {
        push(&f.content_type, &f.id);
    }
    for p in prog {
        push(&p.parent_meta_type, &p.parent_meta_id);
    }
    for w in wlist {
        push(&w.content_type, &w.id);
    }
    out
}

/// Converts days since `1970-01-01` back to `YYYY-MM-DD` (inverse of `iso_day`, Howard Hinnant).
pub fn civil_from_days(days: i64) -> String {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!("{year:04}-{m:02}-{d:02}")
}

/// Builds the filtered, sorted release calendar for `[today - past_days, today + future_days]`.
pub fn build_calendar(
    metas: &[(String, String, Arc<MetaDetails>)],
    progress: &[ProgressEntry],
    watched: &[WatchedItem],
    now_ms: i64,
    past_days: i64,
    future_days: i64,
) -> CalendarView {
    let today_day = now_ms.div_euclid(DAY_MS);
    let min_day = today_day - past_days;
    let max_day = today_day + future_days;

    let mut watched_keys: HashSet<String> = HashSet::new();
    for e in progress {
        if e.effectively_completed() {
            watched_keys.insert(library::progress_key(&e.parent_meta_id, e.season_number, e.episode_number));
        }
    }
    for w in watched {
        watched_keys.insert(library::progress_key(&w.id, w.season, w.episode));
    }

    let mut seen_eps: HashSet<(String, i32, i32)> = HashSet::new();
    let mut episodes: Vec<CalendarEpisode> = Vec::new();

    for (meta_type, meta_id, meta) in metas {
        for v in &meta.videos {
            let (Some(s), Some(ep)) = (v.season, v.episode) else { continue };
            let (Ok(season), Ok(episode)) = (i32::try_from(s), i32::try_from(ep)) else { continue };
            if season <= 0 || episode < 0 {
                continue;
            }
            let Some(day) = v.released.as_deref().and_then(iso_day) else { continue };
            if day < min_day || day > max_day {
                continue;
            }
            if !seen_eps.insert((meta_id.clone(), season, episode)) {
                continue;
            }
            let key = library::progress_key(meta_id, Some(season), Some(episode));
            episodes.push(CalendarEpisode {
                meta_id: meta_id.clone(),
                meta_type: meta_type.clone(),
                series_name: meta.name.clone(),
                poster: meta.poster.clone(),
                video_id: v.id.clone(),
                season,
                episode,
                episode_title: v.title.clone(),
                thumbnail: v.thumbnail.clone(),
                overview: v.overview.clone(),
                air_date: civil_from_days(day),
                days_from_today: day - today_day,
                watched: watched_keys.contains(&key),
            });
        }
    }

    episodes.sort_by(|a, b| {
        a.air_date
            .cmp(&b.air_date)
            .then_with(|| a.series_name.cmp(&b.series_name))
            .then_with(|| a.season.cmp(&b.season))
            .then_with(|| a.episode.cmp(&b.episode))
    });

    CalendarView {
        today: civil_from_days(today_day),
        tracked_series: metas.len(),
        episodes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nuvio_core::meta::MetaVideo;

    fn sample_meta(id: &str, name: &str, videos: Vec<MetaVideo>) -> Arc<MetaDetails> {
        Arc::new(MetaDetails {
            id: id.into(),
            content_type: "series".into(),
            name: name.into(),
            poster: Some("https://img/poster.jpg".into()),
            background: None,
            logo: None,
            description: None,
            release_info: None,
            imdb_rating: None,
            age_rating: None,
            status: None,
            runtime: None,
            genres: vec![],
            director: vec![],
            writer: vec![],
            cast: vec![],
            country: None,
            awards: None,
            language: None,
            website: None,
            default_video_id: None,
            videos,
            trailers: vec![],
        })
    }

    fn video(id: &str, season: i64, episode: i64, released: Option<&str>) -> MetaVideo {
        MetaVideo {
            id: id.into(),
            title: format!("Ep {episode}"),
            released: released.map(str::to_string),
            available: true,
            thumbnail: None,
            season: Some(season),
            episode: Some(episode),
            overview: None,
        }
    }

    #[test]
    fn civil_roundtrips_iso_day() {
        for date in ["1970-01-01", "2000-02-29", "2024-03-01", "2026-11-27", "2027-01-05"] {
            let day = iso_day(date).expect("valid date");
            assert_eq!(civil_from_days(day), date);
        }
    }

    #[test]
    fn builds_filtered_sorted_calendar_with_watched_state() {
        let today = iso_day("2026-11-27").unwrap();
        let now_ms = today * DAY_MS + 3_600_000;
        let meta = sample_meta(
            "tt100",
            "Severance",
            vec![
                video("tt100:0:1", 0, 1, Some("2026-11-27")), // specials skipped
                video("tt100:2:1", 2, 1, Some("2026-10-01")), // outside past_days=30
                video("tt100:2:2", 2, 2, Some("2026-11-25")), // -2d (watched)
                video("tt100:2:3", 2, 3, Some("2026-11-29")), // +2d
                video("tt100:2:4", 2, 4, Some("2027-03-01")), // outside future_days=60
            ],
        );
        let watched = vec![WatchedItem {
            id: "tt100".into(),
            content_type: "series".into(),
            name: "Severance".into(),
            poster: None,
            release_info: None,
            season: Some(2),
            episode: Some(2),
            video_id: Some("tt100:2:2".into()),
            marked_at_epoch_ms: 1000,
        }];
        let view = build_calendar(&[("series".into(), "tt100".into(), meta)], &[], &watched, now_ms, 30, 60);
        assert_eq!(view.today, "2026-11-27");
        assert_eq!(view.tracked_series, 1);
        assert_eq!(view.episodes.len(), 2);
        assert_eq!(view.episodes[0].air_date, "2026-11-25");
        assert_eq!(view.episodes[0].days_from_today, -2);
        assert!(view.episodes[0].watched);
        assert_eq!(view.episodes[1].air_date, "2026-11-29");
        assert_eq!(view.episodes[1].days_from_today, 2);
        assert!(!view.episodes[1].watched);
    }
}
