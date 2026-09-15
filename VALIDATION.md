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

### Continued idle-gated verification — 2026-09-14

- Kept the sync test queued until the idle guard accepted 60 s. The first post-fix browser run still measured no flashes (sampled brightness 20.97–21.08/255), with nine tone detections; no valid offset was produced. The fixture now uses a dedicated borderless, always-on-top Electron window and obtains its physical monitor point from that window, avoiding browser placement/foreground assumptions.
- A later run recorded only **9.328 s** before the helper exited. The test then hung because it registered its exit listener after the exit had already happened. The partial recording was not counted as a sync result; its recording and event log were deleted, and the test-owned fixture processes were cleaned up. The helper's early-exit cause was not captured by the old harness.
- The test now observes helper exit from startup, handles an already-exited process, reports helper errors, requires all six flashes/five post-warmup pairs, exits its fixture explicitly, and discards a run if input resumes during capture. The process-exit regression first timed out with the old listener-only implementation, then passed. **65 JavaScript tests and production build passed.** Native verification remains queued for idle time; these harness changes are not a native sync pass.

### Post-fix sync measurements and mixed-DPI follow-up

- With the idle gate accepted and console subprocesses hidden, the plain six-flash test **passed**: −13, +8, +1, −12, −8 ms, **mean −5 ms**. Helper stopped normally at 16.117 s / 967 frames. The −49 ms negative control measured −46, −56, −50, −45, −58 ms, **mean −51 ms**, and correctly failed the ±20 ms criterion. No application offset was added. Both recordings were deleted; numeric receipts are `tests/a4-av-sync-uncalibrated-results.json` and `tests/a4-av-sync-calibrated-results.json`.
- Native end-to-end repeats on the 150% secondary display captured 1336×950 but failed cursor/input verification: **962.09 px** click error, no shortcut/typing, arrow only, and no baked cursor near the marker. Sync in the latest repeat measured **0 ms**. Switching injection to SetPhysicalCursorPos alone did not change the failure, so that is not an established root cause. The earlier 0.51 px result was on the primary display. Recordings were deleted after measurement. The subsequent run below resolved this test failure.

- Mixed-DPI root cause isolated to the test injector: Windows reported the same fixture bounds before/during recording, and GetPhysicalCursorPos confirmed the requested 4219,971 position. With system-DPI input context, the end-to-end assertions still failed. Setting the injection thread to PER_MONITOR_AWARE_V2 restored correct input. The existing end-to-end regression went from 962.09 px error and missing typing to a full **PASS**: **1.26 px**, six left clicks (38–47 ms burst gaps), one right click, one wheel, Ctrl+K, four typing events, text/pointer shapes, **0 stray pixels versus 234 control**, **−7 ms A/V**. Helper kill retained 3.93 s media / 4.00 s project; app kill recovered 3.63 s and helper exited in **472 ms**. All recovery assertions executed and passed. No product coordinate change was needed.
- Final A2 repeat passed: 11 samples per take, **0 protected magenta pixels**, **0 black share**, **1,071 control magenta pixels**; countdown, hidden editor, focused return and no leftover windows passed. Final A5 repeat passed: **357 ms auto-edit**, **737 ms first frame**, **1,552 ms saved**, 300 s / 60,228 points / 10 speeds / auto=true; no page errors.
- After harness cleanup, `npm test` passed **65/65 across 12 files**. Real-screen recordings from native and A2 were deleted by their test cleanup. A five-minute soak attempt stopped on renewed input at 187.449 s / 11,247 frames (2560×1440 at 60 fps); settled memory 108–111 MB. This interrupted attempt is not a pass. Its media and event log were independently confirmed absent. A new attempt is queued behind the idle guard.

### Final completed soak and transfer checkpoint

