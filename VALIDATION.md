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


## v0.2.1 — native 4K window

- Desktop startup maximizes on the pointer's monitor; bounds use Electron's device-independent coordinates so a 3840×2160 display at 150% scaling is handled as 2560×1440 logical pixels.
- Removed the fixed 1600×900 preview buffer. Canvas resolution follows its visible size and device pixel ratio, capped at 4K. Resize, fullscreen, and monitor-DPI changes trigger an update.
- Actual Windows 4K/150% check: maximized preview 2126×1196 physical pixels for its available editor area; fullscreen preview exactly 3840×2160; restored 1100×800 window preview 562×316. No page errors or horizontal overflow. `tests/hidpi-window.mjs` and `tests/hidpi-results.json`.
- Production compilation and browser editing/export/persistence/mobile smoke pass. Capture and export resolution settings are unchanged; this update improves the native window and preview rendering.

- Packaged DPI test and final portable launch/capture also pass. Artifact: `release/Studio Screen 0.2.1.exe`; 128272245 bytes; SHA-256 `5E66C9B0EED2963913471C5EE7F965D4B008A8C0CB4C93BC5FC02DF34D4A9AA5`. Unsigned local development build.

## A1 — spring camera and cursor — 2026-09-14

- 44 unit tests pass (was 14), including new `spring`, `cursorPath`, and `camera` suites: nearby zooms stay above 1.6× between them; automatic zooms glide to each click target; 600 shuffled scrub queries equal in-order playback exactly; frame-to-frame scale change and acceleration stay bounded (no jumps); scale settles to 1× within 3× move time after a zoom; a 2× speed section leaves zoom timing in edited time unchanged (within one frame); the smoothed cursor removes over 60% of synthetic hand jitter and lands on every click to 1e-6; rapid same-spot clicks become one focus, alternating corners are paced ≥ 0.4 s apart; older projects and looks get the spring matching their movement style.
- Preview budget (`tests/a1-preview-perf.mjs`): a 10-minute 1280×720 source with 36,000 pointer samples, a click every 5 s, 3D and 25% motion blur, played in Edge at 2560×1400 CSS px, device scale 1.5 (2208×1242 canvas), RTX 4080 via D3D11. Before: 55.6 fps, 4.7% dropped frames. After: 59.9 fps, 0.2% dropped, p95 frame interval 16.8 ms. Rebuilding the camera path for that project after an edit takes about 47 ms in Node (3D, cursor following on); the cursor path about 13 ms; per-frame lookups about 1 µs.
- `tests/a1-playback.mjs` passes and was shown to fail ("Pausing moved the playhead backwards") when the render loop's position was allowed to be overwritten by stale React state.
- `npm run build`, `browser-smoke`, `v2-proof` (3D export frame difference 1.16/255, effect difference 16.4/255), `v2-visual`, and `v2-audio` pass after the change.
- Not re-run for A1: native desktop capture, audio-proof, packaged and portable tests (capture, audio, and packaging code unchanged). The feel of the presets still needs Dan's hand test on a real recording.

## Readability pass — 2026-09-14

- Screenshots at 2560×1400 CSS px / scale 1.5 (4K at 150%) and 1480×980 of every inspector tab and the export dialog; no overflowing text leaf elements; 390 px mobile width has no horizontal overflow. `browser-smoke`, `v2-visual`, `a1-playback`, build pass.

## A2 — recording gets out of the way — 2026-09-14

- Resumed native run **passed**: 11 sampled frames in each take; protected footage **0 magenta pixels**, **0 black share**; unprotected control **1,045 magenta pixels**. Countdown, hidden editor, visible bar, restored focus, no leftover windows and no page errors all passed. A2 now enforces its own 60-second idle check (observed refusing at 57.813 s); both videos were deleted after measurement.

- `tests/a2-recording-ui.mjs` passed with **browser capture** (before the helper existed): countdown window seen, editor hidden during countdown, bar visible, editor visible and focused after Finish, no leftover windows; magenta test bar: 0 marker pixels and no black box in the protected take, 1,143 marker pixels in the control take with exclusion off.
- **Not yet re-run with the capture helper** (the test was updated for native recordings but needs an idle PC).
- `tests/desktop-capture.mjs` (browser-capture fallback, pause/resume through the bar, metadata, export) passed.

## A3 — frame-by-frame export — 2026-09-14

- `tests/a3-export.mjs` passed: 60 s 1080p60 project with 3D and 25% motion blur exported in 23.0 s in Edge (2.6× real time); exactly 3,600 frames with 16.667 ms spacing; H.264 + AAC; decoded frame at 15.5 s vs the compositor: 2.19/255 mean difference; cuts + 2× section → exactly 480 frames, 8.000 s audio, 439 Hz tone in normal speed and 440.7 Hz in the 2× section (pitch preserved); cancel → AbortError and no file; desktop export with the window minimized finished in 23.1 s with 3,600 frames; cancelled desktop export left no file.
- `v2-proof` (3D export 2.13/255, exact 2.000 s), `v2-audio` (fades), `export-formats` (MP4, GIF, `.studio` round-trip) pass on the new exporter.
- Portable build (`npm run desktop:pack`) succeeds and bundles `resources/studio-capture.exe`. The packaged app itself was not launched in this session.

