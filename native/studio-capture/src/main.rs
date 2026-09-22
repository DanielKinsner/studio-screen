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
mod keys;
mod util;
mod video_timeline;

use serde::Deserialize;
use serde_json::json;
use std::collections::HashSet;
use std::io::{BufRead, BufWriter, Write};
use std::sync::mpsc::{channel, Receiver, TryRecvError};
use std::time::{Duration, Instant};
use util::{emit, qpc};
use windows::core::Result;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;
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
    let interval = 10_000_000 / fps as i64;
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
    while capture.frames.lock().unwrap().queue.is_empty() {
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
        // Throw away pointer and key events from the warm-up. Warm-up frames
        // stay queued: the newest one is the picture at t = 0.
        while inputs.try_recv().is_ok() {}
    }
    if let Some(l) = &loopback {
        l.start()?;
    }
    // t = 0 sits half a slot before a screen refresh, so refreshes land
    // mid-slot instead of on a boundary (see video_timeline).
    let base = {
        let frames = capture.frames.lock().unwrap();
        let stamp = frames.queue.back().map(|(t, _, _)| *t).unwrap_or_else(qpc);
        video_timeline::aligned_base(qpc(), stamp, interval)
    };
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

    let audio_offset = (config.audio_offset_ms.clamp(-500.0, 500.0) * 10_000.0) as i64;
    let mut slots: video_timeline::Slotter<ID3D11Texture2D> = video_timeline::Slotter::new(interval);
    // STUDIO_CAPTURE_TRACE=1 prints every frame stamp and slot to stderr (cadence diagnosis).
    let trace = std::env::var_os("STUDIO_CAPTURE_TRACE").is_some();
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
                    match audio_timeline::align(audio_next, time, pcm.len() / 4) {
                        audio_timeline::Align::Drop => continue,
                        // The stream is continuous; the stamp only jittered.
                        audio_timeline::Align::Contiguous => time = audio_next,
                        // Trim the part already written (e.g. right after a resume).
                        audio_timeline::Align::Trim(skip) => {
                            pcm.drain(0..skip * 4);
                            time = audio_next;
                        }
                        audio_timeline::Align::Fill(gap) => {
                            encoder.write_audio(&vec![0u8; gap * 4], audio_next)?;
                        }
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

        // Constant frame rate, filled by each frame's own capture time.
        let batch: Vec<_> = capture.frames.lock().unwrap().queue.drain(..).collect();
        for (stamp, texture, changed) in batch {
            if paused {
                slots.set_current(texture, 0.0);
                continue;
            }
            let t = stamp - base - paused_total;
            if trace {
                eprintln!("F {t} {changed:.4} {}", now - t);
            }
            slots.push(t, texture, if t < 0 { 0.0 } else { changed });
        }
        if !paused {
            for slot in slots.due(now) {
                if trace {
                    eprintln!("S {} {} {:.4}", slot.time, slot.fresh as u8, slot.changed);
                }
                if let Some(texture) = &slot.frame {
                    encoder.write_video(texture, slot.time, interval)?;
                    written += 1;
                }
                if slot.changed > 0.0 && capture.dirty_regions {
                    let _ = writeln!(
                        events,
                        "{}",
                        json!({ "t": seconds(slot.time), "k": "f", "a": (slot.changed * 10000.0).round() / 10000.0 })
                    );
                }
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
                    match keys::classify(vk, &pressed) {
                        keys::Key::Shortcut(label) => {
                            let _ = writeln!(events, "{}", json!({ "t": seconds(t), "k": "s", "s": label }));
                        }
                        // Activity only: which key was pressed is never stored.
                        keys::Key::Typing => {
                            let _ = writeln!(events, "{}", json!({ "t": seconds(t), "k": "y" }));
                        }
                        keys::Key::Modifier | keys::Key::Other => {}
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
            let (captured, dropped) = {
                let f = capture.frames.lock().unwrap();
                (f.captured, f.dropped)
            };
            emit(json!({ "event": "stats", "seconds": seconds(now), "frames": written, "captured": captured, "dropped": dropped, "paused": paused }));
            last_stats = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(3));
    }

    // Close out both tracks at the same moment.
    let end = qpc() - base - paused_total - paused_since.map(|s| qpc() - s).unwrap_or(0);
    let batch: Vec<_> = capture.frames.lock().unwrap().queue.drain(..).collect();
    for (stamp, texture, changed) in batch {
        slots.push(stamp - base - paused_total, texture, changed);
    }
    for slot in slots.flush(end) {
        if let Some(texture) = &slot.frame {
            encoder.write_video(texture, slot.time, interval)?;
            written += 1;
        }
    }
    let next_video = slots.next_slot();
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
    let (captured, dropped) = {
        let f = capture.frames.lock().unwrap();
        (f.captured, f.dropped)
    };
    emit(json!({
        "event": "stopped",
        "reason": stop_reason,
        "seconds": seconds(next_video),
        "frames": written,
        "captured": captured,
        "dropped": dropped,
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