- The queued run completed without interruption: **308.165 s**, **18,490 frames**, **2560×1440 at 60 fps**; audio duration 308.195 s. **20 memory samples**, settled **106–107 MB** (**1 MB spread**), output 67 MB before deletion. The script printed `PASS: 5 min 2560×1440 at 60 fps with flat memory (1 MB spread).` and exited 0. Receipt: `tests/a4-soak-results.json` (local generated evidence).
- Confirmed `tests/.native/soak.mp4` and `soak.jsonl` absent after cleanup. A2 project folders contain metadata only, no recorded videos. Retry queue exited; the task's dev server was stopped for handoff.
- All requested automated verification is complete. The −49 ms calibration run failed and was not applied; the corrected helper passes with zero offset. The separate 30-minute/4K soak and destination-PC hand test are not claimed as verified.
- Local-only temporary geometry probe and browser profiles remain untracked because automatic approval review rejected their cleanup. They are not needed to build or continue on another PC and are not uploaded.

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
- Original pending item: `tests/a5-open-speed.mjs`; completed in the resumed runs above.

- Another idle-gated soak attempt stopped on resumed input at **184.383 s / 11,063 frames**, 2560×1440 at 60 fps; 11 samples, settled **109–110 MB** (1 MB spread). Media/event cleanup completed. The retry queue remains active; this is not a five-minute pass.

## 0.4.0 — hand-test fixes — 2026-09-15

Built from [the hand-test fix plan](docs/plans/2026-09-15-hand-test-fixes-execution-plan.md); per-slice detail, commits and every deviation are in [the run log](docs/plans/2026-09-15-hand-test-fixes-run-log.md). Office PC, RTX 4080, while Dan, Premiere Pro and Codex were also using the machine.

**Unit tests:** 16 files, **115 passed** (was 65). New suites: `history` (8), `edits` (16), `perspective` (5), `aim` (7), plus lead, typing-zoom, manual-tilt, neutral-opening and auto-edit additions.

**New browser and desktop tests (all PASS on the final code):**
- `editor-interactions`: empty timeline, preview and Esc deselect (failed before the fix); one Ctrl+Z after dragging Magnification 1.65 → 2.5 restores 1.65 (was 2.45 before the fix), with focus on or off the slider.
- `scrub-frames`: 20 s 1080p60 H.264, 5 s GOP, 40 scrub moves: the empty card showed on **128 of 307** sampled frames before, **0 of 326** after; paused frame vs decoded frame at the playhead 1.92 (±0.25 s frames: 5.24 / 5.07).
- `3d-fit`: padding 0, maximum tilt/rotation/field of view: **1,024 → 0** card pixels on the frame edge; default 3D zoom at padding 0: 0.
- `export-location` (Electron): Save As into a chosen folder replaces an existing file only on success (1,561,459-byte MP4), folder remembered, Show in folder allowed, cancel quiet, Ctrl+E no dialog, forced write failure leaves "KEEP ME" intact, corrupt state → `Videos\Studio Screen\Exports`.
- `timeline-resize`: resting 278 px / screen row 44 / rows 29 / clips 22 at 1920×1080 and 1366×768; dragged to 478 px (70% cap 463 px at 1366×768) with rows, labels and clips growing and the preview shrinking without overflow; kept after reload; double-click resets.
- `cutting`: Ctrl+K ×2 → 3 pieces; gap (00:24 → 00:15, hand zoom unchanged); close gap (later caption moved to exactly 9 s in); restore; Shift+Delete (00:16); razor; zoom drag from 5 px away snaps to exactly 8.00 s; eight one-step undos; piece-edge gap, Shift ripple, trim grip snapping onto 1 s; `.studio` round-trip of splits and ripple.
- `focus-dot`: dot within 0.02 px of the camera-mapped focus; aim-view drag +80/+40 px → Focus 44/51 (expected 43.99/51.18), one undo; wheel 1.8 → 1.95×, one undo; Alt+drag → tilt 28°/−14°; Alt+wheel → 49°; 2D hint shown once.
- `alt-tilt` (Electron, `webContents.sendInputEvent`): before the fix Alt showed the menu bar and moved the page 26 px; after, the menu stays hidden and content bounds are identical through Alt and Alt+drag (tilt 38°); Ctrl+V pastes; Ctrl+Shift+I opens DevTools.

