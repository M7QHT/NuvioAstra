//! Manual check of the trailer resolver: `cargo run -p nuvio-core --example yt_resolve -- <id or URL>`.
//! Prints the mode and hosts only (signed URLs are not printed).
#[tokio::main]
async fn main() {
    let id = std::env::args().nth(1).expect("id");
    let t = std::time::Instant::now();
    let e = nuvio_core::youtube::Extractor::new().unwrap();
    match e.resolve(&id).await {
        Ok(s) => {
            let host = |u: &str| u.split('/').nth(2).unwrap_or("").to_string();
            println!("ok em {:.1}s: modo {} altura {} vídeo {} áudio {:?}", t.elapsed().as_secs_f32(), s.mode, s.height, host(&s.video_url), s.audio_url.as_deref().map(host));
        }
        Err(e) => println!("erro: {e}"),
    }
}
