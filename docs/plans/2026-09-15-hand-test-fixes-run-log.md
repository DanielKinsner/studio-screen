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

