//! Manual check of the engine with a freely licensed torrent: metadata, file selection, a few MB
//! read through the local HTTP route (as the player does), statistics, full stop.
//! `cargo run -p nuvio-p2p --example p2p_smoke -- <engine dll> <work dir> <info hash> [bytes]`
use nuvio_p2p::*;
use std::io::{Read, Write};
use std::time::Instant;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (dll, work, hash) = (std::path::PathBuf::from(&a[1]), std::path::PathBuf::from(&a[2]), a[3].clone());
    let want: usize = a.get(4).and_then(|v| v.parse().ok()).unwrap_or(4 << 20);
    let config = EngineConfig { data_dir: work.join("state"), cache_dir: work.join("cache"), disk_cache_bytes: 2 << 30, upload: true, profile: 1 };
    let api = load_api(&dll).unwrap();
    println!("api {}", unsafe { (api.api_version)() });
    let svc = P2pService::default();
    let t = Instant::now();
    let req = StreamRequest { info_hash: hash, file_index: None, filename: None, trackers: vec!["wss://tracker.webtorrent.dev".into(), "udp://tracker.leechers-paradise.org:6969".into()] };
    let p = std::thread::scope(|s| {
        let h = s.spawn(|| svc.start(&dll, &config, &req));
        while !h.is_finished() { std::thread::sleep(std::time::Duration::from_secs(3)); let st = svc.refresh(); println!("{:>5.1}s {} {} peers {} seeds {}", t.elapsed().as_secs_f32(), st.state, st.phase, st.peers, st.seeds); }
        h.join().unwrap()
    });
    let p = match p { Ok(p) => p, Err(e) => { println!("ERRO {e}"); return; } };
    println!("pronto em {:.1}s: arquivo '{}' idx {} de {} arquivos, {} bytes, url local {}", t.elapsed().as_secs_f32(), p.file_name, p.file_index, p.file_count, p.file_size, p.url.starts_with("http://127.0.0.1"));
    // Read like a player: HTTP GET with a range.
    let rest = p.url.strip_prefix("http://").unwrap();
    let (host, path) = rest.split_once('/').unwrap();
    let mut c = std::net::TcpStream::connect(host).unwrap();
    write!(c, "GET /{path} HTTP/1.1\r\nHost: {host}\r\nRange: bytes=0-{}\r\nConnection: close\r\n\r\n", want - 1).unwrap();
    let mut buf = vec![0u8; 64 << 10];
    let mut got = 0usize;
    let mut head = Vec::new();
    let t2 = Instant::now();
    loop { let n = c.read(&mut buf).unwrap(); if n == 0 { break; } if head.len() < 512 { head.extend_from_slice(&buf[..n.min(512)]); } got += n; if got > want + 1024 { break; } }
    let status = String::from_utf8_lossy(&head).lines().next().unwrap_or("").to_string();
    println!("HTTP: {status}; {} bytes em {:.1}s", got, t2.elapsed().as_secs_f32());
    let body_start = head.windows(4).position(|w| w == b"\r\n\r\n").map(|i| i + 4).unwrap_or(0);
    println!("assinatura do arquivo: {:02x?}", &head[body_start..(body_start + 12).min(head.len())]);
    let st = svc.refresh();
    println!("stats: peers {} seeds {} down {} B/s baixado {} progresso {:.3}% pronto à frente {}", st.peers, st.seeds, st.download_speed, st.downloaded_bytes, st.total_progress * 100.0, st.ready_ahead_bytes);
    svc.stop();
    println!("parado: ativo={} estado={}", svc.is_active(), svc.status().state);
    std::thread::sleep(std::time::Duration::from_secs(2));
    // Threads of this process after the stop.
    println!("fim");
}