**Existing suites on the final code:** `npm run build` OK; `browser-smoke`, `a1-playback`, `v2-visual` PASS; `v2-proof` PASS (3D export 2.14, effect difference 15.33, was 16.41 before the 3D fit); `a1-preview-perf` PASS after the scrub change (p95 17.0 ms, 1.05% dropped, 59.4 fps).

**A3 export:** correctness passed on every run: 3600 evenly spaced frames, frame difference 2.19 → 2.21 after the 3D fit, AAC, 480 edited frames with 439/440.7 Hz pitch, cancel cleanup, minimized desktop export 3600 frames with files 2 → 1 via the new `.partial` file, and the new gap + ripple case with **270 frames for 9 s at 30 fps**. The 60 s export met its < 30 s budget in 22.95, 25.88, 24.16, 25.1 and **20.52 s** runs and missed it in others (30.05–72.5 s) while the PC was loaded. An alternating A/B of the same export against commit `ceb6811` and the slice 9 code measured 26–41 s (old) and 23–49 s (new), so the variance is the machine, not a regression.

**Native (PC idle 120 s+):** `native:check` all five ✔ (RTX 4080 hardware H.264). A2 PASS: protected recording 0 magenta bar pixels, control 1,069, countdown/hidden editor/restored focus. A5 PASS: 5-minute take auto-edited in 386 ms, first frame 845 ms, saved 1,135 ms ("Auto-edit: 36 zooms · 10 typing speed-ups"). A4 `a4-native-capture`: clicks 0.5 px from the marker, 0 stray cursor pixels (control 231–232), six clicks/right-click/wheel/Ctrl+K/typing and text/pointer shapes recorded, helper-kill and app-kill recovery (helper gone in 619–802 ms) passed, but the **A/V check failed: 66 ms, then 58 ms** (limit 20). `a4-av-sync` (helper only, own fixture, no app code): **75, 51, 53, 58, 47 ms, mean 57 ms** (the −5 ms mean on 9/14 was measured on a different PC; see the follow-up below). Helper binary unchanged (built 08:16, SHA-256 `4D429A77…F8828`; no `native/` changes since `e33c17b`); Premiere Pro, Discord, Chrome and Spotify were running. No offset added; follow-up investigation queued. `desktop-capture` not passing: stale since 9/14 (auto-edit toast, browser-download export), unrelated to this run.

**Package:** `release/Studio Screen 0.4.0.exe`, 129,972,345 bytes, SHA-256 `37CD371FA2A829A669DDDD3E0D256984347591F846BCD03215E99664E8731212`, unsigned local build. Bundled `resources/studio-capture.exe` hash equals `native/studio-capture/target/release/studio-capture.exe` (`4D429A77…`). `packaged-smoke --portable` PASS (loaded from its extracted temp folder, footer v0.4.0, source picker, cursor tracker, system audio on, no mic controls, no page errors) and PASS on `win-unpacked`, both with a throwaway profile (the real `%APPDATA%\studio-screen` was not touched).

### `desktop-capture` repaired — 2026-09-15

The browser-capture fallback test had been failing since `142402e`/`cf594b2` (last pass 9/14 13:51). Its expectations were stale, not the app: the auto-edit toast replaced "Recording ready", exports stream to disk instead of downloading, `142402e` removed the PowerShell tracker so the fallback records no clicks or keys, and window sources get no pointer polling (Electron reports an empty `display_id` for windows, checked with a probe). The test now expects exactly that, checks the take opens auto-edited with nothing trimmed and 0 zooms, and no longer injects keystrokes or clicks.

Run with the PC idle 147 s: window take 6.20 s, 416,751-byte WebM, `legacy`, drawn cursor off, "Auto-edit: 0 zooms.", one 370,970-byte WebM export in `tests/.exports`, no page errors. `--region`: 5.71 s, same checks, 463,372-byte export. `audio-proof`: 440 Hz in capture and export, −42.37 vs −42.31 dB. `export-formats` PASS.

