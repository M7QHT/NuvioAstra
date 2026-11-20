//! Measures time-to-first-frame of a URL with different mpv option sets (no window: vo/ao null).
//!
//! Usage: cargo run --release -p nuvio-player --example startup_bench -- <url> [runs]
//! Requires NUVIO_LIBMPV=<path to libmpv-2.dll>.

use nuvio_player::mpv::{Mpv, MpvApi, EVENT_END_FILE, EVENT_SHUTDOWN};
use std::time::{Duration, Instant};

fn first_frame(api: &std::sync::Arc<MpvApi>, url: &str, extra: &[(&str, &str)]) -> Result<Duration, String> {
    let mpv = Mpv::create(api.clone()).map_err(|e| e.to_string())?;
    // Same network/demuxer options as the embedded player, without video/audio output.
    for (k, v) in [
        ("config", "no"), ("terminal", "no"), ("vo", "null"), ("ao", "null"), ("hwdec", "no"),
        ("demuxer-max-bytes", "150MiB"), ("demuxer-max-back-bytes", "50MiB"), ("demuxer-seekable-cache", "yes"),
        ("stream-lavf-o", "reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_on_http_error=%23%408,429,500,502,503,504,reconnect_delay_max=15"),
    ] {
        mpv.set_option(k, v).map_err(|e| e.to_string())?;
    }
    for (k, v) in extra {
        mpv.set_option(k, v).map_err(|e| e.to_string())?;
    }
    mpv.initialize().map_err(|e| e.to_string())?;
    let start = Instant::now();
    mpv.command(&["loadfile", url]).map_err(|e| e.to_string())?;
    while start.elapsed() < Duration::from_secs(60) {
        // SAFETY: single waiting thread.
        let event = unsafe { &*mpv.wait_event(0.05) };
        if event.event_id == EVENT_SHUTDOWN || event.event_id == EVENT_END_FILE {
            return Err("ended before first frame".into());
        }
        if mpv.get_f64("time-pos").is_some_and(|t| t > 0.0) {
            return Ok(start.elapsed());
        }
    }
    Err("timeout".into())
}

fn main() {
    let mut args = std::env::args().skip(1);
    let url = args.next().expect("url");
    let runs: usize = args.next().and_then(|v| v.parse().ok()).unwrap_or(3);
    let path = std::env::var("NUVIO_LIBMPV").expect("NUVIO_LIBMPV");
    let api = MpvApi::load(std::path::Path::new(&path)).expect("load libmpv");
    let variants: &[(&str, &[(&str, &str)])] = &[
        ("current options", &[]),
        ("demuxer-lavf-probe-info=nostreams", &[("demuxer-lavf-probe-info", "nostreams")]),
    ];
    for round in 0..runs {
        for (label, extra) in variants {
            match first_frame(&api, &url, extra) {
                Ok(d) => println!("round {round} | {label:<36} | first frame {:>6} ms", d.as_millis()),
                Err(e) => println!("round {round} | {label:<36} | failed: {e}"),
            }
        }
    }
}
