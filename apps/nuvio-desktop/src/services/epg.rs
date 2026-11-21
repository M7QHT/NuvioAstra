//! Program guide (EPG) of a live channel, kept light on purpose.
//!
//! Channel addons have no EPG resource in the Stremio protocol; the ones that publish a schedule put
//! it in the channel's meta `description`, e.g. (BestCine):
//!
//! ```text
//! 🔴 AGORA (15:16 – 16:09): Caçadora de Relíquias
//! Durante uma turnê de palestras…
//!
//! ⏭️ 16:09 – 17:02 · Caçadora de Relíquias
//! 📅 17:02 – 17:55 · Caçadora de Relíquias
//! ```
//!
//! - Asked only for the channel the user picked, only to the addon that listed it, never in bulk.
//! - One request is reused until the current program ends (at least 2 min, at most 30 min).
//! - Programs already seen stay in memory, so the guide can also show what aired before (addons only
//!   publish "now" and "next"); the window is 6 h back and 24 h ahead, and at most 64 channels are
//!   kept. Nothing is written to disk.
//! - Times in the text are local wall-clock times; the interface passes its UTC offset.

use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

const MINUTE: i64 = 60_000;
const HOUR: i64 = 60 * MINUTE;
const DAY: i64 = 24 * HOUR;
pub const BACK: i64 = 6 * HOUR;
pub const AHEAD: i64 = 24 * HOUR;
const MAX_CHANNELS: usize = 64;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Program {
    pub start_ms: i64,
    pub end_ms: i64,
    pub title: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpgView {
    pub now_ms: i64,
    /// Programs inside the window (6 h back, 24 h ahead), oldest first.
    pub programs: Vec<Program>,
    /// The addon publishes a schedule for this channel.
    pub has_schedule: bool,
}

/// One schedule line of the text: minutes of the day, title, "now" mark.
#[derive(Debug, Clone, PartialEq)]
struct Line {
    start: i64,
    end: i64,
    title: String,
    description: Vec<String>,
    now: bool,
}

/// `HH:MM – HH:MM` (en dash, em dash or hyphen) anywhere in the line: (start, end, rest of the line).
fn time_range(line: &str) -> Option<(i64, i64, &str)> {
    let b = line.as_bytes();
    let clock = |i: usize| -> Option<(i64, usize)> {
        let mut j = i;
        let mut h = 0i64;
        let mut digits = 0;
        while j < b.len() && b[j].is_ascii_digit() && digits < 2 {
            h = h * 10 + (b[j] - b'0') as i64;
            j += 1;
            digits += 1;
        }
        if digits == 0 || j + 2 >= b.len() || b[j] != b':' || !b[j + 1].is_ascii_digit() || !b[j + 2].is_ascii_digit() {
            return None;
        }
        let m = ((b[j + 1] - b'0') * 10 + (b[j + 2] - b'0')) as i64;
        (h < 24 && m < 60).then_some((h * 60 + m, j + 3))
    };
    for i in 0..b.len() {
        if !b[i].is_ascii_digit() || (i > 0 && b[i - 1].is_ascii_digit()) {
            continue;
        }
        let Some((start, after)) = clock(i) else { continue };
        let rest = &line[after..];
        let trimmed = rest.trim_start();
        let sep = ["–", "—", "-"].iter().find(|s| trimmed.starts_with(**s))?;
        let tail = trimmed[sep.len()..].trim_start();
        let offset = line.len() - tail.len();
        let (end, after_end) = clock(offset)?;
        return Some((start, end, &line[after_end..]));
    }
    None
}

fn parse_lines(text: &str) -> Vec<Line> {
    let mut out: Vec<Line> = Vec::new();
    let mut in_description = false;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            in_description = false;
            continue;
        }
        if let Some((start, end, rest)) = time_range(line) {
            let title = rest.trim_start_matches(|c: char| c == ')' || c == ':' || c == '·' || c == '-' || c == '–' || c.is_whitespace()).trim().to_string();
            let now = line.to_lowercase().contains("agora");
            if !title.is_empty() {
                out.push(Line { start, end, title, description: Vec::new(), now });
                in_description = true;
            }
            continue;
        }
        // Channel information lines ("📺 Canal ao vivo…") are not part of a program.
        if line.starts_with('📺') || line.to_lowercase().starts_with("canal ao vivo") {
            in_description = false;
            continue;
        }
        if in_description {
            if let Some(last) = out.last_mut() {
                last.description.push(line.to_string());
            }
        }
    }
    out
}

