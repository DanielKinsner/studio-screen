#![allow(dead_code)]
// Audio clock probe: no screen capture, no sound, no input. Something must be
// playing (silence is enough) so the loopback delivers packets. Logs every
// WASAPI packet for N seconds, reports the device clock against QPC, and
// replays both the current alignment (`audio_timeline::align`) and the
// pre-fix arithmetic on the same packets so the sample loss is visible.
// Usage: audio-clock-probe <seconds> <out.csv>
#[path = "../src/audio.rs"]
mod audio;
#[path = "../src/audio_timeline.rs"]
mod audio_timeline;
#[path = "../src/util.rs"]
mod util;
use std::io::Write;
use windows::Win32::System::WinRT::*;

fn main() -> windows::core::Result<()> {
    unsafe {
        RoInitialize(RO_INIT_MULTITHREADED)?;
    }
    let args: Vec<String> = std::env::args().collect();
    let seconds: f64 = args[1].parse().unwrap();
    let mut csv = std::fs::File::create(&args[2]).unwrap();
    writeln!(csv, "qpc100ns,frames,silent").unwrap();
    let loopback = audio::Loopback::open()?;
    loopback.start()?;
    let base = util::qpc();
    let mut audio_next = 0i64;
    let (mut new_next, mut new_written, mut new_dropped, mut new_filled) = (0i64, 0u64, 0u64, 0u64);
    let (mut packets, mut frames_total, mut dropped, mut filled, mut trims, mut gaps) =
        (0u64, 0u64, 0u64, 0u64, 0u64, 0u64);
    let mut first: Option<i64> = None;
    let mut last: i64 = 0;
    let mut last_frames = 0u64;
    while (util::qpc() - base) as f64 / 1e7 < seconds {
        for packet in loopback.drain()? {
            let n = packet.pcm.len() as i64 / 4;
            let silent = packet.pcm.iter().all(|&b| b == 0);
            writeln!(csv, "{},{},{}", packet.time, n, silent as u8).unwrap();
            packets += 1;
            frames_total += n as u64;
            if first.is_none() {
                first = Some(packet.time);
            }
            last = packet.time;
            last_frames = n as u64;
            // Replay the new alignment (audio_timeline::align).
            {
                let mut t = packet.time - base;
                let mut f = n as usize;
                match audio_timeline::align(new_next, t, f) {
                    audio_timeline::Align::Drop => { new_dropped += f as u64; f = 0; }
                    audio_timeline::Align::Contiguous => t = new_next,
                    audio_timeline::Align::Trim(skip) => { new_dropped += skip as u64; f -= skip; t = new_next; }
                    audio_timeline::Align::Fill(gap) => { new_filled += gap as u64; new_next += gap as i64 * 10_000_000 / 48000; }
                }
                if f > 0 { new_written += f as u64; new_next = t + f as i64 * 10_000_000 / 48000; }
            }
            // Replay the old main.rs arithmetic exactly.
            let mut time = packet.time - base;
            let mut len = n;
            let length = len * 10_000_000 / 48000;
            if time + length <= audio_next {
                dropped += n as u64;
                continue;
            }
            if time < audio_next {
                let skip = ((audio_next - time) * 48000 + 9_999_999) / 10_000_000;
                if skip >= len {
                    dropped += n as u64;
                    continue;
                }
                dropped += skip as u64;
                trims += 1;
                len -= skip;
                time = audio_next;
            }
            let gap = audio_timeline::gap_frames(audio_next, time) as i64;
            if gap > 0 {
                filled += gap as u64;
                gaps += 1;
            }
            audio_next = time + len * 10_000_000 / 48000;
        }
        std::thread::sleep(std::time::Duration::from_millis(3));
    }
    loopback.stop();
    let span = (last - first.unwrap()) as f64 / 1e7;
    let device_frames = (frames_total - last_frames) as f64;
    println!(
        "packets={} frames={} span_s={:.6} device_rate_vs_qpc={:.2} Hz (48000 nominal) ratio={:.7}",
        packets,
        frames_total,
        span,
        device_frames / span,
        device_frames / span / 48000.0
    );
    println!(
        "new align replay: written={} dropped={} filled={} net={:+.2} samples/s",
        new_written, new_dropped, new_filled,
        (new_filled as f64 - new_dropped as f64) / span
    );
    println!(
        "old helper replay: trims={} dropped_samples={} ({:.1}/s) gaps={} filled_samples={} ({:.1}/s) net={:+.1} samples/s",
        trims,
        dropped,
        dropped as f64 / span,
        gaps,
        filled,
        filled as f64 / span,
        (filled as f64 - dropped as f64) / span
    );
    Ok(())
}
