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

## Phase A2 — Recording gets out of the way (outline; detailed at phase start)

- Electron `setContentProtection(true)` (Windows display affinity "exclude from capture") on a small always-on-top control bar window; main window hides for the take and returns on stop.
- Countdown overlay (3-2-1, skippable, setting remembered).
- Automated check: record the display with the bar painted a unique colour; scan decoded frames for that colour.

## Phase A3 — Real rendering export (outline)

- Decode source frames exactly (Mediabunny or WebCodecs `VideoDecoder`), render each output frame with `renderFrame`, encode with WebCodecs `VideoEncoder` (hardware H.264), mux MP4; audio rendered offline with `OfflineAudioContext` (source gain, music, fades, click sounds).
- Runs in a hidden worker window so minimising doesn't throttle it.
- ffprobe frame-count and PTS checks; existing 3D frame-match proof re-pointed at the new exporter.

## Phase A4 — Native capture helper (outline)

- **Spike first (throwaway):** Rust exe using Windows Graphics Capture with cursor capture off + WASAPI loopback, both timestamped on QPC; prove cursor-free frames and ≤ 20 ms A/V offset on this PC. Stop and re-plan if it fails.
- Real helper: display/window/region capture, hardware encode to fragmented MP4 (recoverable after a crash), WASAPI loopback audio, low-level mouse/keyboard hooks (clicks, right-click, scroll, drag, shortcut combos, typing activity without key text), cursor shape changes, JSON-lines event log. Built by `cargo build --release` from npm scripts.
- Electron main process supervises the helper over stdio; project folders in `Videos\Studio Screen\`; legacy path kept as fallback.
- Retire `electron/pointer.ps1`.

## Phase A5 — Auto-edit on stop (outline)

- Pure `autoEdit(project)` pass: look (last used), gliding zooms, typing speed-ups, idle speed-ups (editable rate), start/end trim; every generated item tagged `auto`.
- Timeline styling for auto items, one-click delete, "Back to raw", summary toast; quick export with last-used settings.
- Extra features specced individually before building.
