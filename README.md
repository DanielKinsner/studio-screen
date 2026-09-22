# Cool Story

Formerly Studio Screen (renamed 2026-09-22). Only the name people see changed: recordings still live in `Videos\Studio Screen`, the library and settings stay in `%APPDATA%\studio-screen`, and `.studio` files keep their `studio-screen` format tag, so older takes and projects open as before.

A local-first screen recorder and editor for Windows that aims to be almost done with the edit the moment recording stops. Inspired by the capture-to-polished-video workflows of Screen Studio and FocuSee; independently built, not affiliated with either.

Personal tool. System audio is recorded; microphone and camera capture are intentionally not included. Direction and decisions: [docs/SPEC.md](docs/SPEC.md). Build plan and what was built: [docs/PLAN.md](docs/PLAN.md). Where things stand: [STATUS.md](STATUS.md).

Moving to another PC? See [the machine handoff](docs/MACHINE-HANDOFF.md) for exact setup commands, local-data transfer, and the paused work.

## Run

Needs Node and Rust (for the capture helper).

```powershell
npm install
npm run desktop:dev
```

`desktop:dev` builds the capture helper (`native/studio-capture`) with Cargo, starts the editor dev server and opens the desktop app maximized on the monitor under the pointer. To see what a PC supports:

```powershell
npm run native:build
npm run native:check
```

