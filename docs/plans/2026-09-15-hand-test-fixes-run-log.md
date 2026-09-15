# Hand-test fixes: run log

Run log for [the execution plan](2026-09-15-hand-test-fixes-execution-plan.md) (section 6b). One entry per slice: what shipped, verification with numbers, skipped tests, and every deviation or judgment call.

Executor: Claude (Opus 5), one session on Dan's office PC, 2026-09-15.

## Baseline (before any change)

- `git pull origin main`: already up to date at `babac5f`.
- `npm test`: 12 files, **65 passed**. `npm run build`: OK (952.66 kB main chunk, existing size warning).
- With `npm run dev`: `node tests/browser-smoke.mjs` PASS; `node tests/a1-playback.mjs` PASS.

### Plan-vs-code notes found while reading (before slice 1)

- The timeline button the plan calls **Cut** is labelled **Remove 1s** in the code (`addCut`, App.tsx). Same behaviour (removes 1 s at the playhead).
- The footer version badge is hard-coded `v0.2.1` (App.tsx footer), so a `0.3.0` search in slice 12 would not find it. Handled in slice 12.
- Line numbers in the plan are close but not exact (App.tsx is 2,828 lines now); every cited mechanism exists as described.

## Slice 1: Deselect (R8)

**Shipped:** pressing empty timeline space clears the selection and still scrubs; pressing the preview (outside buttons and future overlay controls) clears it; Esc clears it when no modal is open. New `tests/editor-interactions.mjs` (README → Tests).

**Root cause:** the timeline's pointer-down handler only scrubbed and nothing else ever set `selected` back to null.

**Verification:**
- `node tests/editor-interactions.mjs` failed first ("Clicking empty timeline space did not clear the selection"), then PASS: 2 zoom clips before and after Delete in all three cases; empty-space press scrubbed the playhead to 97%.
- `npm test` 65 passed; `npm run build` OK; `browser-smoke` PASS; `a1-playback` PASS.

**Deviations / judgment calls:**
- With an annotation selected, a press on the preview frame still *places* that element (the existing "targeting" behaviour) instead of deselecting. Deselecting there would break annotation placement. Presses on the halo around the frame still deselect.
- Esc works even when focus is still on a slider or colour input (focus stays on a range input after dragging it), but not in text fields, textareas or selects. Other shortcuts keep the old input guard unchanged.
- The preview handler ignores `button` and `.preview-control` elements; slice 11's dot will use `.preview-control`.

Commit: `b5ff520`.

## Slice 2: One undo step per gesture (R7)

**Shipped:** `src/history.ts` (`EditHistory`: merge by gesture key, 500 ms idle end, cap 200, redo cleared on new edit) with 8 unit tests. `src/gesture.ts` tags every edit caused by an `<input>`/`<textarea>` event with that control's gesture key automatically. `edit(fn, { gesture })` accepts an explicit key for custom pointer drags (used later by slice 11). Ctrl+Z / Ctrl+Shift+Z now also work while a slider or colour input still has focus.

**Root cause:** `edit()` pushed one history entry per `onChange` event and kept only 40, so one slider drag became dozens of 0.05 steps and pushed real edits out of undo.