## A4 — capture helper — 2026-09-14

### Latest verification run — Daniel Kinsner checkout, 2026-09-14

- `CLAUDE.md` was absent from the checkout and its parent directory. Read STATUS.md, the as-built PLAN sections, this document, and docs/MACHINE-HANDOFF.md.
- Setup: `npm install` completed; `npm run native:build` passed (release build, 37.97 s); `npm run native:check` printed five checks, all ✔, including the NVIDIA GeForce RTX 4080 hardware encoder. `npm run dev` served the editor at 127.0.0.1:5173. Tests used the installed FFmpeg 7.1.1 through `FFMPEG_PATH` / `FFPROBE_PATH`; the old AutoPod path does not exist here.
- Baseline: `npm run test` passed **61/61 tests across 10 files**; `npm run build` passed with the existing large-chunk warning; `node tests/browser-smoke.mjs` passed editing, WebM export, persistence, mobile viewport and no page errors.
- `node tests/a3-export.mjs` passed: browser 60 s 1080p60 export **28.1 s (2.14× real time)**, **3,600 frames**, spacing 16.666–16.667 ms, H.264/AAC, frame difference **2.19/255**. Edited export: **480 frames**, **8.000 s** audio, **439 Hz** normal / **440.7 Hz** sped-up tone. Browser cancellation returned AbortError with zero downloads. Minimized desktop export: **30.5 s**, **3,600 frames**; cancellation reduced files from two to one. The under-30-second assertion applies to the browser export. Receipt: `tests/a3-results.json`.
- `node tests/a4-av-sync.mjs` ran after its `tests/idle.ps1` guard accepted at least 60 s idle; no `--force`. **Failed (exit 1):** captured frame size **2560×1440**, **0 flashes**, **6 tones**, **0 paired offsets**. The script's `meanMs: 0` is its empty-array fallback and is **not a valid sync measurement**. The flash-detection failure prevents confirming the prior ~49 ms delay; the underlying reason was not established. Receipt: `tests/a4-av-sync-results.json`.
- Stopped at the requested sync gate. Did **not** run the −49 ms calibration, modify `studio:native-start`, or run a4-native-capture, a2-recording-ui, a5-open-speed or the five-minute soak. No product fix or regression test was added without a diagnosed cause. The sync test deleted `tests/.native/av-sync.mp4` and `av-sync.jsonl`; both paths were independently confirmed absent. Waiting for Dan's review/hand test before resuming.

### Resumed sync diagnosis — 2026-09-14

- Dan authorized continuing the verification work. The test fixture had two portability problems: launch arguments did not reliably position the playback window on the captured monitor, and its fixed 800×400 sampling rectangle included background around a 640×360 video at 100% scaling. Explicit CDP placement at (0, 0), fullscreen playback and a relative central crop produced all six flashes on this dual-1440p setup.
- Measurement correction: decoding audio directly to raw samples discards timestamp gaps. A synthetic gapped-audio regression reproduced a false 0.808 s onset for a tone scheduled at 1 s; timestamp-preserving resampling restored 1.000 s. The synthetic image regression reproduced the old crop failure and detected the exact onset at both 1440p and 4K. `node tests/av-fixture.mjs` passed both; 63 unit tests and production build passed. Missing flashes now report a null mean, and failure cleanup covers the recorded media and event log.
- Corrected, idle-gated native measurements: uncalibrated **−74, −24, −49, −88, −24 ms (mean −52 ms)**; with −49 ms configured **−121, −57, −91, −128, −63 ms (mean −92 ms)**. Both detected six flashes and six tones and failed the ±20 ms criterion. An earlier raw-audio decode measured apparent growing drift (mean −142 ms); that superseded measurement should not be used for calibration.
- The original +49 ms delay is not reproduced here, and applying −49 ms makes the measured lead worse. No app offset was applied. These observations do not establish the remaining timing error's root cause. Native/A2/A5/soak verification continues independently under Dan's renewed instruction.
- Native end-to-end run reached its final assertions, failing only at the A/V assertion (**−33 ms**, before applying timestamp-preserving decoding to this test too). Measurements: **0.51 px** click error, **0** stray cursor pixels versus **102** in the baked-cursor control; six left clicks, one right click, one wheel event, Ctrl+K, four typing events, text/pointer/arrow shapes. Helper kill retained **3.92 s** media / **4.01 s** project; app kill recovered a **3.62 s** project and helper exited in **433 ms**. Crash assertions come after the failing sync assertion and were not executed in that run; these are observed recovery measurements. Test recording folders were deleted.
- Five-minute soak attempt interrupted by renewed keyboard/mouse use at **247.832 s / 14,870 frames**, **2560×1440 at 60 fps**, 15 memory samples, settled **107–109 MB** (2 MB spread). **Not a completed five-minute pass.** The harness now stops on resumed input, deletes footage, verifies completed duration/frame count before passing, and reports actual capture resolution instead of hard-coding 4K. Both soak media and event log were confirmed absent.

