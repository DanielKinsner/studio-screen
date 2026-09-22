# Status — Cool Story (formerly Studio Screen)

**Last updated:** 2026-09-22 (**Cool Story 0.4.3** packed and installed: rename, violet, design pass, five review fixes, one word for zooms)

## 0.4.3: Cool Story (2026-09-22)

**Installed.** `%LOCALAPPDATA%\Programs\Cool Story\Cool Story.exe`, with a Start-menu shortcut **Cool Story** (type it in Start; pin it if you like). Same file as `release\Cool Story 0.4.3.exe` (receipt in VALIDATION.md). Future packs overwrite that one exe; the shortcut stays.

**Rename (display name only).** Logo wordmark, window titles, page title, messages, `productName` (exe name) and the app icon. Deliberately **unchanged**, because they are storage addresses: `Videos\Studio Screen` (takes and exports), `%APPDATA%\studio-screen` (library and settings; now pinned in `electron/main.cjs` so a name change can never move it), the IndexedDB name and the `.studio` format tag `studio-screen`. Renaming those later needs a migration step first. Checked on the installed 0.4.3 with the real profile: it used `%APPDATA%\studio-screen`, created no `Cool Story` profile, and its library lists all **8 projects** (it opened "Recording · Sep 15").

**Recolour.** Peach accent became `--accent: #8f80ff` (signal violet), and olive-tinted greys became cool slate: 251 colour values in `src/styles.css` moved by hue family. Colours that carry meaning were left alone (red removed/record/discard, green export success, the timeline clip-type colours). Default annotation colours drawn into exported video (`compositor.ts`) are still peach on purpose; they're video content, not app chrome.

**Design pass** (`e16c97e`, `9c91670`, `36c8d52`): panels open on their controls (headlines, intro copy and the Canvas tip card removed); a selected zoom or speed section shows its controls at the top, with a compact Classic zoom / 3D perspective toggle for a selected zoom; help text 13 px, one step below the labels; Audio leads with volume; one save message (by the project name); Annotate icons all distinct and element clips named like the panel; zoom labels show the real magnification (1.65×, 1.35×); the "Fit" button (a second fullscreen button) and the noise-suppression tip are gone. One word for zooms: **zoom** for the clips (tab **Zoom & 3D**, "Selected zoom", "Zooms"), **focus point** only for where a zoom aims.

**Review fixes, each with a test that fails before and passes after:**
- Imported `.studio` files drop `folder` and `videoUrl`, so autosave can't write into another take (`src/storage.test.ts`).
- A capture helper that dies mid-take can't crash the main process through its stdin pipe (`electron/helper-pipe.cjs`, `tests/helper-pipe.test.js`; 5 of 5 runs raised EPIPE before).
- AltGr characters (@ { } €) log as anonymous typing, never as "Ctrl + Alt + <key>" (`native/studio-capture/src/keys.rs`, 6 tests).
- An export that can't encode its audio stops with a message instead of saving a silent file (`tests/export-audio-encoder.mjs`).
- GIF frames share a palette until the scene changes: no shimmer, smaller files (`src/gif.ts`, `src/gif.test.ts`; the sample GIF went from 360 palettes to 1).
- Checked and **not** a bug: dragging footage back over a ripple cut leaves trimmed zooms trimmed, same as Restore footage (ripple trims are permanent; Ctrl+Z undoes).

**Verified:** `tsc`; 122 unit tests in 19 files; 17 Rust tests; build; browser tests `browser-smoke`, `export-audio-encoder`, `editor-interactions`, `focus-dot`, `cutting`, `v2-proof`, `v2-visual`, `v2-audio`, `3d-fit`, `webm-export`; readability audit at 2560×1440 (no text under 12 px); `packaged-smoke --portable` on 0.4.3. **Not run** (need an idle PC): `a2-recording-ui` (now looks for "Cool Story" windows) and the a4 capture tests.

### Dan's hand test for 0.4.3 (about 3 minutes)

