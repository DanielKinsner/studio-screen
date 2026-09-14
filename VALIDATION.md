# Validation — Studio Screen v0.2 — 2026-09-14

## Current verification

- TypeScript and Vite production build pass; 14 unit tests cover cut/speed mapping, inverse source/output timing, caption retiming, typing detection, zoom endpoints, smoothing/hiding, click timing, fades, and streaming WebM finalization.
- Edge editor smoke passes: styling, focus, annotation, playback, WebM output, reload persistence, responsive layout, no page errors.
- 1480×980 desktop and 390×844 narrow layouts visually inspected. 3D tilts the actual screen plane; captions stay in the flat overlay plane. No horizontal overflow.
- Direct timeline drag and Undo restore focus timing; speed sections survive reload. `.studio` version 2 roundtrips 3D angles and speed sections; version 1 loads with defaults.
- The 3D MP4 proof compares decoded exported frames against the shared compositor: mean red-channel difference about 1.2/255; changing 3D to flat produces a 16.4/255 difference. A speed-edited two-second project encoded at approximately 2.015 seconds. Evidence: `tests/v2-results.json`, `tests/3d-export.mp4`, expected/decoded PNGs.
- Windows native window capture passes pause/resume, editor handoff, and composed export. The controlled test recorded 110 pointer samples, Ctrl+K, four typing-activity events, and two clicks in 5.50 seconds. Plain letters are not stored.
- Independent FFmpeg decode finds the generated 440 Hz system-audio tone in source and composed export, with about 0.02 dB RMS difference. Latest source/export both decode to 5.46 seconds. Evidence: `tests/audio-results.json`.
- MP4 and GIF export, embedded-media `.studio` reopening, imported playback, and consecutive Undo pass after this update.

Native tests activate their own fixture and inject a few controlled mouse/key events. Test input is DPI-aware and clicks the fixture before keys; this matters on scaled displays and for Windows foreground-window authorization. Product metadata is scoped to recording, with window-key events restricted to the selected foreground window.

Run commands are in README. Media, screenshots, raw receipts, `dist/`, and `release/` are local artifacts ignored by git. Run native capture and format tests sequentially because they share fixture media.

## Evidence limits

These are short controlled Windows/Edge checks. They do not certify full Screen Studio/FocuSee parity, sustained 4K/60 fps, long recordings, crash recovery, all drivers/displays/DPI configurations, native cursor suppression, mobile devices, macOS/Linux, or cloud features. Capture and export currently buffer media in memory; video export is real-time and foreground. WebGL is required for 3D. Cursor/key polling may miss short events.

Camera and microphone recording are intentionally excluded. The sample project is procedural demonstration content, not captured footage from either reference product.

## Windows artifact

- File: `release/Studio Screen 0.2.0.exe`
- Size: 128,272,054 bytes
- SHA-256: `CD3F668A43C862BF5A28A1ADFC2978CEF44383990CF150E7ACEFAD45B5AE87B3`
- Authenticode: NotSigned; local Windows x64 portable development build, Electron 44.3.0.
- Packaged smoke: native picker, unpacked pointer helper, 3D controls, internal audio enabled, microphone controls absent, no page errors.
- Final portable: launches through its extracted application, native picker works, actual internal-audio recording succeeds (2.257 seconds). Independent decode detects 440 Hz in its captured audio. `tests/portable-results.json`, `tests/portable-capture.webm`.
- Final custom-region repeat: 50% width/height, 166 coordinate samples, Ctrl+K, four typing events, two clicks; composed audio decodes with about 0.05 dB source/export RMS difference.
- Audio fade integration: a controlled constant-tone fixture with both a cut and a 2× speed section exports to 2.94 seconds for a three-second edit. Beginning/end RMS are about 15–16 dB below the middle with 0.8-second fades. `tests/fade-results.json`.
