# Status — Studio Screen

**Last updated:** 2026-09-14 (verification resumed; native sync under diagnosis)

## Where things stand

Option A is built and pushed: a readability pass, then phases A1 (smooth camera and cursor), A2 (recording gets out of the way), A3 (frame-by-frame export), A4 (Rust capture helper) and A5 (auto-edit on stop). Spec: [docs/SPEC.md](docs/SPEC.md). What was built: [docs/PLAN.md](docs/PLAN.md). Evidence and gaps: [VALIDATION.md](VALIDATION.md).

| Phase | Verified by running it | Still unverified |
|---|---|---|
| Readability | Screenshots at 4K/150% and laptop size; browser tests | Dan's eyes |
| A1 camera & cursor | Unit tests; 60 fps preview on a 10-min 3D project; playback test | Which camera feel Dan likes |
| A2 recording UI | Native test passed: protected marker 0 pixels, control 1,045; countdown, hidden editor and restored focus | Dan's hand test |
| A3 export | Latest browser 60 s 1080p60 in 28.1 s; minimized desktop 30.5 s; exact frames, pitch and cancellation passed | 4K60 export speed; launching the packaged app |
| A4 capture helper | Capability check; smoke take; click accuracy 0.5 px; clicks, right-click, wheel, shortcut, typing, cursor shapes; take survives helper kill; helper stops 0.4 s after app kill; recovery | A clean full pass of the end-to-end test; the 30-minute memory soak; **A/V sync correction not applied (see below)** |
| A5 auto-edit | Five-minute synthetic take: auto-edit 288 ms, first frame 635 ms, saved 1,439 ms; test passed after fixing its autosave race | Dan's hand test |

### Known issue: native audio/video timing

**Latest re-check on this checkout:** setup, all five native capability checks, 63 unit tests, production build, browser smoke, A3, native A2 and A5 passed. Correcting fixture placement/crop and audio timestamp handling produced six flashes and six tones. Sync measured **−52 ms uncalibrated** and **−92 ms with −49 ms configured**: audio leads here, so the proposed −49 ms default is not applied. The native end-to-end run measured 0.51 px click error and successful recovery behavior but failed its sync assertion. See [VALIDATION.md](VALIDATION.md) for exact results and test limitations.

The earlier ~49 ms audio delay was measured on the original PC. Current diagnosis found that the helper leaves audio gaps of 20 ms or less unfilled; a synthetic test through the real AAC encoder reproduced a 1.000 s tone moving to 0.920 s after eight missing 10 ms packets. Explicit gap filling restored 1.000 s. The helper fix passes the synthetic encoder regression and two Rust timeline tests; native remeasurement is pending an idle PC. No fixed offset should be inferred from the earlier results.

## Next steps (in order)

**Dan authorized continuing verification.** Screen recordings are deleted after measurement. No `--force`; capture and input tests wait for idle. The first soak stopped on resumed input after 247.8 s, with a 2 MB settled-memory spread; it is not a completed five-minute pass.

1. With the PC idle, remeasure sync after the audio-gap fix, then rerun `node tests/a4-native-capture.mjs`. Only consider the original −49 ms app correction if the uncalibrated delay is again about +49 ms and the calibrated mean is within ±20 ms; current measurements do not satisfy that gate.
2. Complete `node tests/a4-soak.mjs --minutes 5` during uninterrupted idle time. The separate 30-minute/4K soak remains unverified; this PC currently records 2560×1440. A2 and A5 passed; rerun if subsequent changes affect them. Record results in VALIDATION.md.
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