1. Start → type **Cool Story** → open it. Violet buttons, "coolstory" logo, footer `v0.4.3`.
2. Click **coolstory ⌄** (top left): your takes are all there.
3. **Zoom & 3D** → click a zoom clip: "Selected zoom" is at the top; switch Classic zoom ↔ 3D perspective there and the clip label follows.
4. Annotate: eight different icons; add a Box and its timeline clip says "Box".
5. Record a short take and export it as MP4: the sound is there, as before.
6. Anything you miss from the removed headlines or footer text? Say so and it comes back.

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
| Browser-recording export (WebM) | `webm-export`: 4 of 6 checked seconds were the empty card before the fix, 0 after (whole take and a trim starting mid-cluster); the real 9/15 fallback recordings re-export with picture throughout; `export-formats`, `browser-smoke`, `v2-audio`, `v2-proof` pass | A3 not re-run after this fix (MP4 path unchanged) |
| Desktop-recording export (MP4) | `native-export-frames`: 624 of 1,050 exported frames wrong before the fix, 0 after (60 fps, 30 fps, trimmed mid-fragment); Dan's four real takes: 0 of 12,059 frames timed differently from FFprobe after the fix; re-exporting his 14.16.48 take: 7–14.6 s matches the raw take throughout (the stall and lag are gone); unit tests, build, `webm-export`, `export-formats`, `browser-smoke`, `v2-audio`, `v2-proof` pass | Dan's eyes in Premiere on a repacked build; A3 not re-run (its fixture has no fragments, so the patched code isn't reached) |
| Build | 0.4.0 portable packed; bundled helper hash matches; packaged smoke passes on the portable and unpacked app (footer shows v0.4.0) | — |
| Native capture | `native:check` all ✔; A2 passed (0 bar pixels vs 1,069 control); A5 passed (386 ms auto-edit, 845 ms first frame); A4 clicks 0.5 px, cursor 0 px, crash recovery passed | **A/V sync: see heads-up below** |

### Heads-up: what the run could not close, and fixes since

0. **Recorded frames stuttered (1,3,1,3 on 30 fps content); rebuilt in 0.4.2.** Dan's 0.4.1 re-test: drift was gone (beeps exactly 1.000000 s apart, export faithful to the take), but the raw take itself held frames unevenly, 39% of 30 fps steps being 1 or 3 frames instead of 2, and the 0.4.0 takes ranged from clean to mixed. Cause: the helper wrote "the newest picture" at each 1/60 s deadline judged by delivery time, while Windows stamps each frame with its screen refresh and delivers it a varying few ms later; refreshes near a slot boundary were coin flips, and since both clocks run at the same rate the phase stuck for a whole take. Now frames queue with their stamps, `video_timeline::Slotter` puts each in the slot its stamp falls in, and t = 0 is aligned half a slot before a refresh so stamps sit mid-slot (a trace shows them at exactly phase 0.5 on a 16.7 ms grid, delivered 7–13 ms before their stamp). Pinned by 7 Rust unit tests (one reproduces the old flip) and the new idle-gated `tests/a4-cadence.mjs`. **What it can't fix:** Chromium itself skips presenting some refreshes (the fixture skipped 48 in 8 s; YouTube in Chrome ~13%, and NVIDIA's recording shows the same), so a recording is only as even as the screen was. A/V timing is unchanged by the rebuild (`a4-av-sync` 69 ms before and after, the Chrome-playback offset on this PC).
1. **Audio drifted early in every helper recording; fixed in the helper and packed in 0.4.1.** Dan's 9/15 hand test: beeps in the YouTube sync clip came out 0.99944 s apart in Studio Screen takes but exactly 1.000000 s in NVIDIA recordings of the same clip, so sound ran about **34 ms/min fast** against the picture (⅙ s off after 5 minutes). Cause: the helper trimmed a sample whenever a loopback packet's timestamp jittered a few microseconds early but only padded when one was ≥ 21 µs late, bleeding 12–27 samples a second and clicking both ways. `audio_timeline::align` now treats packets within 2 ms of the expected time as contiguous; real gaps and pause overlaps are still corrected. Pinned by four Rust unit tests and `tests/audio-clock.mjs` (real device, silent, no idle needed). Packed in `release\Studio Screen 0.4.1.exe` (with the export fix below); end-to-end confirmation is Dan's re-record. The separate ~60–85 ms "sound after picture" seen with the sync clip is the clip/Chrome playback on this PC (NVIDIA shows the same), not the recorder; details in VALIDATION.md.
2. **A3 export speed is load-sensitive.** Every A3 run passed on correctness (exact frames, audio, pitch, cancel). The 60 s export beat its 30 s budget in five runs (20.5–25.9 s) and missed it in others (30–40 s) while Codex and Premiere were loading the PC. A side-by-side of old and new code showed the same spread (23–49 s), so it isn't a slowdown from this work.
3. **`tests/desktop-capture.mjs` is repaired and passes again** (9/15 13:51, both the window and `--region` variants; `audio-proof` and `export-formats` pass on the files it writes). It now expects the auto-edit toast and an export streamed to `tests/.exports`, and it no longer types or clicks on the PC: the browser-capture fallback records no clicks or keys by design (the helper does that), and none at all for a window.
4. **Fixed: exporting a browser recording with sound showed only its first ~1 s** (then the empty card). Found by that run; native MP4 recordings were never affected. Cause: those WebMs have no index, keyframes seconds apart and a new cluster every second, and mediabunny 1.56.2's lookup by time gives up when a frame's keyframe is in an earlier cluster. The exporter now reads WebM frames in order instead (MP4 keeps the fast lookup). Pinned by `tests/webm-export.mjs`, which fails on the old code. Browser recordings without sound were never affected (their clusters start at keyframes).
5. **Fixed: exports of normal desktop recordings stalled and ran behind** (found by Dan in Premiere on the 0.4.0 hand test). **0.4.0 has this bug; any pack from before the fix does.**
   - **What Dan saw:** the export held a frame for ~0.2 s before every other 2 s keyframe, then ran 12–13 frames (~0.2 s) behind its own sound for 2 s, then 6–7 frames behind for 2 s, then caught up, on a 6 s cycle.
   - **Where:** baked into the exported file, not Premiere. The export is evenly spaced at 60 fps, and 88% of its frames show exactly the raw frame the cause below predicts. The raw recordings are fine, and the editor preview reads them correctly.
   - **Cause:** the helper's MP4 (written by Windows Media Foundation) has 0.3 s fragments with no start time (`tfdt`) and an index (`mfra`/`tfra`) that names each 2 s keyframe as "sample 13, 7 or 1 of fragment X". mediabunny 1.56.2 discarded the sample number and used the keyframe's time as the fragment's start, so whole fragments were timed 200 or 100 ms late and the exporter picked old frames. This predicts the library's timestamp for all 12,059 frames in Dan's four takes, with no exceptions. FFprobe reads the same files as perfect 1/60 s steps. Since `142402e` (the first build that recorded through the helper); `5eba2b4` doesn't touch it. Upstream mediabunny still has it.
   - **Fix:** `patches/mediabunny+1.56.2.patch` makes the reader use the index's traf/trun/sample numbers. `npm install` applies it (`postinstall: patch-package`). The helper is unchanged.
   - **Pinned by** `tests/native-export-frames.mjs`: it builds a clip with the helper's exact layout and a frame-number barcode in every frame, and checks that every exported frame shows the right source frame. It fails on the old reader (252, 126 and 246 wrong frames) and passes with the fix (0 of 1,050). `node tests/native-export-frames.mjs --recording "<take>\recording.mp4"` checks a real take against FFprobe.
   - **Before a hand re-test:** run `npm install` so the patch is applied, then rebuild the portable. A pack without the patch still stalls.

## Dan's hand test for 0.4.2 (recording and export; still applies to 0.4.3)

Run the installed **Cool Story** (0.4.3, Start menu) or `release\Studio Screen 0.4.2.exe` on the office PC (0.4.0 drifts and stalls, 0.4.1 stutters on smooth motion; don't use them) (on another PC: `npm run desktop:pack` first). In 0.4.3 the "Focus & 3D" tab below is called **Zoom & 3D**. It opens your existing library; older projects load fine. For the sync check in step 13, close Premiere, Discord and Spotify first.

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

1. Dan's hand test for 0.4.3 (top of this file), then the recording/export steps of the 0.4.2 hand test above.
2. **Dan's simultaneous comparison on 0.4.3** (same capture as 0.4.2 plus the AltGr fix): start a Cool Story recording of the main display, play the YouTube sync clip fullscreen in Chrome, press Alt+F9 to start NVIDIA mid-play, wait ~15 s, Alt+F9 to stop, then stop Studio Screen. Same playback, both recorders: cadence and audio offset are then compared like for like (beep spacing 1.000000 s, `node tests/native-export-frames.mjs --recording "<take>ecording.mp4"` 0 mistimed frames, export smooth in Premiere). At the next 2-minute idle break: `a4-cadence` (not yet run green under its final rule; its last run measured 40 odd steps against 48 skipped refreshes), `a4-native-capture`, `a4-av-sync`.
3. Tune defaults from Dan's answers (zoom lead, typing zoom).
4. Still unverified from before: the separate 30-minute/4K soak and timed 4K60 export.
5. Report the mediabunny index bug upstream (Dan decides; `npx patch-package mediabunny --create-issue` drafts it). When a fixed mediabunny ships, upgrade and delete the patch; `native-export-frames` confirms it.

## Setup on any machine

Rust must be installed. Then:

```powershell
git pull
npm install
npm run native:check
```

Every line should show ✔, and `npm install` should print `mediabunny@1.56.2 ✔` (the export-timing patch). `npm run desktop:dev` runs the app from source; `npm run desktop:pack` builds the portable EXE into `release/`.

## Open threads and ideas (not started)

- Parking lot from the plan: device frames, captions from system audio, mark-a-mistake hotkey, deleting recording folders from the library, recording the text caret in the helper (would improve typing-zoom aim), a true output-time timeline, right-click menus on zoom/speed/caption clips, shorter keyframe intervals in native recordings for faster seeking.
- Known limits:
  - A window that's resized mid-take is padded or cropped to its starting size.
  - Displays wider than 4096 px are untested.
  - Custom app cursors draw as an arrow.
  - `tests/a4-av-sync.mjs` fails its ±20 ms rule on the office PC by design of the PC, not the recorder: the Chromium player it uses shows sound 60–100 ms after the picture (NVIDIA's recorder measures the same on YouTube). Keep the rule; a pass there needs a like-for-like reference, not an offset.
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