/// Turns the text into programs with absolute times (UTC ms). `offset_min` is the interface's
/// `Date.getTimezoneOffset()` (minutes to add to local time to get UTC).
pub fn parse_schedule(text: &str, now_ms: i64, offset_min: i64) -> Vec<Program> {
    let lines = parse_lines(text);
    if lines.is_empty() {
        return Vec::new();
    }
    let offset = offset_min * MINUTE;
    let local_now = now_ms - offset;
    let day_start = local_now.div_euclid(DAY) * DAY;
    // Anchor: the "now" line (else the first one) is the occurrence of its time closest to now.
    let anchor = lines.iter().position(|l| l.now).unwrap_or(0);
    let mut base = day_start;
    let first = day_start + lines[anchor].start * MINUTE;
    if first - local_now > 12 * HOUR {
        base -= DAY;
    } else if local_now - first > 12 * HOUR {
        base += DAY;
    }
    let mut starts = vec![0i64; lines.len()];
    starts[anchor] = base + lines[anchor].start * MINUTE;
    for i in anchor + 1..lines.len() {
        let mut s = starts[i - 1] - lines[i - 1].start * MINUTE + lines[i].start * MINUTE;
        if s < starts[i - 1] {
            s += DAY;
        }
        starts[i] = s;
    }
    for i in (0..anchor).rev() {
        let mut s = starts[i + 1] - lines[i + 1].start * MINUTE + lines[i].start * MINUTE;
        if s > starts[i + 1] {
            s -= DAY;
        }
        starts[i] = s;
    }
    lines
        .into_iter()
        .zip(starts)
        .map(|(l, start)| {
            let mut end = start - l.start * MINUTE + l.end * MINUTE;
            if end <= start {
                end += DAY;
            }
            Program {
                start_ms: start + offset,
                end_ms: end + offset,
                title: l.title,
                description: (!l.description.is_empty()).then(|| l.description.join(" ")),
            }
        })
        .collect()
}

#[derive(Default)]
struct ChannelGuide {
    programs: BTreeMap<i64, Program>,
    valid_until: i64,
    used_at: i64,
    has_schedule: bool,
}

/// In-memory guide of the channels the user opened.
#[derive(Default)]
pub struct EpgStore {
    channels: Mutex<HashMap<String, ChannelGuide>>,
}

impl EpgStore {
    /// The cached guide when it is still valid.
    pub fn cached(&self, key: &str, now_ms: i64) -> Option<EpgView> {
        let mut map = self.channels.lock().expect("epg lock");
        let g = map.get_mut(key).filter(|g| g.valid_until > now_ms)?;
        g.used_at = now_ms;
        Some(view(g, now_ms))
    }

    /// Merges a fresh schedule: what the addon sends now replaces what it sent before from its first
    /// program on; earlier programs (already aired) are kept.
    pub fn update(&self, key: &str, fresh: Vec<Program>, now_ms: i64) -> EpgView {
        let mut map = self.channels.lock().expect("epg lock");
        if !map.contains_key(key) && map.len() >= MAX_CHANNELS {
            if let Some(oldest) = map.iter().min_by_key(|(_, g)| g.used_at).map(|(k, _)| k.clone()) {
                map.remove(&oldest);
            }
        }
        let g = map.entry(key.to_string()).or_default();
        if let Some(first) = fresh.first().map(|p| p.start_ms) {
            g.programs.retain(|start, p| *start < first && p.end_ms <= first);
        }
        for p in fresh {
            g.programs.insert(p.start_ms, p);
        }
        g.programs.retain(|_, p| p.end_ms > now_ms - BACK && p.start_ms < now_ms + AHEAD);
        g.has_schedule = !g.programs.is_empty();
        let current_end = g.programs.values().find(|p| p.start_ms <= now_ms && now_ms < p.end_ms).map(|p| p.end_ms);
        g.valid_until = current_end.unwrap_or(now_ms + 10 * MINUTE).clamp(now_ms + 2 * MINUTE, now_ms + 30 * MINUTE);
        g.used_at = now_ms;
        view(g, now_ms)
    }
}

