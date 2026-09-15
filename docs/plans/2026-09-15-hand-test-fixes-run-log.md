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

Commit: `ceb6811`.

## Slice 7: Choose where exports go (R12, D7)

**Shipped:**
- `electron/main.cjs`: `studio:export-open(name, ext, { quick })` shows `dialog.showSaveDialog(mainWindow, { defaultPath, filters })` starting in the remembered folder; cancel returns `null`; `quick` (Ctrl+E) or `STUDIO_EXPORT_DIR` skip the dialog and use `uniquePath`. The last folder is kept in `userData/export-state.json` (`{ lastDir }`), validated on read (absolute, existing directory) with fallback to `Videos\Studio Screen\Exports`, updated after a successful export. Exports render into `<file>.partial` and are renamed over the target only on success; cancel/failure deletes only the `.partial`. `studio:reveal` also allows any file exported this session.
- `preload.cjs` passes options; `App.tsx` `runExport(quick)`: a cancelled Save As returns quietly with the dialog still open (progress only appears after a path is chosen); toasts and the done subtitle say "Saved to <folder name>."; Ctrl+E passes `quick`.
- New `tests/export-location.mjs` (README → Tests and Workflow updated); `.gitignore` adds its folders.

**Verification:**
- `node tests/export-location.mjs` PASS (Electron, main-process stubs for the dialog and `shell.showItemInFolder`, test profile seeded to a throwaway folder): (1) dialog default `…\.export-location\start\Export location test.mp4`, filter `MP4 video`; the pre-existing "ORIGINAL" `Chosen name.mp4` replaced by a 1,561,459-byte MP4 (`ftyp`), no `.partial` left, `lastDir` persisted to `…\chosen`, toast "Export complete. Saved to chosen.", subtitle "Saved to chosen.", Show in folder revealed that exact path; (2) cancel: no new file, 0 toasts, no progress bar, Export button enabled; (3) Ctrl+E: no extra dialog call, `Export location test.mp4` saved in `chosen`; (4) with the write IPC forced to fail, the toast showed the error and `Keep me.mp4` still read "KEEP ME", no `.partial`; (5) corrupt `export-state.json` → dialog opened in `C:\Users\SM - Dan\Videos\Studio Screen\Exports` (cancelled, nothing written).
- `npm test` 84 passed; `npm run build` OK; `browser-smoke` (browser download path unchanged) PASS; `a1-playback` PASS.
- `node tests/a3-export.mjs`: **correctness passed twice** (3600 frames, gap spread 1e-6 s, difference 2.21; edited 480 frames, pitch 439/440.7; cancel clean; desktop minimized, `STUDIO_EXPORT_DIR` with no dialog, 3600 frames, files **2 → 1** during/after cancel via the new `.partial`) but the **speed budget failed** (37.81 s and 39.30 s; desktop 42.9/43.4 s). Cause found: **Codex was running another project in parallel** (`yes-master`: `cargo build --example mastering_quality_witness`, headless verify scripts, several Vite servers), and Dan had the real Studio Screen 0.3.0 open. A3's browser export calls `exportProject` directly and never runs any code this slice changed. Not a stop trigger; speed re-checked in later slices.

**Deviations / judgment calls:**
- The Save As default file name is the auto-numbered unique name (e.g. "My video (2).mp4"), so pressing Enter never replaces an earlier export by accident; choosing an existing file still replaces it (Windows asks first).
- If the chosen name has no matching extension, it is appended.
- The folder is remembered only after an export **succeeds** ("last folder used"), not when a dialog is confirmed and then cancelled.
- If the final rename fails (for example, the old file is open in a player), the `.partial` is removed and the toast says to close the file and export again.
- The modal's Export button used `onClick={runExport}`, which would have passed the click event as `quick` and skipped Save As; changed to `() => runExport()`.
- If the app is killed mid-export, a `.partial` file can remain next to the target (the original is untouched).
- Raw IPC error text ("Error invoking remote method…") is still shown for disk errors, as before.

Commit: `43bc10c`.

## Slice 8: Resizable timeline (R11)

