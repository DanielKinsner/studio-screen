# Status — Studio Screen

**Last updated:** 2026-09-15 (0.4.0 built with every hand-test fix; ready for Dan's hand test; `desktop-capture` repaired)

## Where things stand

All 12 slices of [the hand-test fix plan](docs/plans/2026-09-15-hand-test-fixes-execution-plan.md) are built, tested and pushed, and **`release/Studio Screen 0.4.0.exe`** is packed on the office PC. Every judgment call, deviation and measurement is in [the run log](docs/plans/2026-09-15-hand-test-fixes-run-log.md). Background: [docs/SPEC.md](docs/SPEC.md), [VALIDATION.md](VALIDATION.md).

What changed since 0.3.0, in Dan's words from the first hand test:

| # | Dan's report | Now |
|---|---|---|
| R8 | Can't deselect a clip | Click empty timeline, the preview, or press Esc |
| R7 | Undo on a slider goes 0.05 at a time | One Ctrl+Z undoes a whole drag (200 steps kept) |
| R4 | Scrubbing turns the preview white | Holds the last frame while the next one loads |
| R10 | Fast clicks: camera slow to react | Heads for the next click early instead of waiting for the pointer |
| R5 | Zooms should start earlier | **Zoom lead** slider, default +0.5 s (Smooth now starts 1.04 s before a click) |
| R2 | 3D at padding 0 crops the picture | 3D zooms shrink just enough to keep all four corners in frame |
| R12 | Choose where exports go | Save As every time (remembers the folder); **Ctrl+E** skips it |
| R11 | Bigger timeline | Drag the line above the timeline; double-click resets |
| R9 | Cut like Premiere | Ctrl+K split, C razor, gaps, ripple delete, restore, snapping, right-click menus |
| R1 | Zoom while typing? | Automatic dashed zooms on bursts of typing (toggle under Automatic zoom) |
| R6 | Focus dot instead of X/Y sliders | Drag the dot on the preview; aim view shows the area and other zooms |
| R3 | Grab the screen to tilt 3D | Alt+drag tilts, Alt+Shift+drag rotates, Alt+scroll = field of view |

| Area | Verified by running it | Still unverified |
|---|---|---|
| Deselect, undo | `editor-interactions` browser test (fails before, passes after); 8 history unit tests | Dan's feel for keyboard-arrow undo |
| Scrubbing | `scrub-frames`: empty card on 128 of 307 frames before, 0 of 326 after; paused frame matches | Long native recordings at 4K |
| Camera lead and fast clicks | Unit tests: 99% of the way to the second click by the time it happens; video always opens unzoomed | Which lead feels right |
| 3D fit | `3d-fit`: 1,024 card pixels on the frame edge before, 0 after, at default and maximum tilt | Dan's eyes on real recordings |
| Export location | `export-location` (desktop app): Save As, remembered folder, quiet cancel, Ctrl+E, a failed export leaves the old file untouched | The real Windows dialog by hand |
| Timeline size | `timeline-resize` at 1920×1080 and 1366×768; resting look pixel-identical | 4K at 150% |
| Cutting | 16 edit unit tests; `cutting` browser test (split, gap, ripple, restore, razor, snapping, edge drags, one-step undo); A3 exports a gap + ripple with exactly 270 frames for 9 s | Real recordings; whether the fit-to-width timeline feels right |
| Typing zoom | 7 unit tests; A5 toast shows typing zooms ("36 zooms") | Taste |
| Focus dot, Alt tilt | 7 mapping unit tests; `focus-dot` browser test; `alt-tilt` desktop test (the menu bar no longer appears on Alt) | Feel |
| Build | 0.4.0 portable packed; bundled helper hash matches; packaged smoke passes on the portable and unpacked app (footer shows v0.4.0) | — |
| Native capture | `native:check` all ✔; A2 passed (0 bar pixels vs 1,069 control); A5 passed (386 ms auto-edit, 845 ms first frame); A4 clicks 0.5 px, cursor 0 px, crash recovery passed | **A/V sync: see heads-up below** |

### Heads-up: three things the run could not close

1. **Sound measured ~57 ms late today.** The helper's own sync test (`tests/a4-av-sync.mjs`) measured 75, 51, 53, 58, 47 ms, and A4's single-flash check measured 66 then 58 ms (limit 20). Yesterday the same test measured −5 ms. **Nothing in this run touched capture:** that test runs the unchanged helper directly with its own fixture. Premiere Pro, Discord, Chrome and Spotify were open at the time. No offset was added (as the plan requires). Check it in the hand test below (step 13); a follow-up task is queued to investigate.
2. **A3 export speed is load-sensitive.** Every A3 run passed on correctness (exact frames, audio, pitch, cancel). The 60 s export beat its 30 s budget in five runs (20.5–25.9 s) and missed it in others (30–40 s) while Codex and Premiere were loading the PC. A side-by-side of old and new code showed the same spread (23–49 s), so it isn't a slowdown from this work.
3. **`tests/desktop-capture.mjs` is repaired and passes again** (9/15 13:51, both the window and `--region` variants; `audio-proof` and `export-formats` pass on the files it writes). It now expects the auto-edit toast and an export streamed to `tests/.exports`, and it no longer types or clicks on the PC: the browser-capture fallback records no clicks or keys by design (the helper does that), and none at all for a window.
4. **Bug found by that run, not fixed: exporting a browser-captured WebM shows only its first ~1 s.** Every later frame is the empty card; sound is fine. Native MP4 recordings (the normal path) are unaffected. Cause: MediaRecorder WebMs have no index and keyframes only every ~5 s, and mediabunny 1.56.2's lookup jumps straight to the one-second cluster it remembers, finds no keyframe there, and gives up instead of looking earlier. The same file remuxed with an index returns every frame. It slipped through because `export-formats` exports only 1 s of that file and `desktop-capture` checks the export's size, not its pictures.

## Dan's hand test for 0.4.0

Run `release\Studio Screen 0.4.0.exe` on the office PC (on another PC: `npm run desktop:pack` first). It opens your existing library; older projects load fine. For the sync check in step 13, close Premiere, Discord and Spotify first.

1. **Record a take.** New recording → your main display → Start. During the take:
   - Click something top-left, then something bottom-right within a second.
   - Click into a text field and type a sentence, then keep typing for a few seconds.
   - Clap or play something with sharp sounds that also moves on screen (for step 13).
   - Finish. The toast says "Auto-edit: … zooms …".
2. **Scrub.** Drag quickly back and forth along the time ruler. The preview should never flash white or empty; it holds the last picture and lands on the right frame when you let go.
3. **Fast clicks.** Play the part with the two quick clicks. The camera should already be sliding toward the bottom-right before that click lands, not after.
4. **Typing zoom.** On the Zoom track there's a dashed clip over your typing that starts about a second before you typed and aims at the field you clicked. The click-then-type part stays zoomed in the whole time. Hover the clip and click × to remove it. Focus & 3D → Automatic focus & animation → **Zoom while typing** off: typing zooms disappear; turn it back on.
5. **Zoom lead.** Same panel → **Camera spring** → **Zoom lead** reads 0.5 s, with a line "Automatic zooms start moving 1.04 s before each click" (Smooth). Try 0 s and 1 s while playing a click. Pick Snappy or Floaty: Zoom lead keeps its value.
6. **Deselect and undo.**
   - Click a zoom clip, then empty timeline space: the inspector no longer shows "Selected focus", and Delete does nothing. Same with Esc, or clicking a corner of the preview.
   - Select a zoom and drag **Magnification** far. One Ctrl+Z puts it back where it started.
7. **Focus dot.** Click a zoom clip: a peach dot sits on the preview.
   - Press and hold it: the preview shows the whole recording, an orange box shows what the zoom will show, faint rings mark the other zooms.
   - Drag, let go: the zoom now aims there. One Ctrl+Z undoes it.
   - Scroll over the dot: magnification changes.
8. **3D.**
   - Canvas → Padding **0**. Focus & 3D → Add 3D zoom → drag the tilt sliders to the ends. All four corners of the recording stay inside the frame.
   - Hold **Alt** and drag on the preview: it tilts. **Alt+Shift**+drag rotates; **Alt**+scroll changes field of view. The menu bar never appears. One Ctrl+Z undoes a whole drag.
   - On a 2D zoom, Alt+drag shows "Switch this zoom to 3D to tilt it." once.
9. **Timeline size.** Hover the line just above the timeline toolbar and drag up: the timeline and its rows get taller and the preview shrinks. Quit and reopen: the height is kept. Double-click the line: back to normal.
10. **Cutting.** On the Screen track:
    1. Put the playhead somewhere and press **Ctrl+K**, then again elsewhere: three pieces with thin dividers.
    2. Click the middle piece → **Delete**: a hatched gap stays. Play: it's skipped and the duration drops.
    3. Click the gap → **Delete**: it closes up, everything after slides left, and a small red marker shows where it was (hover for "Removed … s").
    4. Right-click the marker → **Restore footage**: it's back.
    5. Click a piece → **Shift+Delete**: ripple delete.
    6. Press **C**: scissors cursor and a line follow the mouse; click to split. **V** goes back.
    7. Drag a zoom clip near a split: it jumps onto it with an orange line. Press **S** (or the magnet) and try again: no snapping.
    8. Drag a piece's inner edge inward: a gap. Hold **Shift** while dragging: a ripple. The **Ⅱ** grips at the ends trim.
    9. Right-click a piece: Split at playhead · Delete (leave gap) · Ripple delete.
    10. Ctrl+Z walks back one edit at a time.
11. **Export.**
    - Export video → Export: Windows **Save As** opens in `Videos\Studio Screen\Exports` → choose another folder and name → "Export complete. Saved to <folder>." → **Show in folder** opens it.
    - Export again: Save As starts in that folder. Cancel it: nothing happens and the dialog stays ready.
    - Close the dialog, press **Ctrl+E**: saves straight into that folder with a numbered name, no dialog.
    - Optional: export over an existing file and cancel halfway. The old file is still intact.
12. **Play the export** (MP4 · 1080p · 60 fps): cuts, zooms and typing zooms match the editor.
13. **Sound sync.** With Premiere, Discord and Spotify closed, play the clap/sharp-sound part of the export. Does the sound land with the picture? If you can, record once more with them open and compare.

Tell me: which zoom lead feels right, whether typing zooms are welcome, how the fast-click camera feels, anything confusing about cutting, and whether sound was in sync in step 13.

## Next steps (in order)

1. Dan's hand test above.
2. Follow-up queued from this run: investigate the ~57 ms A/V measurement (no offsets).
3. Fix exporting browser-captured WebMs (heads-up 4), with a test that exports the whole file and checks its pictures.
4. Tune defaults from Dan's answers (zoom lead, typing zoom).
5. Still unverified from before: the separate 30-minute/4K soak and timed 4K60 export.

## Setup on any machine

Rust must be installed. Then:

```powershell
git pull
npm install
npm run native:check
```

Every line should show ✔. `npm run desktop:dev` runs the app from source; `npm run desktop:pack` builds the portable EXE into `release/`.

## Open threads and ideas (not started)

- Parking lot from the plan: device frames, captions from system audio, mark-a-mistake hotkey, deleting recording folders from the library, recording the text caret in the helper (would improve typing-zoom aim), a true output-time timeline, right-click menus on zoom/speed/caption clips, shorter keyframe intervals in native recordings for faster seeking.
- Known limits:
  - A window that's resized mid-take is padded or cropped to its starting size.
  - Displays wider than 4096 px are untested.
  - Custom app cursors draw as an arrow.
  - Drag gestures aren't interpreted.
  - The timeline fits its whole length to the width, so closing a gap rescales the view instead of leaving room at the end.
  - Browser-capture fallback (no helper): no clicks, keys or typing, so no automatic zooms; for a window it records no pointer at all (window sources have no display to poll).
- `tests/export-formats.mjs` and `tests/audio-proof.mjs` need `tests/native-capture.webm` / `tests/native-export.webm`, which `tests/desktop-capture.mjs` creates.

## Not in git (on purpose)

All regenerated by tests or builds: `node_modules/`, `dist/`, `release/` (portable builds), `native/studio-capture/target/` (helper build, ~200 MB), `tests/.fake-take/` (5-minute synthetic take, rebuilt by `a5-open-speed`), test profiles, recordings and exports under `tests/.*`, generated fixture videos, and `tests/*-results.json`. Test recordings of the real screen are deleted after measuring or kept only under `tests/.projects`.

## How to check the build

```powershell
npm install
npm run test
npm run build
npm run native:build
npm run native:check
# With `npm run dev` running: see README → Tests
```
