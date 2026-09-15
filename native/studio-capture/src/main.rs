//! Studio Screen capture helper.
//!
//! `studio-capture record <json>` records until "stop" arrives on stdin (or
//! stdin closes because the app went away), writing:
//!   - a fragmented MP4 (hardware H.264 + AAC system audio, one shared clock),
//!   - a JSON-lines event log: pointer, clicks, wheel, shortcuts, typing
//!     activity (never key text), cursor shape, and screen-change activity.
//! Progress is reported as JSON lines on stdout. `studio-capture check` prints
//! what this PC supports.
mod audio;
mod audio_timeline;
mod capture;
mod encoder;
mod input;
mod util;

use serde::Deserialize;
use serde_json::json;
use std::collections::HashSet;
use std::io::{BufRead, BufWriter, Write};
use std::sync::mpsc::{channel, Receiver, TryRecvError};
use std::time::{Duration, Instant};
use util::{emit, qpc};
use windows::core::Result;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::Media::MediaFoundation::{MFStartup, MFSTARTUP_FULL, MF_VERSION};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows::Win32::UI::HiDpi::*;
use windows::Win32::UI::WindowsAndMessaging::IsWindow;

#[derive(Deserialize)]
struct PointConfig {
    x: i32,
    y: i32,
}
#[derive(Deserialize)]
struct RegionConfig {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
#[derive(Deserialize)]
struct Config {
    output: String,
    events: String,
    /// Any physical-pixel point on the monitor to record.
    monitor: Option<PointConfig>,
    /// HWND of the window to record.
    window: Option<i64>,
    region: Option<RegionConfig>,
    #[serde(default = "sixty")]
    fps: u32,
    #[serde(default = "yes")]
    audio: bool,
    /// Bake the cursor into the pixels (tests use this as a control).
    #[serde(default)]
    cursor: bool,
    /// Warm everything up, report "ready", and start only on "begin" (the app
    /// runs its countdown in between).
    #[serde(default)]
    armed: bool,
    /// Process id of the app; if it disappears the take is finished at once.
    #[serde(default)]
    parent: Option<u32>,
    /// Shift system audio against the picture (positive = later), in ms.
    #[serde(default, rename = "audioOffsetMs")]
    audio_offset_ms: f64,
}
fn sixty() -> u32 {
    60
}
fn yes() -> bool {
    true
}

enum Command {
    Begin,
    Pause,
    Resume,
    Stop,
}

fn commands(parent: Option<u32>) -> Receiver<Command> {
    let (tx, rx) = channel();
    if let Some(pid) = parent {
        // stdin can stay open after a crash if another process inherited the
        // pipe, so also watch the app process itself.
        let tx = tx.clone();
        std::thread::spawn(move || unsafe {
            use windows::Win32::System::Threading::{
                OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE,
            };
            if let Ok(handle) = OpenProcess(PROCESS_SYNCHRONIZE, false, pid) {
                WaitForSingleObject(handle, INFINITE);
                let _ = windows::Win32::Foundation::CloseHandle(handle);
                let _ = tx.send(Command::Stop);
            }
        });
    }
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            let Ok(line) = line else { break };
            let command = match line.trim() {
                "pause" => Command::Pause,
                "resume" => Command::Resume,
                "stop" => Command::Stop,
                "begin" => Command::Begin,
                _ => continue,
            };
            if tx.send(command).is_err() {
                return;
            }
        }
        // stdin closed: the app is gone, so finish the file cleanly.
        let _ = tx.send(Command::Stop);
    });
    rx
}