**Shipped:** a row-resize handle (`role="separator"`, "Resize timeline") straddling the top border of `.timeline-section`: drag to resize between the resting height and 70% of the editor, double-click resets, Up/Down arrows step 20 px when focused; remembered in `localStorage["studio-timeline-height"]` (try/catch). One CSS variable drives it: `.editor { --timeline-default: 278px }`, `.timeline-section { height: var(--timeline-height, var(--timeline-default)); max-height: max(default, 70%) }`. Tracks and labels are flex columns sized from the body (`container-type: size`, `100cqh`), so rows grow together; clips use top/bottom insets instead of fixed heights. New `tests/timeline-resize.mjs` (README → Tests).

**Verification:**
- `node tests/timeline-resize.mjs` failed first (no handle), then PASS at both sizes:
  - **1920×1080:** resting 278 px (screen row 44, zoom row 29, label 29, clip 22; preview 507 px tall). Dragged up 200 px → **478 px**, zoom row 64.9 = label 64.9, clip 57.9, screen row 100.4, preview **307 px** with its bottom 34 px above the playback bar, no horizontal overflow. Same after reload; double-click → 278 / 44 / 29 again.
  - **1366×768:** resting identical; drag clamped to **463 px** (70% of the 662 px editor), zoom row 62.2, preview 56 px, no overflow; kept after reload; double-click resets.
  - Screenshots `tests/timeline-resize-1920.png` / `-1366.png` (git-ignored) checked by eye: aligned labels and rows, nothing clipped.
- `npm test` 84 passed; `npm run build` OK; `browser-smoke` (includes the 390 px mobile overflow check), `a1-playback`, `editor-interactions`, `scrub-frames`, `v2-visual` (mobile overflow), `v2-proof` (clip drag on the zoom row) PASS.

**Deviations / judgment calls:**
- **Plan claim that didn't match the code:** the duplicated heights (250/168 base, 265/182 at ≥1600 px, 245 at ≤850 px) were all dead. The later unconditional `278px`/`196px` rules come after the media queries (which add no specificity), so the real default was 278 px at every breakpoint. Consolidating to one 278 px default therefore changes no breakpoint's look; the test pins the resting sizes exactly.
- Rows keep their proportions rather than being exactly equal ("available height ÷ track count" taken literally would change the resting look): the screen row keeps its 44:29 ratio to other rows as they grow. The first measurement drifted (screen 46.8 px, rows 28.5 px, labels off by 0.7 px) because flex bases can't go below padding and borders; fixed by removing the screen row's unused `padding-top`, sharing borders consistently, and weighting rows 44/28 with a 1 px border.
- The bottom 7 px of the timeline body stay free for the horizontal scrollbar (as the old 6 px of slack did), so labels and rows stay aligned when the timeline is zoomed in.
- Resizing is a layout preference, not a project edit, so it is not part of undo.
- At 1366×768 the 70% cap leaves a 56 px preview. Allowed by the plan ("even at the expense of the preview").

Commit: `188e1bd`.

## Slice 9: Premiere-style cutting (R9, D2–D6)

**Stop-trigger check (section 6.2):** the collapsed-view model (D6) works. Every consumer of `cuts` either skips them for output (`visibleSegments` → playback, export, audio, captions, click sounds, camera) or only draws them, so ripple is purely a drawing rule. No stored item needs re-timing.

### 9a: Model and pure functions

**Shipped:** `Cut.ripple?: boolean` (new `Range` type for plain spans; `hiddenCursor` uses it), `Project.splits?: number[]`. New `src/edits.ts`: `pieces`, `editPoints`, `splitAt` (no-op within 1/60 s of an edit point), `deletePiece({ ripple })`, `closeGap`, `restore`, `rippleItems` (same-step side effects), `timelineTime`, `sourceFromTimeline`, `timelineDuration`, and `dragEdge` for 9c's edge drags (trim ends, cut edges, split edges; Shift = ripple). `generateZooms` ignores clicks inside any cut (memo arg `cuts`). `migrateProject` normalises `splits` (sorted, unique, finite; `[]` when missing); `.studio` import validates `ripple` (boolean) and `splits` (finite numbers).

