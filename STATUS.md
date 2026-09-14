# Status — Studio Screen

**Last updated:** 2026-09-14 (paused at Dan's request)

## Where things stand

Option A is built and pushed: a readability pass, then phases A1 (smooth camera and cursor), A2 (recording gets out of the way), A3 (frame-by-frame export), A4 (Rust capture helper) and A5 (auto-edit on stop). Spec: [docs/SPEC.md](docs/SPEC.md). What was built: [docs/PLAN.md](docs/PLAN.md). Evidence and gaps: [VALIDATION.md](VALIDATION.md).

| Phase | Verified by running it | Still unverified |
|---|---|---|
| Readability | Screenshots at 4K/150% and laptop size; browser tests | Dan's eyes |
| A1 camera & cursor | Unit tests; 60 fps preview on a 10-min 3D project; playback test | Which camera feel Dan likes |
| A2 recording UI | Bar/countdown absent from footage (with browser capture, plus a control run) | Same test with the capture helper |
| A3 export | 60 s 1080p60 in 23 s, exact frames, pitch, cancel, minimized desktop export; portable build bundles the helper | 4K60 export speed; launching the packaged app |
| A4 capture helper | Capability check; smoke take; click accuracy 0.5 px; clicks, right-click, wheel, shortcut, typing, cursor shapes; take survives helper kill; helper stops 0.4 s after app kill; recovery | A clean full pass of the end-to-end test; the 30-minute memory soak; **A/V sync correction not applied (see below)** |
| A5 auto-edit | Unit tests; browser check of dashed clips, ×, Back to raw | 5-minute take opens in under 3 s (test written, not run) |

### Known issue: sound about 49 ms behind the picture

On this PC, native recordings put system audio about 49 ms after the matching picture: 47–51 ms across 5 flashes in `tests/a4-av-sync.mjs`. The helper already accepts an `audioOffsetMs` setting, and one run with −49 ms averaged −1 ms. It is **not wired into the app yet**. It also needs a clean re-check after the silence-filler fix (commit 701902a), because the runs after that fix were disturbed by someone using the PC. At a 49 ms offset lip-sync issues are borderline visible; clicks and system sounds will feel slightly late.

## Next steps (in order)

1. With the PC idle, run `node tests/a4-av-sync.mjs` then `node tests/a4-av-sync.mjs --offset-ms -49`. If the second averages within ±20 ms, have `electron/main.cjs` pass `audioOffsetMs: -49` in the helper config (`studio:native-start`), commit, and re-run.
2. With the PC idle, run in turn: `node tests/a4-native-capture.mjs`, `node tests/a2-recording-ui.mjs`, `node tests/a5-open-speed.mjs`, then `node tests/a4-soak.mjs` (30 minutes; `--minutes 5` for a quick one). Record the results in VALIDATION.md.
3. Dan's hand test (below). Tune camera feel from his notes.
4. Bump `package.json` to 0.3.0 before the next portable build (the new build currently overwrote `release/Studio Screen 0.2.1.exe`).

## Dan's hand test (everything at once)

Setup, once per machine (Rust must be installed):

```powershell
git pull
npm install
npm run native:check
```

Every line should show ✔. Then:

```powershell
npm run desktop:dev
```

1. **Readability.** Text should be comfortable. **Ctrl + =** / **Ctrl + −** sizes the whole interface, and it's remembered.
2. **Record.** **New recording** → your main display → leave **3-second countdown** on → **Start recording**. The editor disappears, 3-2-1 shows in the middle, then a small bar appears at the bottom.
3. **During the take.**
   - Click something top-left, then something bottom-right within a second.
   - Type a few words, then press **Ctrl + K**.
   - Keep the mouse still for about 10 seconds.
   - Open and close **speaker notes** on the bar.
   - **Pause**, wait, **Resume**.
4. **Finish** on the bar. Within a few seconds the editor is back with "Auto-edit: …" and a **Back to raw** button.
5. **Play it (Space).**
   - The start and your reach for Finish are trimmed off.
   - There's **one** crisp cursor: an I-beam over text, a hand over links.
   - The camera glides from the first click to the second without zooming out.
   - Typing plays at 2× and the still stretch at 4×.
   - The bar, countdown and notes are not in the video.
   - Sound may be slightly behind the picture: that's the known issue above.
6. **Timeline.**
   - Automatic clips are dashed. Hover one and click **×** to remove just that edit.
   - **Pacing → Back to raw** removes the whole automatic edit; **Apply automatic edit** brings it back.
7. **Feel.** **Focus & 3D → Camera feel**: try Snappy and Floaty, and Bounce around 25%.
8. **Export.**
   - MP4 · 1080p · 60 fps. Minimize while it renders; it keeps going.
   - **Show in folder** and play the file.
   - **Ctrl + E** exports again with the same settings.
9. **Crash safety (optional).** Mid-take, end **Studio Screen** in Task Manager, then relaunch. You should see "Recovered a recording…".
10. **Window recording.** Record one app window and close that app mid-take: the take ends and opens.

Tell me which camera feel is right, whether auto-trim ever cuts something you wanted, and anything slow or confusing.

Recordings: `Videos\Studio Screen\<date time>\`. Exports: `Videos\Studio Screen\Exports\`.

## Open threads and ideas (not started)

- Proposed extras, each needing a quick spec and a go:
  - mark-a-mistake hotkey
  - auto-zoom on typing
  - device frames
  - captions from system audio
  - deleting recording folders from the library (today it only removes the library entry)
- Known limits:
  - A window that's resized mid-take is padded or cropped to its starting size.
  - Displays wider than 4096 px are untested.
  - Custom app cursors draw as an arrow.
  - Drag gestures aren't interpreted.
- `tests/export-formats.mjs` needs `tests/native-capture.webm`, which `tests/desktop-capture.mjs` creates. Run that first on a new machine.

## Not in git (on purpose)

All regenerated by tests or builds: `node_modules/`, `dist/`, `release/` (portable builds), `native/studio-capture/target/` (helper build, ~200 MB), `tests/.fake-take/` (5-minute synthetic take, rebuilt by `a5-open-speed`), test profiles and exports under `tests/.*`, generated fixture videos, and `tests/*-results.json`. Test recordings of the real screen are deleted after measuring.

## How to check the build

```powershell
npm install
npm run test
npm run build
npm run native:build
npm run native:check
# With `npm run dev` running: see README → Tests
```