fn key_label(vk: u32) -> Option<String> {
    Some(match vk {
        0x30..=0x39 | 0x41..=0x5A => char::from_u32(vk)?.to_string(),
        0x70..=0x87 => format!("F{}", vk - 0x6F),
        0x20 => "Space".into(),
        0x0D => "Enter".into(),
        0x09 => "Tab".into(),
        0x1B => "Esc".into(),
        0x08 => "Backspace".into(),
        0x2E => "Delete".into(),
        0x25 => "←".into(),
        0x26 => "↑".into(),
        0x27 => "→".into(),
        0x28 => "↓".into(),
        0x24 => "Home".into(),
        0x23 => "End".into(),
        0x21 => "Page Up".into(),
        0x22 => "Page Down".into(),
        _ => return None,
    })
}
const CTRL: [u32; 3] = [0x11, 0xA2, 0xA3];
const ALT: [u32; 3] = [0x12, 0xA4, 0xA5];
const SHIFT: [u32; 3] = [0x10, 0xA0, 0xA1];
const WIN: [u32; 2] = [0x5B, 0x5C];
fn is_typing_key(vk: u32) -> bool {
    matches!(vk, 0x20 | 0x30..=0x39 | 0x41..=0x5A | 0x60..=0x6F | 0xBA..=0xC0 | 0xDB..=0xDF | 0xE2)
}

fn rect_of(target: &capture::Target) -> Option<RECT> {
    unsafe {
        match target {
            capture::Target::Monitor(h) => {
                let mut info = MONITORINFO {
                    cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                    ..Default::default()
                };
                GetMonitorInfoW(*h, &mut info).as_bool().then_some(info.rcMonitor)
            }
            capture::Target::Window(h) => {
                let mut rect = RECT::default();
                DwmGetWindowAttribute(
                    *h,
                    DWMWA_EXTENDED_FRAME_BOUNDS,
                    &mut rect as *mut RECT as _,
                    std::mem::size_of::<RECT>() as u32,
                )
                .ok()
                .map(|_| rect)
            }
        }
    }
}

fn check() {
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
        let _ = MFStartup(MF_VERSION, MFSTARTUP_FULL);
    }
    let supported =
        windows::Graphics::Capture::GraphicsCaptureSession::IsSupported().unwrap_or(false);
    let gpu = capture::gpu();
    emit(json!({
        "event": "check",
        "captureSupported": supported,
        "borderlessAccess": capture::request_borderless(),
        "dirtyRegions": capture::dirty_regions_supported(),
        "adapter": gpu.as_ref().map(|g| g.adapter.clone()).unwrap_or_default(),
        "hardwareH264": encoder::hardware_h264(),
        "loopbackAudio": audio::Loopback::open().is_ok(),
    }));
}

