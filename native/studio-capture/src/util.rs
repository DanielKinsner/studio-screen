use std::io::Write;
use std::sync::OnceLock;
use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

/// Lets COM/WinRT handles cross into callbacks that run on other threads.
/// The D3D device is multithread-protected, which is what makes this sound.
pub struct SendBox<T>(pub T);
unsafe impl<T> Send for SendBox<T> {}
unsafe impl<T> Sync for SendBox<T> {}
impl<T> SendBox<T> {
    /// Borrow through the box so closures capture the whole (Send) box.
    pub fn get(&self) -> &T {
        &self.0
    }
}

/// QueryPerformanceCounter in 100 ns units: the clock shared by Windows
/// Graphics Capture frame times, WASAPI packet positions and input hooks.
pub fn qpc() -> i64 {
    static FREQ: OnceLock<i64> = OnceLock::new();
    let freq = *FREQ.get_or_init(|| {
        let mut f = 0i64;
        unsafe {
            let _ = QueryPerformanceFrequency(&mut f);
        }
        f.max(1)
    });
    let mut c = 0i64;
    unsafe {
        let _ = QueryPerformanceCounter(&mut c);
    }
    ((c as i128) * 10_000_000 / (freq as i128)) as i64
}

/// One JSON object per line on stdout; Electron reads these.
pub fn emit(value: serde_json::Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}
