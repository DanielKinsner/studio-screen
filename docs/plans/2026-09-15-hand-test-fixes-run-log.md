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

