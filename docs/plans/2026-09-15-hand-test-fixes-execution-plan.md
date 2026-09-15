# Hand-test fixes: execution plan (one long run)

> **Executed 2026-09-15.** All 12 slices shipped as Studio Screen 0.4.0. What was built, measured and decided differently: [run log](2026-09-15-hand-test-fixes-run-log.md). Hand test: [STATUS.md](../../STATUS.md).

**What this is:** a decision-complete plan for one long-running agent to fix everything Dan found in his first hand test of Studio Screen 0.3.0 on 2026-09-15, plus build auto-zoom while typing. Decisions were made with Dan in the planning session that day. Background: [STATUS.md](../../STATUS.md), [docs/SPEC.md](../SPEC.md), [VALIDATION.md](../../VALIDATION.md).

**Dan wants this run to go start to finish without stopping.** Only stop for the triggers in section 6. Every other question already has an answer below. If none fits, use the stated *intent* of the slice, log what you chose (section 6b), and keep going.

**Drift rule:** this plan was written against commit `a50b350` plus the 0.3.0 version bump. If it contradicts the code or docs you find, check reality, follow reality, and log the discrepancy. Do not invent a new product decision; only technical calls are yours.

---

## 1. What Dan reported (plain English)

| # | Report | Diagnosis (verified in code at planning time) |
|---|---|---|
| R1 | "Is there supposed to be a zoom when typing?" | Not built. Auto-edit only speeds typing up 2× (`typingSections`, [src/timeline.ts](../../src/timeline.ts)). |
| R2 | Padding at 0 + 3D zoom crops a lot of the picture | The 3D renderer tilts the whole frame with no fit-to-frame correction ([src/perspective.ts](../../src/perspective.ts)). |
| R3 | Wants to grab the screen to tilt 3D, not just sliders | Only sliders exist ([src/MotionPanel.tsx](../../src/MotionPanel.tsx) "Tilt up / down" etc.). |
| R4 | Scrubbing turns the preview plain white until you stop | The compositor paints an off-white card and only draws video when `readyState >= 2` ([src/compositor.ts:330-343](../../src/compositor.ts)). Every pointer move restarts the seek before it lands ([src/App.tsx:491-497](../../src/App.tsx)). |
| R5 | Zooms should start ~0.5 s earlier | Lead is `clamp(0.9 × response, 0.3, 1.2)`: Snappy 0.34 s, Smooth 0.54 s, Floaty 0.86 s ([src/timeline.ts:105](../../src/timeline.ts)). |
| R6 | Wants a draggable focus dot instead of Focus X/Y sliders, to see if zooms aim at similar spots | Only sliders exist ("Focus X", "Focus Y" in MotionPanel). |
| R7 | Ctrl+Z on the magnification slider undoes only 0.05 at a time | `edit()` pushes one history entry per slider `onChange` event, and history is capped at 40 ([src/App.tsx:305-312](../../src/App.tsx)). One drag can push real edits out of undo entirely. |
| R8 | Can't deselect a clip by clicking elsewhere on the timeline | The timeline's pointer-down only scrubs; nothing clears `selected` ([src/App.tsx:1058](../../src/App.tsx)). |
| R9 | Cutting should work like Premiere | Today **Cut** removes a fixed 1 s at the playhead ([src/App.tsx:979-991](../../src/App.tsx)). |
| R10 | Fast clicks top-left then bottom-right: zooms slow to react even on Snappy; should be predictive | The camera aims at the next click `lead` seconds early, but the follow-cursor clamp pins the view centre within `0.3/scale` of the **current** smoothed pointer ([src/camera.ts:104-110](../../src/camera.ts)). The pointer hasn't travelled yet, so the head start is cancelled. |
| R11 | Wants a bigger timeline, even at the expense of the preview | Timeline height is fixed CSS (250 px, overridden again at [src/styles.css:2638](../../src/styles.css) and 2689). |
| R12 | Wants to choose where each export is saved | Always `Videos\Studio Screen\Exports` ([electron/main.cjs:64-68](../../electron/main.cjs), `studio:export-open`). |
| ✔ | Two videos exported at 4K60, clean, audio good | Record in STATUS/VALIDATION as Dan's hand-test evidence (4K60 export works; speed not timed). |

