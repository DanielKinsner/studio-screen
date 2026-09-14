# Option A Implementation Plan

> **For agentic workers:** execute task-by-task; steps use checkbox (`- [ ]`) syntax. Each task ends green (unit tests + `npm run build`) and is committed on its own. Pull `origin/main` before every commit (Codex may be working in parallel).

**Goal:** Make Studio Screen feel like Screen Studio on Windows: almost done with an edit the moment recording stops.

**Architecture:** Electron + React editor with one shared canvas/WebGL compositor for preview and export. A1 replaces fixed ease curves with precomputed spring paths; A2 hides the app during capture; A3 replaces real-time export with frame-by-frame WebCodecs encoding; A4 adds a Rust sidecar for cursor-free capture, input hooks, and disk streaming; A5 adds the auto-edit pass.

**Tech stack:** Electron 44, React 19, TypeScript, Vite, Vitest, Playwright (Edge), Rust (A4), WebCodecs (A3).

**Spec:** [docs/SPEC.md](SPEC.md)

## Global constraints

- Windows 11 only; no microphone or camera code paths.
- Preview and export must keep sharing `renderFrame` in `src/compositor.ts`.
- Every motion value is a pure function of `(project, time)`: no state carried between rendered frames.
- Existing IndexedDB projects, `.studio` files (v1/v2) and saved looks (`localStorage["studio-presets"]`) must keep opening.
- Small commits, each green. Commit messages end with the Co-Authored-By line.

---

## Phase A1 — Smooth camera and cursor

### File structure

| File | Responsibility |
|---|---|
| `src/spring.ts` (new) | Spring step math and a tiny dependency-keyed memo |
| `src/cursorPath.ts` (new) | Precomputed smoothed cursor path, click/shortcut/idle lookups |
| `src/camera.ts` (new) | Zoom targets → precomputed spring camera path (2D + 3D pose) |
| `src/timeline.ts` | `autoZooms` groups clicks into gliding zooms with focus keyframes; old `zoomWeight`/`zoomAt` removed |
| `src/motion.ts` | Thin re-export layer (`pointerAt`, `smoothPointer`, `cursorOpacity`, `cameraAt`, `poseAt`, `tiltPresets`) so callers keep one import |
| `src/compositor.ts` | Uses indexed lookups for clicks/shortcuts instead of scanning every point per frame |
| `src/types.ts`, `src/settings.ts`, `src/storage.ts` | `cameraResponse`, `cameraBounce`, `motionEase: "custom"`, `Zoom.focus`, migration |
| `src/MotionPanel.tsx`, `src/EditorPanels.tsx` | Camera feel control, Advanced sliders, focus-keyframe note, preset keys |
| `src/App.tsx` | Playback loop renders the canvas directly, driven by the video clock |
| `tests/a1-preview-perf.mjs` (new) | 10-minute synthetic project playback frame-time measurement |

### Tuning constants (starting values; Dan tunes by hand-test)

- Camera feel presets (`motionEase` → response s / bounce): `focused` Snappy 0.38 / 0.08 · `smooth` Smooth 0.6 / 0 · `gentle` Floaty 0.95 / 0.
- Limits: `cameraResponse` 0.2–1.5 s, `cameraBounce` 0–0.4.
- Spring: angular frequency ω = 2π / response, damping ratio ζ = 1 − bounce; semi-implicit Euler at dt = 1/240 s; samples stored at 120 Hz and linearly interpolated.
- Scale is sprung in log space (perceptually even zoom speed).
- Camera springs run in **output time** (what the viewer sees), so a 2× speed section does not make the camera twice as twitchy. Cursor smoothing runs in source time.
- Auto zoom: lead before a click = clamp(0.9 × response, 0.3, 1.2) s; hold after the last click = 2.2 s; merge groups whose gap is < 1.5 s; coalesce clicks < 0.4 s apart; ignore a click already inside the middle 60% of the zoomed view.
- Manual zooms closer than 1.0 s bridge (no zoom-out between them). When zooms overlap, the later-starting one wins.
- Follow cursor while zoomed (`followCursor`, new default **on**): the camera moves only when the cursor leaves the middle 60% of the zoomed view.
- Cursor smoothing: spring response = 2 × `cursorSmoothing`; 0 = raw. Within ±0.12 s of a click the drawn cursor blends back to the exact click position.

### Task 1: Spring and memo primitives

**Files:** Create `src/spring.ts`, `src/spring.test.ts`.