The browser editor alone runs with `npm run dev` at `http://127.0.0.1:5173` (editing and export work; recording uses the browser's screen sharing).

Portable Windows build: `npm run desktop:pack` (output in `release/`, unsigned local build).

## Workflow

1. **New recording** → pick a display or window (optionally a custom area). System audio is on by default and records everything the PC plays.
2. **Start recording**. Cool Story hides, counts 3-2-1, and shows a small floating bar: pause, speaker notes, discard, finish. The bar, the countdown and the notes never appear in the video. **Ctrl+Shift+R** also finishes.
3. On Finish the editor opens with an automatic rough cut: dead air trimmed at both ends, typing sped up 2×, waiting sped up 4×, zooms that glide between the things you clicked, and the look you used last. The toast offers **Back to raw**; automatic clips are dashed on the timeline with a × to remove any one of them.
4. Tweak: **Zoom & 3D** (Camera feel: Snappy / Smooth / Floaty, Zoom lead, Zoom while typing, 3D angles), **Pacing** (speed sections, Back to raw / Apply automatic edit), **Canvas**, **Cursor**, **Captions**, **Annotate**. On the timeline, cut like Premiere: **Ctrl+K** splits at the playhead, **C** is the razor (**V** selects), **Delete** leaves a gap and closes a selected gap, **Shift+Delete** ripple-deletes, right-click restores removed footage, **S** toggles snapping; drag the line above the timeline to make it taller. On the preview, drag a selected zoom's focus dot to aim it, and **Alt+drag** to tilt a 3D zoom (Alt+Shift rotates, Alt+scroll changes field of view). One Ctrl+Z undoes a whole drag.
5. **Export video**: MP4, WebM or GIF, rendered frame by frame on the graphics card, usually faster than real time. The desktop app asks where to save (Save As, starting in the last folder used; first time `Videos\Studio Screen\Exports`) and offers **Show in folder**. **Ctrl+E** exports again with the last settings straight into that folder, no dialog. An existing file is only replaced once the new export has finished.

**Ctrl + = / Ctrl + −** makes the whole interface bigger or smaller, and remembers it.

## How it works

- **Capture helper** (`native/studio-capture`, Rust): Windows Graphics Capture with the cursor and yellow border off, hardware H.264 High + AAC system audio (WASAPI loopback) into a fragmented MP4 on one clock, and a JSON-lines event log of pointer moves, clicks, right-clicks, wheel, shortcuts, typing activity (never the keys), cursor shape and screen-change activity. Each take lives in its own folder under `Videos\Studio Screen` (`recording.mp4`, `events.jsonl`, `meta.json`, `project.json`). Killed mid-take, the file stays playable; if the app dies, the helper finishes the file and the next launch recovers it.
- **Editor** (React + TypeScript): one compositor for preview and export. Camera zoom/pan/3D tilt and the drawn cursor come from spring simulations computed once per edit, so scrubbing, playback and export show identical frames.
- **Export**: Mediabunny/WebCodecs decode the exact source frame for every output frame, render, and encode on the GPU; audio (cuts, fades, pitch-preserving speed changes, music, click sounds) is mixed offline.
- If the helper isn't available, recording falls back to browser capture (the Windows cursor is then baked into the video, and the drawn cursor starts off).

## Structure

- `native/studio-capture/`: capture helper (`capture.rs` WGC, `encoder.rs` Media Foundation, `audio.rs` loopback, `input.rs` hooks, `main.rs` protocol and recording loop).
- `electron/main.cjs`, `electron/preload.cjs`: windows, capture exclusion for the bar/countdown, helper supervision, `studio-media://` file streaming, export file writing, recovery.
- `src/App.tsx`: editor shell, recording flow, export flow.
- `src/nativeCapture.ts`, `src/nativeEvents.ts`: talking to the helper and reading its event log. `src/media.ts`: browser-capture fallback and media loading.
- `src/autoEdit.ts`: the automatic rough cut.
- `src/camera.ts`, `src/cursorPath.ts`, `src/spring.ts`: precomputed motion. `src/compositor.ts`, `src/perspective.ts`: rendering.
- `src/exporter.ts`, `src/audioMix.ts`, `src/stretch.ts`: frame-by-frame export and offline audio.
- `src/timeline.ts`: cut/speed mapping, automatic zoom grouping (clicks and typing bursts), typing detection, captions.
- `src/edits.ts`: splits, gaps, ripple cuts, restore, edge drags and snapping on a collapsed timeline (everything stays in recording time).
- `src/aim.ts`: recording point ↔ preview pixel mapping for the focus dot and aim view.
- `src/history.ts`, `src/gesture.ts`: undo history with one step per gesture. `src/previewFrames.ts`: last-good-frame hold and coalesced seeks while scrubbing.
- `src/RecordingOverlays.tsx`: floating bar and countdown. `src/MotionPanel.tsx`, `src/EditorPanels.tsx`: panels. `src/TimelineClip.tsx`, `src/ScreenTrack.tsx`, `src/TimelineMenu.tsx`: timeline clips, the footage track and right-click menus.
- `src/storage.ts`: IndexedDB library, `.studio` files, migration of older projects.

## Tests

```powershell
npm run test          # unit tests
npm run build
# With `npm run dev` running (browser tests use installed Microsoft Edge):
node tests/browser-smoke.mjs
node tests/export-audio-encoder.mjs  # no audio encoder: export stops and says so, never silent
node tests/v2-proof.mjs
node tests/v2-visual.mjs
node tests/v2-audio.mjs
node tests/a1-playback.mjs
node tests/editor-interactions.mjs   # deselect, one undo per gesture
node tests/scrub-frames.mjs          # scrubbing never flashes the empty card
node tests/webm-export.mjs           # browser recordings export every second's picture
node tests/native-export-frames.mjs  # desktop recordings export every frame on time (no stalls)
node tests/3d-fit.mjs                # 3D at padding 0 never crops the card
node tests/export-location.mjs       # desktop: Save As, Ctrl+E, failures keep files
node tests/timeline-resize.mjs       # drag the timeline taller; kept; double-click resets
node tests/cutting.mjs               # split, gap, ripple, restore, razor, snapping, undo
node tests/focus-dot.mjs             # focus dot, aim view, wheel, Alt-drag tilt
node tests/alt-tilt.mjs              # desktop: Alt never shows the menu bar; tilt; shortcuts
node tests/a1-preview-perf.mjs
node tests/a3-export.mjs
node tests/audio-gap.mjs            # helper + real AAC encoder, synthetic audio only
node tests/audio-clock.mjs          # helper's loopback capture keeps every sample (silent, 20 s, needs Rust + ffplay)
# These record the screen and/or move the mouse; they wait for an idle PC:
node tests/a2-recording-ui.mjs
node tests/a4-native-capture.mjs
node tests/a4-cadence.mjs             # helper: 30 fps content lands 2,2,2 recorded frames, never 1,3
node tests/a5-open-speed.mjs
node tests/desktop-capture.mjs      # browser-capture fallback; writes the files export-formats and audio-proof read
# After `npm run desktop:pack` (throwaway profile, doesn't touch your library):
node tests/packaged-smoke.mjs --portable
```

FFmpeg-based checks use `FFMPEG_PATH` (falls back to the AutoPod install). Recordings made by tests are deleted after measuring; results are written to `tests/*-results.json` (git-ignored). Evidence and limits: [VALIDATION.md](VALIDATION.md). Parity with the reference apps: [FEATURE-PARITY.md](FEATURE-PARITY.md).