**Verification:** `src/edits.test.ts` 15 tests PASS: pieces/splits (including splits outside the trim ignored, and within-a-frame no-ops); gap delete (output 20 → 15 s, timeline width unchanged, zooms untouched); ripple delete (a zoom fully inside removed, one crossing an edge clipped 3–7 → 3–5, one spanning kept with its inside focus keyframe dropped; a speed section after it keeps source 12–16 and draws at 7–11; caption/annotation/hidden-cursor side effects); close gap → ripple, restore → footage back while ripple-deleted items stay gone; 0.25 s output guard; gap vs ripple produce identical `outputDuration` and `sourceTime`; mapping both ways around overlapping ripple cuts (collapse point opens onto the following footage); edge drags (split → gap or ripple, grow/reclaim a gap, Shift beside a plain gap adds a separate ripple cut, trim ends); automatic zooms vanish for clicks in a gap or ripple and return on restore; an old project without `splits`/`ripple` migrates, plays and zooms. `npm test` 15 files, **99 passed**.

**Deviations / judgment calls:**
- Splits outside the trim range are **ignored, not deleted**, so trimming in and back out keeps them (the plan's invariant "strictly inside the trim range" holds for everything that reads them).
- Deleting a piece keeps the split points at its edges, so Restore brings back exactly that piece.
- Shift-dragging next to a plain gap adds a separate ripple cut for the newly removed part instead of converting the whole gap into a ripple.
- Edge drags that would leave < 0.25 s of output return the project unchanged (the drag simply stops having an effect).

Commit (9a): `82af9ae`.

### 9b–9d: Collapsed timeline drawing, tools, menus, snapping

**Shipped:**
- **One mapping for the whole timeline** (`Axis` in `TimelineClip.tsx`: `tl`, `src`, `total`, built from `timelineTime`/`sourceFromTimeline`). Ruler labels (timeline time), playhead (paused and during playback), scrubbing, the screen track, gaps, ripple markers, zoom/caption/annotation/speed clips and filmstrip thumbnail times all go through it. Grep: no `/ project.duration` or `/ p.duration` math remains in timeline JSX.
- New `src/ScreenTrack.tsx`: each piece is its own block (dark divider at splits, peach outline when selected), gaps are the hatched blocks with draggable edges, ripple cuts show a small marker at the collapse point (tooltip "Removed 9.0 s: right-click to restore"), trim grips on the outer edges now actually drag, and the razor shows a scissors cursor with a hover line.
- New `src/TimelineMenu.tsx`: right-click menus (arrow keys, Enter, Esc/Tab/click-away close). Piece: Split at playhead · Delete (leave gap) · Ripple delete. Gap: Close gap · Restore footage. Ripple marker: Restore footage.
- Toolbar: Select (V) / Razor (C) toggle group, **Split** (Ctrl+K) replacing **Remove 1s**, Add zoom, Delete, and a **Magnet** snapping toggle (S; `localStorage["studio-snap"]`, default on). Keys: Ctrl+K split at playhead; Delete/Backspace: piece → gap, gap → close (ripple), other clips → remove as before; Shift+Delete ripple-deletes a piece; Esc also returns to Select. Help dialog lists the new shortcuts.
- Edge drags (pieces, gaps, trim grips) run through `dragEdge` with a live draft and one undo step on release; Shift = ripple.
- Snapping within 8 CSS px for clip moves/resizes, edge drags, razor and playhead scrub, to the playhead (not for scrubbing itself), all edit points and other clips' edges; thin peach snap line while snapped.
- `TimelineClip` rewritten onto the axis with snapping; `Filmstrip` takes explicit sample times; `IconButton` gains `pressed` (aria-pressed). Pacing panel's removed-ranges list now says "Gap" or "Closed gap".
- `tests/a3-export.mjs` gains case 2b (gap + ripple export); new `tests/cutting.mjs` (README → Tests).

**Verification:**
- `node tests/cutting.mjs` PASS on the sample project: Ctrl+K at 8 s and 17 s → 3 pieces; Delete middle piece → 1 hatched gap, duration 00:24 → **00:15**, hand zoom box unchanged (x 591, w 110); select gap + Delete → 0 gaps, 1 marker, "Make room for what matters." moved from x 883 to 752 (9 s into the now 15 s timeline, ±2 px); right-click marker → Restore → 3 pieces, caption back at 883; Shift+Delete first piece → 2 pieces, 00:16, then undo; C + click at 2.5 s → 4 pieces (razor line shown on hover); auto zoom dragged from 3.96 s to 5 px short of the 8 s split → snap line shown → **start exactly 8**; eight Ctrl+Z presses walk back through drag, razor, restore, close gap, gap, add zoom and both splits one step each; piece edge dragged 2 s inward → gap (00:22); Shift-drag → ripple (00:22); trim grip dragged 0.9 s → snapped onto the caption at **1 s**; `.studio` round-trip keeps `splits` and `ripple`; 0 page errors.
- Screenshot check: selected piece outline, hatched gap over the filmstrip, ruler in timeline time, menu styled like the app with "Split at playhead" disabled off-clip.
- `npm test` 15 files, **100 passed** (+`snapValue`); `npm run build` OK; `browser-smoke`, `a1-playback`, `editor-interactions`, `scrub-frames`, `timeline-resize`, `3d-fit`, `v2-visual` PASS; `v2-proof` PASS (export difference 2.14, effect difference 15.33, clip drag + undo).
- `node tests/a3-export.mjs`: new **case 2b PASS** (output 9 s, **270 frames** at 30 fps, even spacing, 9.000 s). All other correctness passed (3600 frames, difference 2.21, 480 frames, pitch 439/440.7, cancel clean, desktop 3600 frames in 27.9 s, files 2 → 1); the browser 60 s export took **35.13 s**, over its 30 s budget again.
- **Speed A/B to rule out a regression:** a temporary worktree at `ceb6811` (slice 6, where A3 passed in 24.16 s) was served on port 5199 and the identical 60 s 1080p60 3D export was timed alternately against old and new code in headless Edge. Old: 29.13, 41.21, 32.96, 26.39, 35.69 s. New: 47.52, 34.74, 25.98, 22.97, 49.12 s. The ranges overlap completely and the new code posted the two fastest runs, so the swings are machine load (Codex's `native-lifecycle-probe-v2` and node processes were running), not this work. Both idle apps held 60 fps with zero long tasks. The worktree, its junction links (removed as links only; `node_modules` and the 145 MB fixture verified intact), the second server config and the temp scripts were removed.
- Mishap during the A/B, fixed: the old-code server first shared the main `node_modules/.vite` cache through the junction and invalidated one pre-bundled dependency (504 "Outdated Optimize Dep"). I stopped it, restarted the main dev server (clean re-optimise; playback test PASS, deps served 200), and gave the old server its own `cacheDir` before retrying.

**Deviations / judgment calls:**
- **Fit-to-width timeline:** the timeline already stretches its full length across the width, so closing a gap rescales everything to the shorter length rather than leaving empty space at the end like Premiere. Clips still slide left; the test checks the exact new position.
- Pressing a **piece** selects it *and* scrubs from there (pieces cover the whole screen row, which was a scrub surface before). Gaps select without scrubbing; ripple markers are right-click only (Delete does nothing to them).
- Because ripple cuts have zero width, dragging the edge beside a collapse point outward reclaims that footage almost all at once; Restore footage is the precise way back.
- Auto zooms whose click falls inside removed footage disappear (9a rule), so the browser test's "zoom clips over the gap unchanged" check uses a hand zoom.
- Hidden-cursor ranges have no timeline track today; they ripple with the footage (9a) but there is nothing to draw.
- At ≤ 480 px the Split and Add zoom buttons show icons only (with accessible names), because the extra tool buttons made the 390 px layout scroll sideways (caught by `browser-smoke`).

Commit (9b–9d): `974aafb`.

## Slice 10: Auto-zoom while typing (R1, D9)

**Shipped:** `generateZooms` now builds "moments" from clicks **and** typing bursts. `typingBursts()` (shared with `typingSections`: gaps < 1.4 s, ≥ 3 keys, span ≥ 0.5 s) runs on typing points outside cuts and before `trimEnd`. Each burst is a moment at its start that holds until burst end + `AUTO_HOLD`, aimed at the last click in the recorded area within 10 s before it, else the pointer position at burst start. Moments go through the unchanged grouping (`MERGE_GAP` against the group's furthest hold), dead-zone, coalesce and lead logic. Groups that start with a burst get id `auto-type-<t>` (dashed, ×, dismissable); click-led groups keep `auto-<t>`, so existing dismissals still match. New setting `zoomWhileTyping` (default true, not a style key) with a **Zoom while typing** toggle under Automatic zoom. No native changes.

**Verification:**
- 6 new tests in `src/timeline.test.ts` failed first, then pass: click at 3 s + typing 4–7 s → **one** zoom `auto-3`, end 7 + 2.2 s, a single focus point, camera scale > 1.5 the whole way (no zoom out and back); typing 14–16 s with the last click 13 s earlier → separate `auto-type-14` at the pointer (0.7, 0.2), magnification = zoom strength; typing 7 s after a click → too far to merge (same rule as two clicks), so `auto-type-9` aims at the clicked field (0.25, 0.75) though the pointer moved away; sparse keys → none; burst in a gap → none; in a ripple cut → none; after trim end → none; toggle off → none; dismissed → none; autoZoom off (Back to raw) → none; `zoomWhileTyping` defaults on for old settings and isn't in `styleKeys`.
- New auto-edit test: a take with only typing → summary counts **1 zoom** (`auto-type-4`), Back to raw removes it.
- `npm test` 15 files, **107 passed**; `npm run build` OK. Browser pane: the Focus & 3D panel shows "Automatic zoom", "Zoom while typing" (on, "Zoom in where you type, holding until you stop"), "Follow cursor while zoomed".
- `browser-smoke`, `a1-playback`, `editor-interactions`, `cutting` PASS.
- `node tests/a3-export.mjs`: the first run exited with an error **before writing results**; the message was cut off by my output filter and I couldn't recover it. Two reruns with no code change passed: **25.1 s** (desktop 26.8 s), then **20.52 s**, exit 0 (desktop 21.1 s; 3600 frames, difference 2.21, 480 frames, pitch 439/440.7, gap+ripple 270 frames, cancel 2 → 1).
- **`node tests/a5-open-speed.mjs` not run: PC in use** (idle 0.14–0.33 s). A5 injects no real input (it uses the scripted fake helper), but the real app window hides and reappears, so it follows the idle rule. Retried in slice 12.

**Deviations / judgment calls:**
- Burst-led zoom ids use the `auto-type-` prefix. They stay distinct from click zooms at the same time, and still start with `auto-` for dismissal, the dashed style and the auto-edit count.
- When no click is within 10 s and no pointer sample precedes the burst, the first recorded point (or the centre) is used; coordinates are clamped to the frame.
- A click that sits inside removed footage can still be the aim for a later burst (its position is still where the field is); only the timing of moments inside cuts is dropped.

Commit: `9d3791c`.

## Slice 11: Focus dot, aim view and Alt-drag tilt (R3, R6, D8)

### 11a: Dot and aim view

**Shipped:** new `src/aim.ts`: `toPreview`/`fromPreview` (recording point ↔ preview pixel through the 2D camera, crop and, for 3D, the same projection and fit as slice 6), `focusAt` (active keyframe at the playhead, else the zoom's point), `aimZoom` (moves that keyframe; keyframe 0 also moves the zoom's own point), `zoomArea` (clamped like `clampCenter`). `perspective.ts` gains `unproject` (exact inverse: a tilted plane in perspective is a homography, so it's a 2×2 solve). In App, a selected zoom shows a peach **focus dot** on the preview (hidden while playing). Pressing it opens **aim view** until release: the preview renders the flat, unzoomed, uncropped frame (a project copy with one shared empty zoom list, so its camera path stays cached), a rectangle shows the zoom's area with the rest dimmed, faint ghost rings mark every other zoom's focus points, and dragging moves dot and rectangle; release commits one undo step (nothing if it didn't move). Wheel over the dot or in aim view: ±0.05× per notch within 1.05–4, one undo step per burst (gesture key). Editing an automatic zoom this way takes ownership (copied into `p.zooms` with the same id), via one `editZoom` helper.

### 11b: Alt-drag tilt

**Shipped:** with a 3D zoom selected, **Alt+drag** on the preview sets tiltY from horizontal and tiltX from vertical motion at 0.25°/px, **Alt+Shift+drag** sets tiltZ, **Alt+wheel** changes the field of view ±2° per notch; all clamped to the slider ranges, live, one undo step per gesture. `Zoom.manualTilt?: boolean` is set by Alt-drag, the tilt sliders and the tilt presets; `buildPath` uses the zoom's own tilt when `manualTilt` is set, while cursor-follow panning continues; MotionPanel shows the tilt sliders for such zooms. `.studio` import validates `manualTilt`. Alt+drag on a 2D zoom shows "Switch this zoom to 3D to tilt it." once per session.

**Electron menu bar:** `autoHideMenuBar: false` plus `mainWindow.setMenuBarVisibility(false)`. The default menu, and so its accelerators, stays; only the Alt toggle (which exists only for auto-hide bars) is gone.

**Verification:**
- Probe before the fix (`webContents.sendInputEvent` Alt press/release): menu bar became **visible** and the content area moved from y 23 to 49 (1370 → 1344 px tall). Playwright's own `keyboard.press("Alt")` did *not* reproduce it (CDP key events skip that path), so the Electron test uses `sendInputEvent`. After the fix: menu hidden, bounds unchanged.
- Unit tests: `src/aim.test.ts` 7 tests (projection inverse to 1e-9 for three poses including ±40/±40/±30, offsets ±60, FOV 25/75; flat mapping; 2D camera centres the focus at 2× and round-trips; 3D mapping differs from 2D by > 5 px and round-trips to 1e-6; active keyframe; keyframe editing and clamping; zoom area clamping). New camera test failed first (tilt 12° overridden to −8.64° by the cursor), then passed: `manualTilt` holds 12/−25/4° while `cameraAt` panning is identical to the following zoom. `npm test` 16 files, **115 passed**.
- `node tests/focus-dot.mjs` PASS: dot centre (613.89, 355.95) vs expected (613.89, 355.97) from `toPreview` on the saved project; drag +80/+40 px → aim view with the area rectangle and 1 ghost ring (`tests/aim-view.png` checked: flat frame, dimmed outside, dot, ghost) → Focus X/Y 44/51 (expected 43.99/51.18) → one Ctrl+Z → 30/40; three wheel notches over the dot 1.8 → 1.95× → one Ctrl+Z → 1.8; Alt+drag +40/−16 px on a 3D zoom → tilt 28°/−14° → one Ctrl+Z → 18°/−10°; Alt+wheel two notches → field of view 49° → one Ctrl+Z → 45°; Alt+drag on the 2D zoom → hint toast once, second Alt+drag no toast; 0 page errors.
- `node tests/alt-tilt.mjs` PASS (Electron, `sendInputEvent`): Alt press → menu hidden, content bounds identical; Alt+drag 80 px → tilt 38°, still no menu and identical bounds; Ctrl+A, Ctrl+V into the project name → "Pasted by test"; Ctrl+Shift+I → DevTools opened (then closed).
- `npm run build` OK; `browser-smoke`, `a1-playback`, `editor-interactions`, `scrub-frames`, `3d-fit`, `timeline-resize`, `cutting`, `v2-visual`, `export-location` PASS; `v2-proof` PASS (2.14 / 15.33).
- `node tests/a3-export.mjs`: correctness passed on both runs (3600 frames, difference 2.21, 480 frames, pitch 439/440.7, gap+ripple 270 frames, desktop 3600 frames, files 2 → 1); the speed budget failed at **32.4 s** and **30.27 s** (desktop 28.3 s / 43.6 s) with the machine busy again. See slice 9's A/B for why this is load, not code; re-run in slice 12.

**Deviations / judgment calls:**
- **Test adjusted, assertion unchanged:** slice 1's "clicking the preview deselects" check clicked the exact centre, which is now where the selected zoom's focus dot sits (pressing the dot rightly doesn't deselect). The click moved to 15%/20% of the preview.
- In aim view the dot follows pointer *movement* from where the focus sits in the flat frame (it jumps there when aim view opens), rather than snapping under the pointer.
- The dot is hidden during playback (its position isn't recomputed per frame).
- Ghost dots show every other zoom's focus keyframes (or its point if it has none); in the test only one other zoom remains because the new hand zoom absorbs the sample's click at 5 s.
- Wheel direction: wheel up zooms in (+0.05×) and widens the field of view (+2°). Alt-drag direction: dragging down raises tiltX, dragging right raises tiltY ("grab the card").
- Mid-drag Shift switches between tilt and rotation relative to where the drag started.

Commit: `d3e0844`.

## Slice 12: Release 0.4.0 and handoff

### Version sweep (commit `f8495d8`)

- `npm version 0.4.0 --no-git-tag-version` → `package.json` and `package-lock.json` at 0.4.0.
- Search for `0.3.0` / `0.2.1` outside `node_modules`, `release`, `dist`: only historical docs, plus two real hits.
  - **`src/App.tsx` footer hard-coded `v0.2.1`** (noted before slice 1). Now `v{__APP_VERSION__}`, injected by `vite.config.ts` from `package.json`. The built bundle contains `0.4.0`, and `packaged-smoke` asserts the footer reads `v${version}`.
  - `native/studio-capture/Cargo.lock` lists crate version `0.2.1`: the helper's own version, not read by the app, build or tests. Left alone (section 5: no native changes).
- **Safety (found while preparing the packaged test):** the Electron tests set a throwaway profile but not `STUDIO_PROJECTS_DIR`, so the app's launch-time recovery scanned `Videos\Studio Screen` and could have rewritten an unfinished take's `meta.json` to "recovered". Read-only check: Dan's two takes today are `done`, with `meta.json` last written 08:19 and 08:33, before this run started, so nothing was touched. `a3-export`, `export-location`, `alt-tilt`, `desktop-capture` and `packaged-smoke` now all point `STUDIO_PROJECTS_DIR` (and where relevant `STUDIO_EXPORT_DIR` / `STUDIO_USER_DATA`) at `tests/.*` folders. `packaged-smoke` previously launched with the **real profile** and added a 3D zoom to the most recent real project; it now uses `tests/.packaged/`.

### Full floor on the final code

- `npm test` **16 files, 115 passed**; `npm run build` OK.
- With the dev server: `browser-smoke`, `a1-playback`, `editor-interactions`, `scrub-frames`, `3d-fit`, `timeline-resize`, `cutting`, `focus-dot`, `v2-visual` PASS; `v2-proof` PASS (2.14 / 15.33); `export-location`, `alt-tilt` PASS (Electron).
- `node tests/a3-export.mjs` on the final code: correctness passed (3600 frames, difference 2.21, 480 frames, pitch 439/440.7, gap + ripple 270 frames, cancel, desktop files 2 → 1); speed **35.55 s** and **39.78 s** (desktop 33.7 s / 33.0 s) while Codex was running Python and Node jobs (~3.5 cores). Same load story as slices 5, 7, 9 and 11; the slice 9 A/B is the evidence it isn't the code. The last in-budget runs were slice 10 (25.1 s, 20.52 s).
- `npm run native:check`: all five ✔ (Windows screen capture, no yellow border, screen-change tracking, NVIDIA RTX 4080 hardware H.264, system audio).
- **Idle-gated native tests** (each started only after `tests/idle.ps1` ≥ 120 s; A4's injected input resets that clock, so I waited it out between runs):
  - `a2-recording-ui` **PASS**: protected take 0 magenta pixels / 0 black share (11 frames); control 1,069 (15 frames); countdown seen, editor hidden, bar visible, editor visible and focused after, no leftover windows.
  - `a5-open-speed` **PASS**: 5-minute take, auto-edit 386 ms, first frame 845 ms, saved 1,135 ms; toast "Auto-edit: 36 zooms · 10 typing speed-ups" (now counting typing zooms).
  - `a4-native-capture` **FAILED its A/V check only**, twice: 66 ms then 58 ms (limit 20 ms). Everything else passed both times: click error 0.5 px, stray cursor 0 px (control 231/232), 6 left clicks with 47–62 ms burst gaps, right-click, wheel, Ctrl+K, 4 typing events, text/pointer shapes, helper-kill file 3.93 s, app-kill recovery ("Recovered · …", helper gone in 802/619 ms).
  - `a4-av-sync` (to separate app from helper; it uses its own fixture window and spawns the helper directly, so no app code runs): **FAIL, sound 57 ms late** (75, 51, 53, 58, 47 ms). On 9/14 the same test measured −5 ms. The helper binary is unchanged: built 08:16 today before this run, SHA-256 `4D429A7794CAF3C863AAA20A0EC6BE9842079D8A6791D9C1E5A4CFE39BFF8828`, and `git diff babac5f HEAD -- native/` is empty. Running at the time: Premiere Pro, Discord (6 processes), Chrome, Spotify, plus Codex workloads. **Not a stop trigger in my reading:** the failure isn't caused by and can't be fixed within this run (a fix would mean helper or offset changes, which section 5 forbids and section 6.1 reserves for Dan), and no assertion was changed. Flagged as heads-up 1 in STATUS.md, added to the hand test (step 13), and queued as a follow-up task.
  - `desktop-capture` **not passing, pre-existing:** it first timed out on "Recording ready. Make it your own." (since `cf594b2` a take ≥ 1 s shows the auto-edit toast). With that expectation temporarily relaxed, it then hung at export because it had no `STUDIO_EXPORT_DIR` and slice 7's Save As opened (closed with the test; no dialog left open). It also expects a browser download and fallback click/shortcut capture, both obsolete since A3/A4. Its last results file dates from 9/14 10:19. I reverted the toast tweak, kept only the folder isolation (including `STUDIO_EXPORT_DIR` so a real dialog can't appear), and queued a repair task instead of rewriting its assertions.

### Package

- `$env:ELECTRON_BUILDER_COMPRESSION_LEVEL='3'; npm run desktop:pack -- --config.electronDist=node_modules/electron/dist` → exit 0. Cargo: `Finished release … in 0.55s` (no helper rebuild). **`release/Studio Screen 0.4.0.exe`: 129,972,345 bytes, SHA-256 `37CD371FA2A829A669DDDD3E0D256984347591F846BCD03215E99664E8731212`.**
- Bundled `release/win-unpacked/resources/studio-capture.exe` SHA-256 **equals** `native/studio-capture/target/release/studio-capture.exe` (`4D429A77…F8828`).
- `node tests/packaged-smoke.mjs --portable` **PASS**: loaded from its extracted temp folder, footer `v0.4.0`, 3D controls, source picker, cursor tracker, system audio on, microphone controls absent, 0 page errors, no leftover processes. Verified isolation: the throwaway profile was written at 11:30; Dan's real `%APPDATA%\studio-screen` was last written at 10:07 by his own 0.3.0 session. Also PASS without `--portable` on `win-unpacked`.
- **Plan claim that didn't match:** `packaged-smoke.mjs --portable` could not launch the portable EXE (Playwright's Electron launcher timed out after 60 s: the portable wrapper unpacks itself and starts the real app as a child it can't follow). `--portable` now starts the EXE with a free `--remote-debugging-port` and attaches with `chromium.connectOverCDP`, like the older `tests/portable-launch.mjs`, then runs the same checks; the cursor-tracker check tries each screen until the one under the pointer reports. `tests/portable-launch.mjs` was **not** run: it records the screen with the real profile and still expects the pre-auto-edit toast.

### Docs

- STATUS.md rewritten: where things stand (report → fix table), verified vs unverified table, three heads-ups (A/V measurement, A3 speed under load, stale desktop-capture), the **0.4.0 hand test** (13 numbered steps covering scrub, fast clicks, typing zoom, zoom lead, deselect/undo, focus dot, 3D fit and Alt tilt, timeline size, every cutting action, Save As/Ctrl+E, export playback, sound sync), next steps, parking lot.
- VALIDATION.md: new "0.4.0 — hand-test fixes — 2026-09-15" section with the numbers above.
- README: workflow (new keys and gestures), structure (new modules), Tests (all new scripts, packaged smoke).
- docs/MACHINE-HANDOFF.md: version 0.4.0, artifact hash, 115 tests, open items.
- The plan is marked "Executed" at the top with a link here.
- Two follow-up tasks were offered to Dan in the app: investigate the ~57 ms A/V measurement (no offsets), and repair `tests/desktop-capture.mjs`.

## Summary for Dan

- **Shipped:** all 12 slices, 0.4.0 portable built and smoke-tested. The bug reports (R2, R4, R7, R8, R10) each have a test that failed before the fix and passes now; the feature requests (R1, R3, R5, R6, R9, R11, R12) each have new tests of their own.
- **Needs your eyes:** the hand test in STATUS.md, especially zoom lead, typing zoom, the fast-click camera, and cutting feel.
- **Open, not caused by this run:** the helper's sync test measured sound ~57 ms late today (was −5 ms yesterday; nothing native changed; audio apps were open). Please do hand-test step 13. `desktop-capture` is stale. A3 speed misses its budget when the PC is busy.
- **No stop triggers fired.** No native changes, no audio offset, no real recordings, exports or profile touched (checked), no git conflicts (every pull was already up to date).