**Produces:**
- `type Spring = { value: number; velocity: number }`
- `springStep(s: Spring, target: number, response: number, bounce: number, dt: number): void` (mutates `s`)
- `memo<A extends readonly unknown[], R>(fn: (...args: A) => R, size?: number): (...args: A) => R` — shallow `===` comparison of arguments, keeps the last `size` (default 4) results.

- [x] Tests: critically damped step from 0 → 1 reaches > 0.99 within 1.5 × response and never exceeds 1.0001; bounce 0.3 overshoots above 1.02 then settles within 0.01 by 4 × response; dt 1/240 vs 1/480 differ by < 0.01 at every 0.1 s mark; `memo` returns the identical object for identical arguments and recomputes when any argument identity changes.
- [x] Implement, run `npx vitest run src/spring.test.ts`, commit.

### Task 2: Precomputed cursor path

**Files:** Create `src/cursorPath.ts`, `src/cursorPath.test.ts`; modify `src/motion.ts`, `src/compositor.ts`, `src/editing.test.ts`.

**Consumes:** `springStep`, `memo`.
**Produces:**
- `pointerAt(p, t): { x; y; t }` (raw interpolation, unchanged behaviour, moved here)
- `smoothPointer(p, t): { x; y; t }` (spring path + click snap)
- `cursorOpacity(p, t): number` (binary search over precomputed movement times)
- `clickAt(p, t): number | undefined` (time of the most recent click within 0.5 s)
- `shortcutAt(p, t): { t: number; shortcut: string } | undefined` (most recent within 1.8 s)

- [x] Tests: jittery input (±0.004 noise around a line) comes out with < 40% of the raw point-to-point jitter; at each click time the smoothed position equals the click position to 1e-6; `cursorOpacity` hides after 1.5 s idle and respects `hiddenCursor`; querying 500 random times gives identical results to querying them in ascending order; `cursorSmoothing: 0` returns raw positions.
- [x] Replace the per-frame scans in `compositor.ts` (`p.points.find` for clicks, `p.points.filter` for shortcuts) with `clickAt`/`shortcutAt`.
- [x] Update the old "smooths pointer movement" test to the new semantics, run all unit tests + build, commit.

### Task 3: Auto zooms that glide

**Files:** Modify `src/types.ts` (`Zoom.focus?: { t: number; x: number; y: number }[]`), `src/timeline.ts`, `src/timeline.test.ts`.

**Produces:** `autoZooms(p): Zoom[]` — one zoom per click group, `id = "auto-" + firstClick.t`, `focus` = coalesced keyframes (each `t` = click time − lead, floored at the previous keyframe), `x/y` = first keyframe. Removes `zoomWeight` and `zoomAt`.

- [x] Tests: clicks at 3 s and 4.5 s in different spots → one zoom with two focus keyframes; clicks at 3 s and 13 s → two zooms; ten clicks 0.3 s apart on the same spot → one zoom with one keyframe; ten clicks 0.3 s apart alternating far corners → one zoom whose keyframes are ≥ 0.4 s apart; manual zoom priority and `dismissedZooms` still honoured; `autoZoom: false` returns manual zooms only.
- [x] Implement, run unit tests + build, commit.

### Task 4: Spring camera path

**Files:** Create `src/camera.ts`, `src/camera.test.ts`; modify `src/motion.ts`, `src/compositor.ts`, `src/editing.test.ts`.

**Consumes:** `autoZooms`, `smoothPointer`, `playbackSegments`, `sourceTime`, `outputTimeAt`, `springStep`, `memo`.
**Produces:** `cameraAt(p, t): { scale; x; y }`, `poseAt(p, t): Pose` (same `Pose` shape as today).

- [x] Tests:
  - two manual zooms (1–3 s and 3.8–6 s, scale 2) → scale stays > 1.6 for every 1/60 s sample between 2 s and 5 s;
  - an auto zoom with keyframes at (0.2, 0.2) then (0.8, 0.8) → centre ends within 0.02 of the second point's clamped centre;
  - 600 random-order queries equal ascending-order queries exactly;
  - no jumps: sampling at 1/60 s, |Δscale| < 0.08 per frame and |Δ²scale| < 0.03 (a spring starting from rest accelerates hardest on its first frame);
  - after a zoom ends, scale is back within 0.01 of 1 by end + 3 × response;
  - a manual 3D zoom (tilt −15/30/5, follow off) reads 0 tilt at its start and is within 0.01 of the manual values mid-zoom;
  - a 2× speed section over a zoom-in does not change how long (in output time) the zoom-in takes (within 1 frame).