---

## 2. Decisions locked (D-table)

| ID | Decision | Consequence for the build |
|---|---|---|
| D1 | **Zoom lead slider**, default +0.5 s on top of today's lead | New setting `zoomLead` (seconds added), default `0.5`, range 0–1.5, step 0.05. Snappy ≈ 0.84 s, Smooth ≈ 1.04 s, Floaty ≈ 1.36 s before the click. |
| D2 | **Premiere keys** for cutting | Ctrl+K splits at the playhead. C = razor tool (click the clip to split there). V = back to select. The timeline toolbar gets matching buttons. |
| D3 | **Delete leaves a dimmed gap** | Deleting a piece keeps it on the timeline as a dark hatched block. Playback and export skip it. Zooms, speeds and captions over it stay put, so restoring brings everything back. |
| D4 | **Ripple delete exists too** | Right-click a piece → **Ripple delete** (also **Shift+Delete**). The footage is removed, the gap closes and everything after slides left. **All zooms, speed sections, captions, annotations and hidden-cursor ranges ripple with it.** Select a gap and press Delete (or right-click → **Close gap**) to ripple-close it, the same as Premiere. Right-click a gap or a rippled marker → **Restore footage**. |
| D5 | **Snapping** | Every horizontal drag on the timeline snaps to nearby edit points. Magnet toggle in the toolbar plus the **S** key; on by default, remembered. This is how Dan lines things up after gaps. |
| D6 | Ripple uses a **collapsed timeline view**, not a re-timed project | Everything stays stored in source (recording) time. The timeline draws rippled ranges at zero width, so items after them slide left, and items attached to footage move with it automatically. Speeds, zooms and cursor data never need re-timing math, which avoids the high-risk full rebuild. See slice 9. |
| D7 | **Export: Save As every time** | Export opens the Windows Save As window in the last folder used (remembered across launches; default `Videos\Studio Screen\Exports`). **Ctrl+E skips the window** and saves next to the last export with an auto-numbered name. |
| D8 | **Focus dot + Alt-drag tilt** | A selected zoom shows a draggable dot on the preview. Pressing it switches to a flat "aim view" with ghost dots for every other zoom. Alt+drag on the preview tilts a 3D zoom, Alt+Shift+drag rotates it, Alt+scroll changes field of view. **Sliders stay.** |
| D9 | **Build auto-zoom while typing** this run | Dashed automatic zooms on typing bursts, removable with × like click zooms. Toggle "Zoom while typing" under Automatic zoom, default on. See slice 10. |
| D10 | **No stop checkpoints** | Dan asked for one uninterrupted run. Commit and push per slice; stop only on section 6 triggers. |
| D11 | The finished run produces **Studio Screen 0.4.0** portable | Final slice bumps the version and packs `release/Studio Screen 0.4.0.exe` for Dan's next hand test. |

---

## 3. Lanes

**Owner lane (Dan only, after the run):** hand-test 0.4.0 with the checklist the executor writes into STATUS.md; judge camera feel, zoom lead, and typing-zoom taste.

**Executor lane:** everything in section 4. Nothing in it waits on Dan.

---

## 4. Ordered slices

### Rules for every slice