fn view(g: &ChannelGuide, now_ms: i64) -> EpgView {
    EpgView {
        now_ms,
        programs: g.programs.values().filter(|p| p.end_ms > now_ms - BACK && p.start_ms < now_ms + AHEAD).cloned().collect(),
        has_schedule: g.has_schedule,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXT: &str = "🔴 AGORA (15:16 – 16:09): Caçadora de Relíquias\nDurante uma turnê de palestras.\n\n⏭️ 16:09 – 17:02 · Caçadora de Relíquias\n📅 17:02 – 17:55 · Outro Programa\n📅 23:30 – 00:20 · Madrugada\n\n📺 Canal ao vivo em HD — Séries";

    /// 2026-11-21 15:30 in UTC-3 (offset +180 min).
    fn now() -> i64 {
        // 2026-11-21T18:30:00Z
        1_795_285_800_000
    }

    #[test]
    fn parses_the_addon_schedule() {
        let p = parse_schedule(TEXT, now(), 180);
        assert_eq!(p.len(), 4);
        assert_eq!(p[0].title, "Caçadora de Relíquias");
        assert_eq!(p[0].description.as_deref(), Some("Durante uma turnê de palestras."));
        assert!(p[0].start_ms <= now() && now() < p[0].end_ms, "current program contains now");
        assert_eq!((p[0].end_ms - p[0].start_ms) / MINUTE, 53);
        assert_eq!(p[1].start_ms, p[0].end_ms);
        assert_eq!(p[2].title, "Outro Programa");
        // Crosses midnight: ends the next day.
        assert_eq!((p[3].end_ms - p[3].start_ms) / MINUTE, 50);
        assert!(p.iter().all(|x| x.description.is_none() || x.title == "Caçadora de Relíquias"));
    }

    #[test]
    fn text_without_schedule_gives_nothing() {
        assert!(parse_schedule("Canal ao vivo • Grupo: Canais Abertos", now(), 180).is_empty());
        assert!(parse_schedule("", now(), 180).is_empty());
    }

    #[test]
    fn keeps_what_already_aired_and_respects_the_window() {
        let store = EpgStore::default();
        let first = parse_schedule(TEXT, now(), 180);
        store.update("c", first.clone(), now());
        // Two hours later the addon only sends from 17:02 on.
        let later = now() + 2 * HOUR;
        let text = "🔴 AGORA (17:02 – 17:55): Outro Programa\n📅 17:55 – 18:48 · Mais um";
        let v = store.update("c", parse_schedule(text, later, 180), later);
        let titles: Vec<&str> = v.programs.iter().map(|p| p.title.as_str()).collect();
        assert_eq!(titles, vec!["Caçadora de Relíquias", "Caçadora de Relíquias", "Outro Programa", "Mais um"]);
        // Still cached until the current program ends; then a new request is needed.
        assert!(store.cached("c", later + MINUTE).is_some());
        assert!(store.cached("c", later + HOUR).is_none());
        // Far later, the old programs leave the 6 h window.
        let much_later = now() + 9 * HOUR;
        let v = store.update("c", Vec::new(), much_later);
        assert!(v.programs.iter().all(|p| p.end_ms > much_later - BACK));
    }

    #[test]
    fn at_most_64_channels_are_kept() {
        let store = EpgStore::default();
        for i in 0..70 {
            store.update(&format!("c{i}"), parse_schedule(TEXT, now(), 180), now() + i);
        }
        assert_eq!(store.channels.lock().unwrap().len(), MAX_CHANNELS);
        assert!(store.cached("c0", now() + 100).is_none(), "least recently used dropped");
    }
}