- [x] Wire `compositor.ts` to the new `cameraAt`/`poseAt`, remove `zoomWeight` usage, run unit tests + build, commit.

### Task 5: Camera feel settings, UI, migration

> As built: the `cameraResponse`/`cameraBounce` settings, `cameraFeel` table (in `src/types.ts`) and migration landed in Task 3 because automatic zoom lead time needs them; Task 5 added `withCameraFeel`, the UI and preset keys.

**Files:** Modify `src/types.ts`, `src/settings.ts`, `src/storage.ts`, `src/MotionPanel.tsx`, `src/EditorPanels.tsx`; add tests to `src/editing.test.ts`.

**Produces:** `cameraFeel: Record<"focused"|"smooth"|"gentle", { response: number; bounce: number }>` exported from `src/camera.ts`; `settings.cameraResponse`, `settings.cameraBounce`; `motionEase` accepts `"custom"`.

- [x] Tests: `migrateProject` of a project saved with `motionEase: "gentle"` and no `cameraResponse` gets Floaty values; `cleanSettings` clamps `cameraResponse`/`cameraBounce`; built-in and saved looks that only carry `motionEase` apply matching response/bounce.
- [x] UI: "Camera feel" three-button group (Snappy / Smooth / Floaty) replaces the Movement select; Advanced → "Speed" (response) and "Bounce" sliders, which switch the group to Custom; "Follow cursor while zoomed" toggle; a note on zooms with click keyframes ("Follows N clicks. Moving the focus point pins it to one spot.") and moving Focus X/Y clears `focus`.
- [x] Update Playwright tests that referenced the old Movement select, run unit tests + build + `node tests/browser-smoke.mjs` + `node tests/v2-proof.mjs`, commit.

### Task 6: Playback that holds 60 fps

**Files:** Modify `src/App.tsx`; create `tests/a1-preview-perf.mjs`.

- [x] Playback `tick` renders straight to the canvas (no React state per frame); playhead and timecode update through refs; React `time` state is refreshed at ~4 Hz and on pause.
- [x] While a source video is playing, the preview time comes from `video.currentTime` (the video clock) so the drawn cursor stays locked to the footage; wall clock only for the procedural sample.
- [x] Perf test: builds a 10-minute synthetic project (FFmpeg `testsrc2` 1280×720 30 fps video, 36,000 pointer samples, a click every 5 s, 3D mode, motion blur 25) and imports it; plays 8 s; passes when p95 frame interval ≤ 20 ms and < 2% of intervals exceed 34 ms. Writes `tests/a1-perf-results.json`.
- [x] Run everything, commit.

### Task 7: Phase close

- [x] Run `npm run test`, `npm run build`, `node tests/browser-smoke.mjs`, `node tests/v2-proof.mjs`, `node tests/v2-visual.mjs`, `node tests/a1-preview-perf.mjs`.
- [x] Update README (structure + behaviour), FEATURE-PARITY.md rows (auto zoom, motion styles, cursor smoothing), VALIDATION.md (A1 evidence), STATUS.md, and write Dan's hand-test script.
- [x] Commit and push.

---

## Readability pass (added 2026-09-14, Dan: "the UI as is is hard for me to read")

- [x] Hard-coded 7–23 px font sizes → nine rem tokens in `src/styles.css` (`--text-micro` 12 px … `--text-display` 28 px).
- [x] 44 dim grey text colours lifted to ≥ 5.5:1 contrast on panel surfaces; tool rail, inspector and track labels widened.
- [x] Ctrl + / Ctrl − / Ctrl 0 interface zoom, remembered (Electron).
- Design context recorded in `.impeccable.md`.

## Phase A2 — Recording gets out of the way (as built)

- [x] `capture()` takes a `beforeStart` hook: the screen is shared first (so the click still counts as permission), then the editor hides and the countdown runs, then recording starts.
- [x] Countdown (`#countdown`) and floating bar (`#bar`) are extra windows of the same page (`src/RecordingOverlays.tsx`), frameless, non-focusable, always on top, with `setContentProtection(true)` (Windows "exclude from capture").
- [x] Bar: pause/resume, speaker notes panel (capture-free teleprompter), discard with confirm, finish; closing it finishes the take. Finish brings the editor back to the front.
- [x] "3-second countdown" toggle in the record dialog, remembered.
- [x] `tests/a2-recording-ui.mjs`: bar painted magenta (STUDIO_TEST_MARKER) must be absent from recorded frames and leave no black box; a control run with exclusion off must find it.
- Found while testing: applying the saved zoom level before the window first showed stopped Electron from ever showing it. Fixed; the A2 test asserts the window appears.