**Found, not fixed:** frames pulled from both exports show the recording only for the first ~1 s, then the empty card (the region export flickers back once). The capture itself is fine for all 6 s, and the 9/14 export made before `4c92370` (frame-by-frame export) is fine throughout. In headless Edge, mediabunny's `samplesAtTimestamps` on `tests/native-capture.webm` returns frames at 0–0.999 s and `null` from 1.25 s on; `getKeyPacket(1.5)` and `(3)` are `null` although `getPacket` finds those frames. The file has keyframes only at 0 and 5.024 s, one cluster per second (MediaRecorder timeslice 1000) and no Cues; the demuxer jumps to the cached cluster for the timestamp, finds no keyframe in it and returns `null` rather than searching earlier clusters. After `ffmpeg -c copy` (adds Cues) every lookup returns the right frame.

## A/V sync follow-up — office PC — 2026-09-15 afternoon

Question: why did `a4-av-sync` measure sound ~57 ms late on 9/15 when it measured −5 ms on 9/14? Nothing in `native/`, the sync test, its fixture, `av-measure.mjs` or the dependencies changed between those runs (only the version string in `package.json`).

- **The −5 ms pass came from a different PC.** This office checkout's local reflog goes straight from `48d8238` (committed here 9/14 16:38) to a pull at 9/15 07:54. That pull brought in `d508fda…d492b8d`, the commits that recorded −52 ms and −5 ms. That session reported FFmpeg 7.1.1 via `FFMPEG_PATH`, "the old AutoPod path does not exist here", and 2560×1440 captures. This PC has had the AutoPod FFmpeg (2023-04 build) since 2024-12 and records its primary display at 3840×2160. This PC's only earlier measurement was **+49 ms** (9/14, before the gap fix and the timestamp-preserving decode). No same-machine regression is established.
- **Four valid runs, current vs rebuilt helper.** Gate: 60 s idle at Dan's request. Every run had six flashes and six tones, with no input during capture. Premiere Pro and Chrome were open with inactive audio sessions; Spotify and Discord were closed; CPU was 7–18%. Order and results:
  - Current helper `4D429A77…`: **59 ms** (61, 56, 61, 63, 52), then **67 ms** (73, 65, 70, 59, 70).
  - Helper rebuilt here with `cargo build --release --locked` from source identical to `e33c17b` (`7B022594…`; same 532,480 bytes, hash differs by build path): **51 ms** (51, 49, 55, 57, 45).
  - Current helper again: **63 ms** (68, 73, 59, 60, 56). This last run (13:50:37–13:50:58) may have overlapped Codex's idle-gated `desktop-capture` run (logged 13:51, idle 147 s). Its result matched the two runs before it.
  - Conclusions: the rebuild does not remove the offset, and closing Spotify and Discord did not change it (57 ms this morning with them open).
- **Encoder, MP4 and measurement ruled out.** A scratch probe (not committed; it copies `examples/audio-gap-probe.rs`) wrote a white frame and a 1 kHz tone at the same timestamp (1.0 s) through the helper's own `encoder.rs`, at 640×360 and at 3840×2160. The test's exact flash/tone measurement gave **−4 ms** with the 2023-04 AutoPod FFmpeg, FFmpeg 9.0 and FFmpeg N-124716 alike. That equals the untouched fixture clip (**−4 ms**, the tone detector's 5 ms window). So the ~60 ms arises before encoding: either in the fixture playback / Windows audio path on this PC, or in the timestamps the helper gives loopback packets or captured frames.
- **Audio path on this PC.** Default output is Realtek(R) Audio "Speakers": 48 kHz float stereo, 10 ms period. Its Realtek SFX/MFX/EFX effects are wrapped by Equalizer APO. Equalizer APO's `config.txt` only has a commented-out include, and its `Benchmark.exe` passed a 1 kHz burst through with **0 samples** of delay. Realtek's own effects were not measured. The 9/14 PC's audio device is unknown.
- No audio offset was added and the helper was not changed. The test deleted its recordings; the receipts are local only.