- **Pull before committing** (`git pull --ff-only origin main`); Dan sometimes runs Codex on the same repo. One small commit per slice (sub-slices may commit separately), then push. End every commit message with the attribution line the harness gives you.
- **Bug-fix slices (1–4, 6) follow pin-it:** write the failing test first, see it fail, fix, see it pass. Note the root cause in one plain sentence in the commit description.
- **Verify floor, not ceiling.** Each slice lists minimum checks. If your actual diff touches more (for example `electron/`, `compositor.ts`, `exporter.ts`, `camera.ts`), add the matching lanes:
  - Always: `npm test` and `npm run build`.
  - UI or editor behaviour (`App.tsx`, `TimelineClip.tsx`, `MotionPanel.tsx`, `styles.css`): with `npm run dev` running, `node tests/browser-smoke.mjs` and `node tests/a1-playback.mjs`.
  - Rendering or export (`compositor.ts`, `perspective.ts`, `camera.ts`, `exporter.ts`, `timeline.ts`): `node tests/a3-export.mjs` (exact frames must still pass).
  - Electron main or preload: an Electron Playwright check (pattern in `tests/a3-export.mjs` / `tests/packaged-smoke.mjs`).
  - **Input-injecting or screen-recording tests** (`a2-recording-ui`, `a4-*`, `desktop-capture`, anything that moves the real pointer) run **only** when `powershell -File tests/idle.ps1` reports ≥ 120 s idle. Dan works on this PC. Otherwise log "not run: PC in use". Headless Edge and Electron Playwright tests use synthetic input and are fine anytime.