**Verification:**
- Browser test failed first: "One undo after the drag gave 2.45×, expected 1.65×" (exactly Dan's report).
- After the fix `node tests/editor-interactions.mjs` PASS: drag 1.65 → 2.5 in 40 moves, one Ctrl+Z → 1.65; second Ctrl+Z restored Padding 15 → 8; second drag to 2.8 then Ctrl+Z with the slider focused → 1.65.
- `npm test` 13 files, 73 passed (+8); `npm run build` OK; `browser-smoke` PASS; `a1-playback` PASS.

**Deviations / judgment calls:**
- Instead of adding a gesture prop to `Slider` and every number/colour field by hand, gestures are detected once from the DOM `input` event (capture listener; the key is valid only while that event is dispatching, checked with `event.eventPhase`). This covers Slider, number fields, colour pickers and text fields everywhere with no per-call-site plumbing; `Controls.tsx` did not need to change.
- A gesture ends on pointer release, focus change, or 500 ms without an edit, **except** the 500 ms rule is skipped while a pointer is held, so pausing mid-drag doesn't split one drag into two steps.
- Native `change` does not end a gesture: Chromium fires `change` on every keyboard arrow step of a range input, which would defeat the plan's "500 ms covers keyboard arrows" rule. Pointer release and blur cover the mouse cases.
- Typing in text fields (project name, captions) now merges bursts typed less than 500 ms apart into one step instead of one step per keystroke. Ctrl+Z inside text fields is still left to the field.
- The region picker (record dialog) is not part of project undo at all (it sets local state), so nothing to apply there.
- `edit()` now ignores edits that return the same project object (no empty undo steps).

Commit: `7221120`.

## Slice 3: No white frames while scrubbing (R4)

**Shipped:** `src/previewFrames.ts`: `FrameHold` keeps a copy (longest side ≤ 1920 px) of the last settled video picture and hands it to the compositor as `media.frame` while the video is seeking or not ready; `Seeker` coalesces paused seeks (one in flight, the newest request runs when it lands). Wired into App's paused render, the seek effect, playback start and the playback cut-skip seek. New `tests/scrub-frames.mjs` (README → Tests). `compositor.ts` and `exporter.ts` are unchanged, so export renders exactly as before.

**Root cause:** the compositor paints the off-white card and only draws video when `readyState >= 2`; every pointer move restarted the seek, so the video was almost never ready while scrubbing.

**Verification:**
- `node tests/scrub-frames.mjs` (20 s 1080p60 H.264 fixture, 5 s GOP, 40 moves) failed first: **empty card on 128 of 307** sampled animation frames. After the fix: **0 of 326**. The paused frame after release matched the decoded frame at the playhead (18.400 s): mean difference 1.92 vs 5.24 / 5.07 for ±0.25 s.
- `npm test` 73 passed; `npm run build` OK; `browser-smoke`, `a1-playback`, `editor-interactions` PASS.
- `node tests/a1-preview-perf.mjs` PASS (playback path changed): p95 17.0 ms, 1.05% dropped, 59.4 fps (previous run 16.8 ms, 0%). Premiere Pro was open and Dan was using the PC.
- `node tests/a3-export.mjs`: first run **failed only the speed budget** (60 s export 30.27 s vs < 30 s; desktop 31.5 s); frames 3600, frame difference 2.19, pitch 439/440.7 all passed. Premiere Pro was running (8.6 GB) and the PC was in active use. Rerun with no code change: **PASS**, 22.95 s, 3600 frames, even spacing, difference 2.19, edited 480 frames, desktop 3600 frames in 29 s, cancel 2 → 1 files.

**Deviations / judgment calls:**
- The hold copy is made only for paused renders (once per landed seek, skipped if the time hasn't changed) and right before a seek we start ourselves during playback, not every playback frame, to keep the 60 fps preview budget.
- Seek tolerance dropped from 0.04 s to 0.5 ms. The old threshold meant a one-frame arrow step (1/30 s) never seeked the video, so the drawn cursor moved but the picture didn't.
- `requestVideoFrameCallback` was not needed: in Edge, drawing after `seeked` already matches the exact decoded frame (test above).
- The fixture is `tests/scrub-source.mp4` (git-ignored by `tests/*.mp4`).

Commit: `4cab9ce`.

## Slice 4: Predictive camera on fast clicks (R10)

**Shipped:** in `buildPath` (`src/camera.ts`) the follow-cursor clamp is skipped during a focus keyframe's lead window (keyframe `t` → its `click` time; hand-placed keyframes without `click` use `t + zoomLead(response)`). Generated focus keyframes now carry optional `click` (types, `generateZooms`, and `.studio` import keeps it when finite).

**Root cause:** the camera aimed at the next click early, but the follow-cursor clamp pinned the view centre within `0.3/scale` of the *current* pointer, which hadn't travelled yet, cancelling the head start.

**Verification:**
- New unit test failed first (`expected 0.30302 to be greater than 0.30312`: no movement after the keyframe).
- After the fix, the plan's scenario (Snappy, clicks at 2.0 s top-left and 2.6 s bottom-right, pointer travels only in the last 0.2 s): second keyframe at 2.258 s; centre x 0.3030 → 0.3517 one frame (1/30 s) later → **0.6929 at 2.6 s = 99% of the way** to the clamped target 0.697 (plan requires ≥ 70%).
- `npm test` 74 passed; `npm run build` OK; `browser-smoke`, `a1-playback` PASS.
- `node tests/a3-export.mjs` PASS: 60 s export 25.88 s, 3600 frames, gap spread 1e-6 s, frame difference 2.19, AAC; edited 480 frames, 8 s audio, pitch 439/440.7; cancel AbortError with 0 downloads; desktop minimized 22.6 s, 3600 frames, files 2 → 1.

**Deviations / judgment calls:**
- The lead window also applies to the first keyframe of an automatic zoom (zoom start → first click), so the zoom-in aims at the first click rather than wherever the pointer is on its way there. Same rule, same intent.
- `zoomLead(response)` is used for hand keyframes now; slice 5 adds the extra lead through the same variable.

Commit: `f3f3a42`.

## Slice 5: Zoom lead slider (R5, D1)

**Shipped:** `Settings.zoomLead` (default 0.5, limits 0–1.5, in `styleKeys`). `zoomLead(response, extra)` = `clamp(0.9 × response, 0.3, 1.2) + extra`, passed through `generateZooms` (memo arg; grouping and focus keyframes) and the camera's lead window; `cameraPath` cache key includes it. **Zoom lead** slider (0–1.5 s, step 0.05) under Move time / Bounce in Focus & 3D → Automatic focus & animation → Camera spring, with a live line "Automatic zooms start moving N s before each click." The camera springs now start from the neutral pose, so an edit never opens mid-zoom.

**Verification:**
- 5 new unit tests failed first (no `defaults.zoomLead`; zoom started at 4.46 instead of 3.96; the video opened at scale 2.5 when a zoom started at the trim start), then passed: leads Snappy 0.842 s, Smooth 1.04 s, Floaty 1.355 s; zoom and every focus keyframe start 1.04 s before its click; `zoomLead: 0` restores 0.54 s; a project saved without `zoomLead` migrates to 0.5 and still zooms (scale > 1.5 at 4.5 s); `cleanSettings` clamps 9 → 1.5 and −1 → 0; first sample is exactly `{scale 1, x 0.5, y 0.5}` and the flat pose (perspective 45) at trim start 0 and 2, reaching > 2.3× two seconds later.
- `npm test` 79 passed; `npm run build` OK; `browser-smoke`, `a1-playback`, `editor-interactions` PASS.
- Browser pane: slider shows 0.5 s by default; set to 1 s, then **Snappy** → still 1 s, line reads "1.34 s before each click".
- `node tests/a3-export.mjs`: **correctness passed on both runs** (3600 frames, gap spread 1e-6 s, frame difference 2.19, AAC; edited 480 frames, pitch 439/440.7; cancel clean; desktop 3600 frames, files 2 → 1) but the **speed budget failed twice** (60 s export 30.05 s, then 72.52 s). During the second run the CPU sampled 99% with Premiere Pro accumulating ~640 CPU-seconds in 15 minutes while Dan worked. A3's project has auto-zoom off and its only zoom starts at 10 s, so nothing this slice changed runs differently during that export (the frame difference is bit-identical at 2.19). **Not a stop trigger:** the assertion doesn't need changing, and the machine is busy. A3 will be re-run for speed in slice 6 (which changes the 3D render) and again in slice 12.

**Deviations / judgment calls:**
- Settings fields in this codebase are non-optional and filled by `migrateProject` from `defaults` (like `cameraResponse`), so `zoomLead` follows that pattern rather than being `?:` optional; `autoZooms` and the camera also fall back defensively if an unmigrated object appears.
- The neutral opening applies to every channel (scale, centre, tilt, offset, perspective, lift), not only scale.

Commit: `4701e8a`.

## Slice 6: 3D never crops the recording (R2)

**Shipped:** `src/perspective.ts` gains `project(pose, aspect, px, py, fit)` (the vertex shader's math in TypeScript), `fitScale(pose, aspect, margin, card)` and `FIT_MARGIN = 0.02`; the shader takes a `fit` uniform that scales the projected result about the frame centre. `src/compositor.ts` exports `cardRect()` (the card's pixel rectangle, now shared with `drawScreen`) and fits every 3D sample, including motion-blur samples, for preview and export alike. New `tests/3d-fit.mjs` (README → Tests) and `src/perspective.test.ts` (5 tests).

**Root cause:** the 3D renderer tilts the whole screen layer and nothing corrected for corners that project past the canvas edge; at padding 0 the card already touches the edges before tilting.

**What the 3D texture contains:** a canvas-sized transparent layer with only the card (shadow, recording, cursor, browser bar) drawn inside it; the background is drawn separately underneath. The fit therefore uses the card's own four corners, not the layer's.

**Verification:**
- `tests/3d-fit.mjs` failed first at padding 0 + max tilt/rotation/FOV: **1,024 card pixels on the frame edge** (card cut off on the left and top). After: default 3D zoom at padding 0 → 0 edge pixels, near-white card share 0.374 (flat 0.622); maximum tilt 40/40/30 at FOV 75 → 0 edge pixels, share 0.175. Screenshots `tests/3d-fit-default.png`, `tests/3d-fit.png` (git-ignored) show all four corners inside the frame.
- Unit tests failed first (no functions), then pass: flat projection identity; flat card → 1 at padding 0 and padded; three extreme poses (±40/±40/±30, FOV 25 and 75, offsets ±60) → fit < 1 with all projected corners within 0.98; fit changes < 0.01 per 0.25° step while tilting from flat to 40° (no jump); a card at ±0.7 with the default tilt → 1.
- `npm test` 14 files, 84 passed; `npm run build` OK; `browser-smoke`, `a1-playback`, `v2-visual` PASS.
- `node tests/v2-proof.mjs` PASS: 3D export vs compositor difference 2.14, effect difference **15.33** (assertion > 15). A/B with the fit temporarily disabled gave 16.41 (matching VALIDATION's 16.4), so the fit is what lowered it; still passes unchanged, but the margin is now thin.
- `node tests/a3-export.mjs` PASS (machine quieter this time): 60 s export **24.16 s**, 3600 frames, gap spread 1e-6 s, frame difference 2.21 (was 2.19: the compared 3D frame now includes the fit on both sides), AAC; edited 480 frames, pitch 439/440.7; cancel clean; desktop 23.6 s, 3600 frames, files 2 → 1. This also clears slice 5's load-blocked speed check.

**Deviations / judgment calls:**
- The fit scales the projected card about the **frame centre** (the plan's "largest scale ≤ 1"). That always has a solution, even with a 60% offset that pushes the card's centre out of frame; with extreme asymmetric poses the fitted card can sit off-centre.
- The 2% margin **fades in** with the amount of 3D (sum of |tilts| and |offsets|, full at 4). A flat card at padding 0 touches the edges, so a fixed margin would make the picture jump 2% the moment a 3D zoom starts.
- At the **default padding (8%)** the default 3D tilt already reaches the margin, so default 3D zooms are now about **1.2% smaller** than before. That is the intended no-crop margin, not a separate change.
- No stored expected image needed updating: `tests/3d-expected.png` is regenerated from the compositor on every `v2-proof` run.

