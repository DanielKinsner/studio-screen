//! Low-level mouse and keyboard hooks plus cursor-shape polling, on their own
//! thread with a message loop. Callbacks only timestamp and forward events;
//! Windows silently removes hooks that take longer than a second.
use crate::util::qpc;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Mutex;
use std::thread::JoinHandle;
use windows::Win32::Foundation::*;
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::WindowsAndMessaging::*;

pub enum Event {
    Move { x: i32, y: i32, time: i64 },
    Button { button: u8, down: bool, x: i32, y: i32, time: i64 },
    Wheel { delta: i32, horizontal: bool, x: i32, y: i32, time: i64 },
    Key { vk: u32, down: bool, foreground: isize, time: i64 },
    Cursor { shape: &'static str, time: i64 },
}

static SENDER: Mutex<Option<Sender<Event>>> = Mutex::new(None);

fn send(event: Event) {
    if let Ok(guard) = SENDER.lock() {
        if let Some(tx) = guard.as_ref() {
            let _ = tx.send(event);
        }
    }
}

unsafe extern "system" fn mouse(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let time = qpc();
        let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        let (x, y) = (info.pt.x, info.pt.y);
        let message = wparam.0 as u32;
        match message {
            WM_MOUSEMOVE => send(Event::Move { x, y, time }),
            WM_LBUTTONDOWN | WM_LBUTTONUP => send(Event::Button {
                button: 0,
                down: message == WM_LBUTTONDOWN,
                x,
                y,
                time,
            }),
            WM_RBUTTONDOWN | WM_RBUTTONUP => send(Event::Button {
                button: 1,
                down: message == WM_RBUTTONDOWN,
                x,
                y,
                time,
            }),
            WM_MBUTTONDOWN | WM_MBUTTONUP => send(Event::Button {
                button: 2,
                down: message == WM_MBUTTONDOWN,
                x,
                y,
                time,
            }),
            WM_MOUSEWHEEL | WM_MOUSEHWHEEL => send(Event::Wheel {
                delta: ((info.mouseData >> 16) as u16 as i16) as i32,
                horizontal: message == WM_MOUSEHWHEEL,
                x,
                y,
                time,
            }),
            _ => {}
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

unsafe extern "system" fn keyboard(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let time = qpc();
        let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let message = wparam.0 as u32;
        let down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
        if down || message == WM_KEYUP || message == WM_SYSKEYUP {
            send(Event::Key {
                vk: info.vkCode,
                down,
                foreground: GetForegroundWindow().0 as isize,
                time,
            });
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

pub struct Hooks {
    thread: u32,
    handle: Option<JoinHandle<()>>,
}

impl Hooks {
    pub fn start() -> (Hooks, Receiver<Event>) {
        let (tx, rx) = channel();
        *SENDER.lock().unwrap() = Some(tx);
        let (id_tx, id_rx) = channel();
        let handle = std::thread::spawn(move || unsafe {
            let _ = id_tx.send(GetCurrentThreadId());
            let hooks = [
                SetWindowsHookExW(WH_MOUSE_LL, Some(mouse), None, 0).ok(),
                SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard), None, 0).ok(),
            ];
            let shapes: Vec<(HCURSOR, &'static str)> = [
                (IDC_ARROW, "arrow"),
                (IDC_IBEAM, "text"),
                (IDC_HAND, "pointer"),
                (IDC_WAIT, "wait"),
                (IDC_APPSTARTING, "progress"),
                (IDC_CROSS, "crosshair"),
                (IDC_SIZEWE, "ew-resize"),
                (IDC_SIZENS, "ns-resize"),
                (IDC_SIZENWSE, "nwse-resize"),
                (IDC_SIZENESW, "nesw-resize"),
                (IDC_SIZEALL, "move"),
                (IDC_NO, "not-allowed"),
                (IDC_HELP, "help"),
            ]
            .into_iter()
            .filter_map(|(id, name)| LoadCursorW(None, id).ok().map(|h| (h, name)))
            .collect();
            // Cursor shape has no hook; sample it about 30 times a second.
            let timer = SetTimer(None, 0, 33, None);
            let mut last = "";
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                if msg.message == WM_TIMER {
                    let mut info = CURSORINFO {
                        cbSize: std::mem::size_of::<CURSORINFO>() as u32,
                        ..Default::default()
                    };
                    if GetCursorInfo(&mut info).is_ok() {
                        let shape = if info.flags.0 & CURSOR_SHOWING.0 == 0 {
                            "hidden"
                        } else {
                            shapes
                                .iter()
                                .find(|(h, _)| h.0 == info.hCursor.0)
                                .map(|(_, n)| *n)
                                .unwrap_or("custom")
                        };
                        if shape != last {
                            last = shape;
                            send(Event::Cursor { shape, time: qpc() });
                        }
                    }
                }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            if timer != 0 {
                let _ = KillTimer(None, timer);
            }
            for hook in hooks.into_iter().flatten() {
                let _ = UnhookWindowsHookEx(hook);
            }
        });
        let thread = id_rx.recv().unwrap_or(0);
        (
            Hooks {
                thread,
                handle: Some(handle),
            },
            rx,
        )
    }

    pub fn stop(mut self) {
        unsafe {
            let _ = PostThreadMessageW(self.thread, WM_QUIT, WPARAM(0), LPARAM(0));
        }
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
        *SENDER.lock().unwrap() = None;
    }
}