- **Look at it.** For visible changes, use the Browser pane on `npm run dev` (http://127.0.0.1:5173) and take a screenshot as proof. The browser editor loads the demo project; use it or import a fixture.
- Keep the existing visual language (`.impeccable.md`, current dark UI). New controls should look like the existing ones.
- Keep old projects loading: every new project or settings field is optional with a default. Add a unit test that an old project object without the field still loads and plays.

---

### Slice 1: Deselect (R8)

**Spec:**
- Pressing on empty timeline space (anywhere not on a clip, gap, grip or button) clears `selected`, then scrubs as today.
- Pressing on the preview background outside any overlay control also clears it.
- **Esc** clears the selection when no modal is open.

**Accept:** browser test: select a zoom clip, click empty track area → the inspector no longer shows the zoom, and Delete does nothing. Add it to `tests/browser-smoke.mjs` or a new `tests/editor-interactions.mjs` (your call). Update README → Tests if you add a script.

### Slice 2: One undo step per gesture (R7)

**Intent:** Ctrl+Z undoes what a person thinks of as one action. Undo should never lose real edits to slider noise.

**Spec:**
- Extract history into a pure module (e.g. `src/history.ts`) with unit tests.
- `edit(fn, { gesture })`: consecutive edits with the same gesture key merge into the entry created by the first one. A gesture ends on `pointerup`, `change`, blur, or 500 ms without another edit (covers keyboard arrows on sliders).
- Apply it to `Slider` ([src/Controls.tsx](../../src/Controls.tsx)) and every continuous control (number drags, colour pickers, region picker). TimelineClip already commits on pointer-up; keep that.
- Raise the history cap from 40 to 200.

**Accept:** unit tests cover merge, gesture end, cap, and redo cleared after a new edit. Browser test: drag Magnification from 1.65 to 2.5 in many small steps → one Ctrl+Z returns it to 1.65, and an edit made before the drag is still undoable.

### Slice 3: No white frames while scrubbing (R4)

**Intent:** the preview behaves like an NLE (non-linear editor such as Premiere): it holds the last good frame while the next one decodes, and never flashes an empty card.

**Spec:**
- Keep a "last good frame" copy of the video image in the preview path (for example, an offscreen canvas updated whenever a frame is drawn with `readyState >= 2`). Draw it whenever the video is seeking or not ready. Only draw the placeholder card before any frame has ever loaded.
- Seek coalescing: while a seek is in flight, don't start another. Remember the newest requested time and seek to it on `seeked`. Consider `requestVideoFrameCallback` to know when the frame is actually presented.
- Export uses its own frame path (`media.frame`, exporter). Don't change what export renders. A3 must still pass unchanged.

**Accept:**
- New headless browser test: load a 60 fps H.264 fixture (generate one with FFmpeg like the existing fixtures; don't commit video), then scrub with ~40 pointer moves across the timeline.
- After the first frame appears, sample the preview canvas centre every animation frame. It must **never** equal the placeholder colour `#eff0ea` (±3 per channel).
- The paused frame after release must match the frame at that time.

### Slice 4: Predictive camera on fast clicks (R10)

**Intent:** when the camera knows where the next click is, it heads there early. Cursor-follow must not cancel the head start.

**Spec:**
- In `buildPath` ([src/camera.ts](../../src/camera.ts)): the follow-cursor clamp must not pull the centre back toward the current pointer during a focus keyframe's lead window (from keyframe `t` until its click time). Aim straight at the keyframe target there; normal follow resumes after the click.
- Hand-placed focus keyframes have no click time. Treat their lead window as `zoomLead(response)` after keyframe `t`.
- Store the click time on generated focus keyframes if needed (optional field).

**Accept:**
- Failing-first unit test in `src/camera.test.ts`: Snappy feel; pointer moves from (0.1, 0.1) with a click at t = 2.0 to (0.9, 0.9) with a click at t = 2.6, travelling only in the last 0.2 s. Camera centre x must start increasing within 1/30 s of the second keyframe's time, and be ≥ 70% of the way to its clamped target by t = 2.6.
- Existing camera, cursor and A1 playback tests still pass.

### Slice 5: Zoom lead slider (R5, D1)

**Spec:**
- Add `zoomLead: number` to `Settings` (default 0.5), `limits` in [src/settings.ts](../../src/settings.ts) (0–1.5), and `styleKeys` (it's part of a camera look).
- `zoomLead(response, extra)` returns `clamp(0.9 × response, 0.3, 1.2) + extra`. Pass it through `autoZooms` (memo args), grouping, focus keyframes and slice 4's lead window.
- UI: slider **"Zoom lead"** in the Camera feel section of MotionPanel, under Move time/Bounce, shown in seconds. Picking a Snappy/Smooth/Floaty preset does **not** reset it.
- **Opening frame:** camera springs start from the neutral (unzoomed, untilted) pose, not the first target ([src/camera.ts:149-153](../../src/camera.ts)). With a longer lead, a zoom may start at the trim start, and the video must never open already mid-zoom.

**Accept:** unit tests: default lead values per feel; old settings without `zoomLead` load as 0.5; first camera sample is neutral even when a zoom starts at `trimStart`. A3 passes.

### Slice 6: 3D never crops the recording (R2)

**Intent:** at any padding (including 0) and any tilt, rotation, offset or field of view, no part of the recorded screen is cut off by the frame edge. 2D zoom cropping (magnification) is intended and not affected.

**Spec:**
- Add a pure function (e.g. `fitScale(pose, aspect, margin)` in `perspective.ts`). It projects the card's four corners with the same math as the vertex shader and returns the largest scale ≤ 1 that keeps them inside the canvas with a 2% margin.
- Apply it in the 3D render for preview and export alike. It follows the sprung pose, so it animates smoothly. Check what the 3D texture contains (card only or background too) and fit the recorded card.

**Accept:** unit tests: flat pose → 1; extreme tilt at padding 0 → < 1, and projected corners inside. Visual check: padding 0, 3D zoom at max tilt → screenshot shows all four card corners inside the frame. A3 3D export check still passes; update its expected image only if the only difference is the fit, and log it.

### Slice 7: Choose where exports go (R12, D7)

**Spec (electron/main.cjs, preload, App.tsx):**
- `studio:export-open(name, extension, { quick })`.
  - Normal: `dialog.showSaveDialog(mainWindow, { defaultPath: <lastDir>/<name>.<ext>, filters: [the format] })`.
  - Cancel → return `null`. The renderer ends the export quietly: no error toast, export panel stays open and ready.
  - `quick: true` (Ctrl+E) → no dialog; `uniquePath(lastDir, name, ext)`.
- Remember `lastDir` in a small JSON file in `userData`, validated on read. If missing or unreadable, fall back to `Videos\Studio Screen\Exports`.
- `STUDIO_EXPORT_DIR` set → never show the dialog; always save there (tests and power users).
- **Never destroy an existing file.** Write to `<chosen>.partial` in the same folder, rename over the target only on success, and delete only the `.partial` on cancel or failure. (Today's `rm` on failure would delete a file Dan chose to overwrite.)
- `studio:reveal`: allow any path exported this session (a Set in main), not just `exportsDir()`.
- Toasts at App.tsx:1036 and 2509: "Export complete. Saved to <folder name>."
- Browser (non-desktop) behaviour is unchanged.

**Accept:**
- Electron Playwright test: stub `dialog.showSaveDialog` via `app.evaluate` to return a temp path → the file lands there, **Show in folder** allowed, `lastDir` persisted. Stub cancel → no file, no error toast. Ctrl+E → saved in `lastDir` with no dialog call.
- Failure → the pre-existing target file is unchanged.
- A3 passes (uses `STUDIO_EXPORT_DIR`).

### Slice 8: Resizable timeline (R11)

**Spec:**
- A horizontal drag handle on the border between the preview area and `.timeline-section`.
  - Range: the current default height (per breakpoint) up to 70% of the editor's height.
  - Double-click resets. Remembered in localStorage (`studio-timeline-height`, try/catch).
- Track rows and labels grow with the extra height (track height = available height ÷ track count; no fixed 29 px rows). The preview shrinks; it keeps its aspect ratio via `usePreviewSize`.
- Consolidate the duplicated timeline height rules (styles.css ~532/580, 1802, 2028, 2638, 2689) into one CSS variable driven by the handle. Don't change other breakpoints' look.

**Accept:** browser test: drag the handle up 200 px → timeline taller, rows taller, preview smaller and not overflowing; reload → height kept; double-click → default. Screenshot at 1920×1080 and 1366×768.

### Slice 9: Premiere-style cutting (R9, D2–D6)

#### 9a: Model and pure functions

- `Cut` gains optional `ripple?: boolean`. `Project` gains optional `splits?: number[]` (source seconds, sorted, unique, strictly inside the trim range).
  - Existing cuts load as non-ripple gaps.
  - Import/export (`.studio`) round-trips both.
- Pure functions (new `src/edits.ts` or in `timeline.ts`), unit-tested:
  - `pieces(p)`: kept ranges between trim ends, splits and cuts.
  - `splitAt(p, t)`: no-op within 1 frame of an existing boundary.
  - `deletePiece(p, piece, { ripple })`, `closeGap(p, cutId)`, `restore(p, cutId)`.
  - `timelineTime(p, t)` and `sourceFromTimeline(p, x)`: collapse ripple cuts to zero width; gaps keep their width.
  - `timelineDuration(p)`.
- **Ripple side effects, in the same undo step:**
  - Items fully inside the removed range are deleted: hand zooms, speed sections, captions, annotations, hidden-cursor ranges, and focus keyframes.
  - Partially overlapping items are clipped to the kept footage.
  - A gap (non-ripple) changes nothing else.
  - Restore brings the footage back; items deleted by a ripple come back only through undo.
- `generateZooms` and slice 10's typing zooms ignore clicks and typing inside **any** cut (gap or ripple), so no invisible zooms bridge across removed footage. Restoring a gap brings them back automatically, since they're derived.
- Playback (`playbackSegments`, export) already skips all cuts. Confirm `ripple` changes nothing about output.

#### 9b: Timeline drawing on the collapsed axis

- One mapping function positions **everything** on the timeline: ruler, playhead, scrub, screen pieces, gaps, zoom/speed/caption/annotation/hidden-cursor clips, and filmstrip thumbnails. No direct `t / project.duration` math left in timeline JSX; grep for it.
- Screen track: each piece is its own block with a thin divider at splits; gaps are dark hatched blocks; rippled ranges get a small marker at their collapse point (tooltip "Removed 2.4 s: right-click to restore").
- An item spanning a rippled range draws as one continuous clip with the removed part collapsed.

#### 9c: Tools, keys and context menus

- Toolbar: replace the **Cut** button with **Split** (Ctrl+K) and a **Razor** toggle (C); **Select** (V) is the default tool. The razor shows a scissors cursor and a hover line over the screen track; click splits there (snapped per 9d). Esc or V returns to select.
- Keys (ignored in inputs and modals, as the existing handler does):
  - **Ctrl+K:** split at the playhead.
  - **Delete/Backspace:** selected piece → leave gap; selected gap → close gap (ripple); zoom/speed/caption → remove (as today).
  - **Shift+Delete:** ripple delete the selected piece.
- Right-click menus (custom, styled like existing menus, keyboard-dismissable):
  - Piece: Split at playhead · Delete (leave gap) · Ripple delete
  - Gap: Close gap · Restore footage
  - Rippled marker: Restore footage
- Edge drags:
  - A piece's inner edge dragged inward creates or grows a gap; dragged outward it reclaims footage from the adjacent gap only.
  - **Shift+drag** an inner edge = ripple trim (the removed range is ripple).
  - Outer edges of the first and last piece stay the trim grips.
  - The existing cut inspector (start/end) keeps working for gaps.
- "Keep at least a little footage" guard stays: no edit may leave < 0.25 s of output.

#### 9d: Snapping

- While dragging any timeline item (piece edges, gap edges, trim grips, zoom/speed/caption/annotation clips moving or resizing) and for the razor position and the playhead scrub, snap within **8 CSS px** to:
  - the playhead
  - piece, split and gap boundaries
  - trim ends
  - other clips' starts and ends
- Show a thin vertical accent line while snapped.
- Magnet toggle button in the timeline toolbar plus the **S** key. Default on; localStorage `studio-snap`.

**Accept (9a–d):**
- Unit tests for every pure function, including the ripple side effects (a zoom straddling a rippled range is clipped; one fully inside is removed; a speed section after it keeps its source times and draws shifted left).
- Browser test covers:
  - Ctrl+K at two points → three pieces.
  - Delete the middle piece → hatched gap; playback skips it (output duration drops); zoom clips over it unchanged.
  - Select the gap + Delete → it collapses and later clips shift left on screen.
  - Right-click the marker → Restore; the footage is back.
  - Shift+Delete on a piece works.
  - Razor click splits.
  - A zoom-clip drag snaps to a split boundary (within 8 px lands exactly).
  - Undo reverts each step as one action.
- A3 passes; add an A3 case that exports a project with a ripple cut and a gap and checks the frame count equals the output duration.

### Slice 10: Auto-zoom while typing (R1, D9)

**Spec (in `generateZooms`, [src/timeline.ts](../../src/timeline.ts)):**
- **Typing bursts:** same grouping as `typingSections` (gaps < 1.4 s, ≥ 3 keys, span ≥ 0.5 s), excluding typing inside cuts and after `trimEnd`.
- **Focus target:** the last click inside the recorded area within 10 s before the burst starts (you usually click into the field first); if none, the pointer position at burst start. The helper does not record the text caret, and **no native changes** are allowed.
- **Timing:** each burst acts like a click at its start whose hold lasts until burst end + `AUTO_HOLD`. It goes through the same grouping, `MERGE_GAP`, dead-zone and lead logic as clicks. A click followed by typing stays zoomed in, with no zoom out and back.
- Magnification = `zoomStrength`. Dashed automatic clip with ×; `dismissedZooms` works; **Back to raw** removes them; auto-edit summary counts them in "zooms".
- Setting `zoomWhileTyping: boolean` (default true), Toggle **"Zoom while typing"** under **Automatic zoom** in MotionPanel. Not a style key.

**Accept:** unit tests: click then typing burst → one merged zoom lasting through the burst; typing with no prior click → zoom at pointer; burst inside a gap → none; toggle off → none; dismiss works. A5 (`tests/a5-open-speed.mjs`) must still pass. Check whether it injects input before running and follow the idle rule.

### Slice 11: Focus dot, aim view and Alt-drag tilt (R3, R6, D8)

#### 11a: Dot and aim view

- When a zoom is selected (hand or auto), draw a dot on the preview at its focus point: the focus keyframe active at the playhead, else the zoom's `x,y`. It's mapped through the current camera: 2D transform, and for 3D the same projection as slice 6.
- Pressing the dot enters **aim view** until release:
  - The preview renders the flat, unzoomed full frame at the playhead.
  - A rectangle shows the area the zoom will show at its magnification (clamped like `clampCenter`).
  - Faint **ghost dots** mark every other zoom's focus points, including auto zooms.
  - Dragging moves the dot and rectangle; release commits **one** undo step and returns to the normal view.
- Mouse wheel over the dot or in aim view changes magnification by ±0.05 per notch, within the slider range; one undo step per burst (slice 2 gesture).
- Editing an **auto** zoom here takes ownership: copy it into `p.zooms` with the same id (existing pattern at [src/App.tsx:1464](../../src/App.tsx)). It then shows solid, not dashed, and survives Back to raw. Moving the dot edits the active focus keyframe.

#### 11b: Alt-drag tilt

- With a **3D** zoom selected, pointer over the preview:
  - **Alt+drag:** horizontal → `tiltY`, vertical → `tiltX`, 0.25°/px.
  - **Alt+Shift+drag:** `tiltZ`.
  - **Alt+wheel:** `perspective` ±2 per notch.
  - All clamped to the existing slider ranges; one undo step per gesture; live preview while dragging.
- Add optional `manualTilt?: boolean` to `Zoom`, set by any tilt edit (slider or drag). In `buildPath`, a zoom with `manualTilt` uses its own tilt even when cursor-follow tilt would apply ([src/camera.ts:116-122](../../src/camera.ts)); cursor-follow **panning** keeps working. This fixes a hidden problem: today, tilt sliders on auto zooms (`follow: true`) are silently overridden by the cursor.
- 2D zoom selected + Alt+drag → one toast per session: "Switch this zoom to 3D to tilt it."
- **Electron gotcha:** the window uses `autoHideMenuBar: true` with the default menu ([electron/main.cjs:342](../../electron/main.cjs)), so pressing Alt shows the menu bar. **Intent:** Alt must never reveal the menu bar in the editor, while copy/paste in text fields and dev-mode reload/devtools keep working. Pick the mechanism (e.g. `before-input-event` handling or removing the menu with explicit accelerators) and verify in Electron.

**Accept:** unit tests for the aim mapping (screen point ↔ preview point, 2D and 3D) and `manualTilt` in `buildPath`. Browser test: select zoom → dot visible at the expected pixel; drag the dot → Focus X/Y sliders update; one undo restores. Electron check: Alt+drag changes `tiltY`, and no menu bar appears (window content bounds unchanged). Screenshot of aim view with ghost dots.

### Slice 12: Release 0.4.0 and handoff

1. **Version sweep.** Invariant: "the version the build, the package and the tests read is 0.4.0 everywhere." Run `npm version 0.4.0 --no-git-tag-version`, then search the repo (excluding `node_modules`, `release`, `dist`) for `0.3.0` and fix any other place the build or tests read it. Log what you found.
2. Full floor:
   - `npm test` and `npm run build`
   - With the dev server: `browser-smoke`, `a1-playback`, `a3-export`, and every new test script
   - `npm run native:check`
   - Idle-gated native tests if the PC is idle, else log "not run"
3. `$env:ELECTRON_BUILDER_COMPRESSION_LEVEL='3'; npm run desktop:pack -- --config.electronDist=node_modules/electron/dist`, then `node tests/packaged-smoke.mjs --portable`. Confirm the bundled `resources/studio-capture.exe` hash matches `native/studio-capture/target/release/studio-capture.exe`.
4. **Docs:**
   - STATUS.md: new "Where things stand", with a verified vs unverified table.
   - A new **hand test for 0.4.0**: numbered clicks and what Dan should see for every slice. At minimum: scrub, one undo per slider drag, deselect, fast clicks, zoom lead slider, 3D at padding 0, Save As plus Ctrl+E, timeline resize, split/gap/ripple/restore/snap, typing zoom, dot/aim view, Alt-tilt.
   - VALIDATION.md: new dated section with measured results.
   - README Tests: new scripts.
   - `docs/MACHINE-HANDOFF.md`: version and test counts.
   - Mark this plan "Executed" at the top with a link to the run log.
5. Commit and push. Leave `release/` untracked as today.

---

## 5. Do not touch

- `native/studio-capture/` (Rust helper): no changes. Audio/video sync is verified at zero offset; **do not add any audio offset or the old −49 ms calibration.**
- Recording flow: countdown, recording bar, hidden editor, crash recovery (A2/A4 behaviour).
- Auto-edit thresholds: trim start/end rules, idle 3 s/4×, typing 2× speed-up rules. Slice 10 adds zooms only; it does not change speed-ups.
- Camera feel preset numbers (`cameraFeel` in [src/types.ts](../../src/types.ts): 0.38/0.08, 0.6/0, 0.95/0) and `AUTO_HOLD`, `MERGE_GAP`, `COALESCE`, `DEADZONE`.
- Export encoding and frame timing (A3 exact frames): only the file destination changes (slice 7) and the 3D fit (slice 6).
- Existing sliders stay; new direct-manipulation controls are additions.
- Don't commit generated videos, fixtures, `tests/*-results.json`, `release/` or `dist/` (already gitignored; keep it that way).

## 6. Stop-and-ask triggers (the only reasons to stop)

1. A fix would require changing the Rust helper, the audio offset, or recorded data formats on disk in a non-backward-compatible way.
2. Ripple (slice 9) cannot be done with the collapsed-view model (D6) and would need re-timing stored items into output time.
3. A previously passing verified test (A3 exact frames, A1 playback, browser smoke, packaged smoke) fails and can only be "fixed" by changing what it asserts about existing behaviour (other than the logged slice 6 expected-image update).
4. Anything would delete or overwrite Dan's recordings, exports or `%APPDATA%\studio-screen` profile.
5. Git conflicts with someone else's pushed work that you can't merge with certainty.

Everything else (library choices, file structure, test layout, CSS details, exact menu styling): decide and log.

### 6b. Run log (required)

Keep `docs/plans/2026-09-15-hand-test-fixes-run-log.md`, committed with each slice. For each slice record:
- what shipped, with commit hashes
- verification commands run and results (numbers, not "passed" alone)
- tests skipped and why
- **deviations:** every place this plan was unclear or wrong, every judgment call, every ripple beyond the spec, and every plan claim that didn't match the code

Dan reads this instead of stopping you.

## 7. Parking lot (not this run)

- Device frames, captions from system audio, mark-a-mistake hotkey, deleting recording folders from the library.
- Recording the text caret position in the native helper (would improve typing-zoom aim; needs Rust work).
- A full output-time (true Premiere) timeline model.
- Right-click menus on zoom/speed/caption clips beyond what exists.
- Shorter keyframe intervals in native recordings for faster seeking (Rust/encoder change).
- The separate 30-minute/4K soak and timed 4K60 export speed.
