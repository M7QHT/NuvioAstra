//! Startup timeline of a PUBLIC test URL: every mpv log line (level `v`) with its time since
//! `loadfile`, until the first decoded frame. Shows where the time goes (connection, playlist,
//! variant playlists, segments, decoder). Do not use with addon URLs: log lines contain URLs.
//!
//! Usage: NUVIO_LIBMPV=<libmpv-2.dll> cargo run --release -p nuvio-player --example stream_timeline -- <url> [hwdec]

use nuvio_player::mpv::*;
use std::ffi::CStr;
use std::time::{Duration, Instant};

fn main() {
    let mut args = std::env::args().skip(1);
    let url = args.next().expect("url");
    let hwdec = args.next().unwrap_or_else(|| "no".into());
    let api = MpvApi::load(std::path::Path::new(&std::env::var("NUVIO_LIBMPV").expect("NUVIO_LIBMPV"))).expect("libmpv");
    let mpv = Mpv::create(api).expect("create");
    for (k, v) in [
        ("config", "no"), ("terminal", "no"), ("vo", "null"), ("ao", "null"), ("hwdec", hwdec.as_str()),
        ("demuxer-max-bytes", "150MiB"), ("demuxer-max-back-bytes", "50MiB"), ("demuxer-seekable-cache", "yes"),
        ("stream-lavf-o", "reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_on_http_error=%23%408,429,500,502,503,504,reconnect_delay_max=15"),
    ] {
        mpv.set_option(k, v).expect(k);
    }
    mpv.initialize().expect("init");
    mpv.request_log_messages("v").expect("log");
    let start = Instant::now();
    mpv.command(&["loadfile", &url]).expect("loadfile");
    let mut opened_urls = 0usize;
    while start.elapsed() < Duration::from_secs(60) {
        // SAFETY: single waiting thread.
        let event = unsafe { &*mpv.wait_event(0.05) };
        let t = start.elapsed().as_millis();
        match event.event_id {
            EVENT_LOG_MESSAGE if !event.data.is_null() => {
                // SAFETY: LOG_MESSAGE carries an mpv_event_log_message.
                let m = unsafe { &*(event.data as *const MpvEventLogMessage) };
                let prefix = unsafe { CStr::from_ptr(m.prefix) }.to_string_lossy();
                let text = unsafe { CStr::from_ptr(m.text) }.to_string_lossy().trim_end().to_string();
                if text.contains("Opening '") || text.contains("HTTP") && text.contains("Opening") {
                    opened_urls += 1;
                }
                let short: String = text.chars().take(150).collect();
                println!("{t:>6} ms  [{prefix}] {short}");
            }
            EVENT_FILE_LOADED => println!("{t:>6} ms  >>> FILE_LOADED"),
            EVENT_PLAYBACK_RESTART => println!("{t:>6} ms  >>> PLAYBACK_RESTART"),
            EVENT_END_FILE => {
                println!("{t:>6} ms  >>> END_FILE (error {})", event.error);
                break;
            }
            _ => {}
        }
        if mpv.get_f64("time-pos").is_some_and(|p| p > 0.0) {
            println!("{t:>6} ms  >>> FIRST FRAME (time-pos > 0), hwdec-current={:?}, codec={:?}, url opens logged={opened_urls}",
                mpv.get_string("hwdec-current"), mpv.get_string("video-codec"));
            break;
        }
    }
}