### Audio-gap root cause and fix — 2026-09-14

- The helper previously inserted silence only when a packet arrived more than 20 ms after the preceding packet. The real Media Foundation AAC encoder concatenates PCM across shorter gaps: the synthetic `audio-gap-probe` supplied eight missing 10 ms silent packets before a tone at 1 s, and the encoded tone appeared at **0.9200208 s**, even when decoding with timestamp-preserving resampling. Explicitly filling the gaps restored **1.0000208 s**. This proves a timing-loss bug in the helper/encoder path independently of browser playback or display capture.
- `audio_timeline::gap_frames` now calculates silence for every gap containing at least one 48 kHz sample. The native recording loop uses it before writing the next packet. The half-second late-audio silence-filler policy, overlapping-packet trimming, encoding quality and app offset remain unchanged.
- Regression: `cargo test --release --manifest-path native/studio-capture/Cargo.toml --bin studio-capture` first failed with the old 20 ms threshold (0 vs 480 missing frames), then passed **2/2** after the fix. `node tests/audio-gap.mjs` passed the actual AAC encoder control/corrected comparison (**0.9200208 vs 1.0000208 s**) using only synthetic media. No screen capture or audio playback is used by that test.
- Temporary format logging in `native:check` confirmed 48 kHz stereo PCM was accepted here; fallback-format conversion is not involved in this run. Debug instrumentation and an unrun continuous-playback experiment were removed. **Post-fix native A/V sync, full native end-to-end, and an uninterrupted five-minute soak remain pending an idle PC.** The synthetic fix does not establish a final real-screen sync offset or a green native suite.

### Earlier evidence (original PC)

- `npm run native:check` on the RTX 4080 PC: capture, borderless (access status 4), dirty regions, hardware H.264, loopback audio all available.
- Helper smoke take (3 s, 4K60, with a pause): H.264 High 3840×2160 60 fps + AAC; video 2.033 s and audio 2.028 s; pointer, cursor-shape and dirty-region events logged.
- `tests/a4-native-capture.mjs`, first clean run (PC idle): window capture 1332×950; recorded click landed **0.5 px** from the red marker; 6 left clicks (5-click burst + 1), 1 right-click, 1 wheel, "Ctrl + K", 4 typing events, cursor shapes text/pointer/arrow; killing the helper kept the take (3.91 s file, 4.01 s project); app kill recovered on relaunch. Failed assertions in that run: stray-pixel count 40 vs 308 in the cursor-baked control (the marker's anti-aliased rim; the check now excludes it), A/V offset 34 ms with a hand-timed fixture (replaced with a real synced video), and the app-kill take ran 13.8 s because orphaned Electron processes held the helper's stdin open.
- Fix verified in a later run: the helper now watches the app's process and was gone **383 ms** after the app was killed; recovered take 3.31 s. That later run was disturbed by someone using the PC (stray input), so its other numbers don't count.
- `tests/a4-av-sync.mjs` (browser plays a clip with flash + 1 kHz tone on the same frames; helper records the display): clean idle run **47, 48, 49, 51, 49 ms** (sound behind picture, mean 49). With `audioOffsetMs: -49` one clean-ish run measured mean −1 ms (−25, 9, 7, −8, 10) before the silence-fill fix; runs after the fix were disturbed by PC use. **The −49 ms correction is not applied by the app yet** (the helper supports the setting; Electron doesn't pass it).
- Not run: `tests/a4-soak.mjs` (30-minute memory check), a clean full pass of `tests/a4-native-capture.mjs`.

## A5 — auto-edit on stop — 2026-09-14

- Resumed verification: `a5-open-speed` initially failed because it read IndexedDB before the app's 700 ms autosave debounce, receiving the old 24-second sample (auto=false) even though the new take was already visible. The test now waits for save completion after recording the open/first-frame times. Repeat **passed**: **288 ms** to auto-edit, **635 ms** to first frame, **1,439 ms** to save confirmation; **300 s**, **60,228 points**, **10 speed sections**, auto-edit=true, no page errors. This is a test race fix; the product's save delay and opening behavior are unchanged.

- 7 `autoEdit` unit tests (trim to first action and bar reach, hotkey stop, typing/idle speed-ups, caret blinks ignored, short takes raw, no clicks, Back to raw and re-apply); 61 unit tests in total pass.
- Browser check on a 40 s project: Apply automatic edit → "3 zooms · 1 typing speed-up · 1 idle speed-up", dashed automatic clips, × removed one speed-up, Back to raw removed all automatic clips.
- Not run: `tests/a5-open-speed.mjs` (5-minute take opens auto-edited within 3 s) — needs an idle PC.