## Phase A3 — Real rendering export (as built)

- [x] `src/exporter.ts`: Mediabunny `VideoSampleSink.samplesAtTimestamps` gives the exact source frame per output frame; `renderFrame` draws it (`Media.frame`); `CanvasSource` encodes H.264 (MP4) or VP9 (WebM) at `QUALITY_VERY_HIGH`, key frame every 2 s; GIF via gifenc from the same frames.
- [x] `src/audioMix.ts`: 5 s `OfflineAudioContext` chunks kept just ahead of the video: source pieces through cuts/speeds, exact linear fade automation, looping music, click sounds. `src/stretch.ts`: WSOLA pitch-preserving time stretch for speed sections.
- [x] No hidden worker window was needed: the loop uses no timers or animation frames, and `backgroundThrottling` is off.
- [x] Desktop writes through a `StreamTarget` to `Videos\Studio Screen\Exports` (`studio:export-*` IPC); cancel/failure deletes the file; "Show in folder".
- [x] `tests/a3-export.mjs` (frame count, PTS spacing, frame match, pitch, cancel, minimized desktop export).

## Phase A4 — Native capture helper (as built)

- Spike: a research agent built and ran a probe on this PC and confirmed borderless access for unpackaged apps, dirty regions (build 26100+), fMP4 via `MFTranscodeContainerType_FMPEG4` with ~0.3 s fragments that survive a kill, constant output frame rate, NVIDIA encoder defaulting to Constrained Baseline (set High), loopback QPC already in 100 ns.
- [x] `native/studio-capture` (windows 0.62.2): `capture.rs` (WGC monitor/window, GPU crop, pad on shrink, pool recreate on resize, dirty-region area), `encoder.rs` (sink writer, DXGI surface buffers, H.264 High, GOP 2 s, AAC), `audio.rs` (loopback, float fallback), `input.rs` (LL hooks + 30 Hz cursor-shape polling), `main.rs` (armed start, begin/pause/resume/stop over stdin, CFR loop writing the newest frame per slot, silence fill, 240 Hz pointer throttle, key labelling, JSON-lines events, stats). `check` subcommand + `npm run native:check`.
- [x] Electron: `studio:native-*` IPC, folder per take with `meta.json` status, `studio-media://` protocol with byte ranges and CORS (keeps canvases untainted), recovery scan, `project.json` autosave, helper told to stop when the window closes.
- [x] Renderer: `src/nativeCapture.ts` (same control shape as browser capture), `src/nativeEvents.ts` (event log → points + activity), recorded cursor shapes, cursor hidden outside the area, legacy migration (drawn cursor off for baked-cursor footage), 60 fps default.
- [x] `electron/pointer.ps1` retired; the browser-capture fallback polls pointer position only.
- [x] Tests: `tests/a4-native-capture.mjs` (cursor-free vs control, events, 2 px click accuracy, A/V sync, helper kill, app kill + recovery), `tests/a4-soak.mjs` (memory over a long 4K60 take).

## Phase A5 — Auto-edit on stop (as built)

- [x] `src/autoEdit.ts`: trim to 0.5 s before first action; end trim at the start of the pointer's unbroken run to the bar (bar rectangle sent with "stop") or 0.15 s before Ctrl+Shift+R; typing 2× and idle 4× speed sections tagged `auto`; `backToRaw`; summary line.
- [x] Zoom generation ignores clicks outside the recorded area or after the trim end (the bar click).
- [x] Timeline: dashed automatic clips with a × remove; Pacing panel "Automatic edit" (Back to raw / Apply automatic edit); toast with a Back to raw action (toasts moved to the top of the window).
- [x] Last look reused for new recordings (`studio-last-look`); export settings remembered; Ctrl+E quick export.
- [x] `tests/a5-open-speed.mjs` with `tests/fake-helper.cjs` (a scripted helper replays a prepared 5-minute take so the post-Finish path is measured without recording the screen).

### Extra features — proposed, not built (each needs a spec and Dan's go)

1. **Mark-a-mistake hotkey**: press a key during recording to cut back to the last pause in speech/activity.
2. **Auto-zoom on typing** (FocuSee): zoom to the text caret area during typing bursts.
3. **Device frames** for window recordings (browser/app chrome styles).
4. **Captions from system audio** with an on-device model (useful for recorded videos/meetings; no mic).
5. **Delete recording folders from the library** (currently the library only removes the database entry).