fn record(config: Config) -> Result<()> {
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        RoInitialize(RO_INIT_MULTITHREADED)?;
        MFStartup(MF_VERSION, MFSTARTUP_FULL)?;
    }
    let target = if let Some(h) = config.window {
        let hwnd = HWND(h as isize as *mut _);
        if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
            return Err(windows::core::Error::new(
                E_INVALIDARG,
                "The window to record is no longer open.",
            ));
        }
        capture::Target::Window(hwnd)
    } else {
        let p = config.monitor.as_ref().map(|p| (p.x, p.y)).unwrap_or((0, 0));
        capture::Target::Monitor(unsafe {
            MonitorFromPoint(POINT { x: p.0, y: p.1 }, MONITOR_DEFAULTTONEAREST)
        })
    };
    let borderless = capture::request_borderless();
    let gpu = capture::gpu()?;
    let region = config.region.as_ref().map(|r| [r.x, r.y, r.width, r.height]);
    let capture = capture::start(&gpu, &target, region, config.cursor)?;
    let crop = capture.crop;
    let fps = config.fps.clamp(10, 60);
    let loopback = if config.audio {
        audio::Loopback::open().ok()
    } else {
        None
    };
    let encoder = encoder::Encoder::create(
        &gpu,
        &config.output,
        crop.width,
        crop.height,
        fps,
        loopback.is_some(),
    )?;
    let mut events = BufWriter::new(std::fs::File::create(&config.events).map_err(|e| {
        windows::core::Error::new(E_FAIL, format!("Could not create the event log: {e}"))
    })?);
    let commands = commands(config.parent);
    let (hooks, inputs) = input::Hooks::start();

    // Start the clock on the first captured frame so t = 0 is a real picture.
    let waited = Instant::now();
    while capture.frames.lock().unwrap().latest.is_none() {
        if waited.elapsed() > Duration::from_secs(3) {
            hooks.stop();
            return Err(windows::core::Error::new(
                E_FAIL,
                "No picture arrived from the screen or window within 3 seconds.",
            ));
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    if config.armed {
        emit(json!({ "event": "ready", "width": crop.width, "height": crop.height }));
        loop {
            match commands.recv() {
                Ok(Command::Begin) => break,
                Ok(Command::Stop) | Err(_) => {
                    // Cancelled before anything was recorded.
                    hooks.stop();
                    let _ = capture.session.Close();
                    let _ = encoder.finalize();
                    let _ = events.flush();
                    drop(events);
                    let _ = std::fs::remove_file(&config.output);
                    let _ = std::fs::remove_file(&config.events);
                    emit(json!({ "event": "cancelled" }));
                    return Ok(());
                }
                _ => {}
            }
        }
        // Throw away pointer and key events from the warm-up.
        while inputs.try_recv().is_ok() {}
        capture.frames.lock().unwrap().changed = 0.0;
    }
    if let Some(l) = &loopback {
        l.start()?;
    }
    let base = qpc();
    emit(json!({
        "event": "started",
        "width": crop.width,
        "height": crop.height,
        "fps": fps,
        "audio": loopback.is_some(),
        "borderHidden": capture.border_hidden,
        "borderlessAccess": borderless,
        "dirtyRegions": capture.dirty_regions,
        "adapter": gpu.adapter,
    }));

    let interval = 10_000_000 / fps as i64;
    let audio_offset = (config.audio_offset_ms.clamp(-500.0, 500.0) * 10_000.0) as i64;
    let mut next_video = 0i64;
    let mut written = 0u64;
    let mut audio_next = 0i64;
    let mut paused_since: Option<i64> = None;
    let mut paused_total = 0i64;
    let mut pressed: HashSet<u32> = HashSet::new();
    let mut area = rect_of(&target);
    let mut area_checked = Instant::now();
    let mut last_move: Option<(i64, f64, f64)> = None;
    let mut pending_move: Option<(i64, f64, f64)> = None;
    let mut last_stats = Instant::now();
    let mut last_flush = Instant::now();
    let window = match &target {
        capture::Target::Window(h) => Some(h.0 as isize),
        _ => None,
    };
    let mut stop_reason = "stopped";
    let mut failure: Option<String> = None;
    let seconds = |t: i64| (t as f64 / 1e7 * 1000.0).round() / 1000.0;

    loop {
        match commands.try_recv() {
            Ok(Command::Pause) if paused_since.is_none() => {
                paused_since = Some(qpc());
                emit(json!({ "event": "paused" }));
            }
            Ok(Command::Resume) => {
                if let Some(since) = paused_since.take() {
                    paused_total += qpc() - since;
                    emit(json!({ "event": "resumed" }));
                }
            }
            Ok(Command::Stop) | Err(TryRecvError::Disconnected) => break,
            _ => {}
        }
        {
            let frames = capture.frames.lock().unwrap();
            if frames.closed {
                stop_reason = "window-closed";
                break;
            }
            if let Some(e) = &frames.error {
                failure = Some(e.clone());
            }
        }
        if failure.is_some() {
            break;
        }
        let paused = paused_since.is_some();
        // Recording time: QPC since start, minus time spent paused.
        let now = qpc() - base - paused_total - paused_since.map(|s| qpc() - s).unwrap_or(0);

        if let Some(l) = &loopback {
            let packets = l.drain()?;
            if !paused {
                for packet in packets {
                    let mut pcm = packet.pcm;
                    let mut time = packet.time - base - paused_total + audio_offset;
                    let length = pcm.len() as i64 / 4 * 10_000_000 / 48000;
                    if time + length <= audio_next {
                        continue;
                    }
                    if time < audio_next {
                        // Trim the part already written (e.g. right after a resume).
                        let skip = (((audio_next - time) * 48000 + 9_999_999) / 10_000_000) as usize;
                        if skip * 4 >= pcm.len() {
                            continue;
                        }
                        pcm.drain(0..skip * 4);
                        time = audio_next;
                    }
                    let gap = audio_timeline::gap_frames(audio_next, time);
                    if gap > 0 {
                        encoder.write_audio(&vec![0u8; gap * 4], audio_next)?;
                    }
                    audio_next = time + encoder.write_audio(&pcm, time)?;
                }
                // Loopback delivers nothing while no app plays sound: keep the
                // track moving, but only after a clear half second of quiet so
                // late-arriving real audio is never overwritten.
                let heard = now + audio_offset;
                if heard - audio_next > 5_000_000 {
                    let frames = ((heard - 3_000_000 - audio_next) * 48000 / 10_000_000) as usize;
                    audio_next += encoder.write_audio(&vec![0u8; frames * 4], audio_next)?;
                }
            }
        }

        if !paused {
            // Constant frame rate: each slot shows the newest captured picture.
            while now >= next_video {
                let (texture, changed) = {
                    let mut frames = capture.frames.lock().unwrap();
                    (frames.latest.clone(), std::mem::take(&mut frames.changed))
                };
                if let Some(texture) = texture {
                    encoder.write_video(&texture, next_video, interval)?;
                    written += 1;
                }
                if changed > 0.0 && capture.dirty_regions {
                    let _ = writeln!(
                        events,
                        "{}",
                        json!({ "t": seconds(next_video), "k": "f", "a": (changed * 10000.0).round() / 10000.0 })
                    );
                }
                next_video += interval;
            }
        }

        if area_checked.elapsed() > Duration::from_millis(100) {
            area = rect_of(&target).or(area);
            area_checked = Instant::now();
        }
        let normalize = |x: i32, y: i32| -> (f64, f64) {
            let Some(r) = area else { return (-1.0, -1.0) };
            let (w, h) = ((r.right - r.left).max(1) as f64, (r.bottom - r.top).max(1) as f64);
            let (mut nx, mut ny) = ((x - r.left) as f64 / w, (y - r.top) as f64 / h);
            if let Some([rx, ry, rw, rh]) = region {
                nx = (nx - rx) / rw.max(1e-6);
                ny = (ny - ry) / rh.max(1e-6);
            }
            ((nx * 100000.0).round() / 100000.0, (ny * 100000.0).round() / 100000.0)
        };
        let flush_move = |events: &mut BufWriter<std::fs::File>, pending: &mut Option<(i64, f64, f64)>, last: &mut Option<(i64, f64, f64)>| {
            if let Some((t, x, y)) = pending.take() {
                let _ = writeln!(events, "{}", json!({ "t": seconds(t), "k": "m", "x": x, "y": y }));
                *last = Some((t, x, y));
            }
        };
        loop {
            let event = match inputs.try_recv() {
                Ok(e) => e,
                Err(_) => break,
            };
            let event_time = |time: i64| time - base - paused_total;
            if paused {
                if let input::Event::Key { vk, down, .. } = event {
                    if down { pressed.insert(vk); } else { pressed.remove(&vk); }
                }
                continue;
            }
            match event {
                input::Event::Move { x, y, time } => {
                    let t = event_time(time);
                    if t < 0 { continue; }
                    let (nx, ny) = normalize(x, y);
                    pending_move = Some((t, nx, ny));
                    // At most 240 pointer samples a second.
                    if last_move.map(|(lt, _, _)| t - lt >= 41_666).unwrap_or(true) {
                        flush_move(&mut events, &mut pending_move, &mut last_move);
                    }
                }
                input::Event::Button { button, down, x, y, time } => {
                    let t = event_time(time);
                    if t < 0 { continue; }
                    flush_move(&mut events, &mut pending_move, &mut last_move);
                    let (nx, ny) = normalize(x, y);
                    let name = ["left", "right", "middle"][button as usize];
                    let _ = writeln!(events, "{}", json!({ "t": seconds(t), "k": if down { "d" } else { "u" }, "b": name, "x": nx, "y": ny }));
                }
                input::Event::Wheel { delta, horizontal, x, y, time } => {
                    let t = event_time(time);
                    if t < 0 { continue; }
                    let (nx, ny) = normalize(x, y);
                    let _ = writeln!(events, "{}", json!({ "t": seconds(t), "k": "w", "d": delta, "h": horizontal, "x": nx, "y": ny }));
                }
                input::Event::Key { vk, down, foreground, time } => {
                    let t = event_time(time);
                    if !down {
                        pressed.remove(&vk);
                        continue;
                    }
                    let repeat = !pressed.insert(vk);
                    // When recording one window, only its own keyboard activity counts.
                    if t < 0 || repeat || window.map(|w| w != foreground).unwrap_or(false) {
                        continue;
                    }
                    if CTRL.contains(&vk) || ALT.contains(&vk) || SHIFT.contains(&vk) || WIN.contains(&vk) {
                        continue;
                    }
                    let held = |keys: &[u32]| keys.iter().any(|k| pressed.contains(k));
                    let (ctrl, alt, shift, win) = (held(&CTRL), held(&ALT), held(&SHIFT), held(&WIN));
                    let function = (0x70..=0x87).contains(&vk);
                    if (ctrl || alt || win || function) && key_label(vk).is_some() {
                        let label = format!(
                            "{}{}{}{}{}",
                            if ctrl { "Ctrl + " } else { "" },
                            if alt { "Alt + " } else { "" },
                            if win { "Win + " } else { "" },
                            if shift { "Shift + " } else { "" },
                            key_label(vk).unwrap()
                        );
                        let _ = writeln!(events, "{}", json!({ "t": seconds(t), "k": "s", "s": label }));
                    } else if is_typing_key(vk) {
                        // Activity only: which key was pressed is never stored.
                        let _ = writeln!(events, "{}", json!({ "t": seconds(t), "k": "y" }));
                    }
                }
                input::Event::Cursor { shape, time } => {
                    let t = event_time(time).max(0);
                    let _ = writeln!(events, "{}", json!({ "t": seconds(t), "k": "c", "c": shape }));
                }
            }
        }
        if pending_move.map(|(t, _, _)| now - t > 41_666).unwrap_or(false) {
            flush_move(&mut events, &mut pending_move, &mut last_move);
        }

        if last_flush.elapsed() > Duration::from_millis(250) {
            let _ = events.flush();
            last_flush = Instant::now();
        }
        if last_stats.elapsed() > Duration::from_secs(1) {
            let captured = capture.frames.lock().unwrap().captured;
            emit(json!({ "event": "stats", "seconds": seconds(now), "frames": written, "captured": captured, "paused": paused }));
            last_stats = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(3));
    }

    // Close out both tracks at the same moment.
    let end = qpc() - base - paused_total - paused_since.map(|s| qpc() - s).unwrap_or(0);
    let last = capture.frames.lock().unwrap().latest.clone();
    if let Some(texture) = last {
        while next_video <= end {
            encoder.write_video(&texture, next_video, interval)?;
            written += 1;
            next_video += interval;
        }
    }
    if encoder.has_audio() && end > audio_next {
        let frames = ((next_video - audio_next) * 48000 / 10_000_000) as usize;
        audio_next += encoder.write_audio(&vec![0u8; frames * 4], audio_next)?;
    }
    if let Some(l) = &loopback {
        l.stop();
    }
    let _ = capture.session.Close();
    let _ = capture.pool.Close();
    hooks.stop();
    let _ = events.flush();
    encoder.finalize()?;
    if let Some(message) = failure {
        return Err(windows::core::Error::new(E_FAIL, message));
    }
    emit(json!({
        "event": "stopped",
        "reason": stop_reason,
        "seconds": seconds(next_video),
        "frames": written,
        "audioSeconds": seconds(audio_next),
    }));
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("check") => check(),
        Some("record") => {
            let config: Config = match args.get(2).map(|s| serde_json::from_str(s)) {
                Some(Ok(c)) => c,
                _ => {
                    emit(json!({ "event": "error", "message": "Invalid recording settings." }));
                    std::process::exit(2);
                }
            };
            if let Err(e) = record(config) {
                emit(json!({ "event": "error", "message": e.message() }));
                std::process::exit(1);
            }
        }
        _ => {
            eprintln!("usage: studio-capture check | record <json>");
            std::process::exit(2);
        }
    }
}
