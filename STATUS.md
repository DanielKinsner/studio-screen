# Status — Studio Screen

**Last updated:** 2026-09-14 (native suite passed; five-minute soak awaiting uninterrupted idle)

## Where things stand

Option A is built and pushed: a readability pass, then phases A1 (smooth camera and cursor), A2 (recording gets out of the way), A3 (frame-by-frame export), A4 (Rust capture helper) and A5 (auto-edit on stop). Spec: [docs/SPEC.md](docs/SPEC.md). What was built: [docs/PLAN.md](docs/PLAN.md). Evidence and gaps: [VALIDATION.md](VALIDATION.md).

| Phase | Verified by running it | Still unverified |
|---|---|---|
| Readability | Screenshots at 4K/150% and laptop size; browser tests | Dan's eyes |
| A1 camera & cursor | Unit tests; 60 fps preview on a 10-min 3D project; playback test | Which camera feel Dan likes |
| A2 recording UI | Native test passed: protected marker 0 pixels, control 1,071; countdown, hidden editor and restored focus | Dan's hand test |
| A3 export | Latest browser 60 s 1080p60 in 28.1 s; minimized desktop 30.5 s; exact frames, pitch and cancellation passed | 4K60 export speed; launching the packaged app |
| A4 capture helper | Full native suite passed at 150% scaling: 1.26 px clicks, full input events, −7 ms A/V; six-flash sync mean −5 ms; helper/app crash recovery passed (472 ms helper exit) | Five-minute soak awaiting uninterrupted idle; separate 30-minute/4K soak; Dan's hand test |
| A5 auto-edit | Five-minute synthetic take: auto-edit 357 ms, first frame 737 ms, saved 1,552 ms; test passed after fixing its autosave race | Dan's hand test |

### Current verification: sync and native end-to-end passed

Setup, five native capability checks, 65 JavaScript tests, production build, browser smoke, A3, native A2 and A5 passed. After filling short PCM gaps in the helper, the plain six-flash sync test passed: **−13, +8, +1, −12, −8 ms; mean −5 ms**. The −49 ms negative control measured **−51 ms mean** and failed. The app correctly retains zero offset; the original +49 ms calibration does not apply here.

The native end-to-end suite now passes on the 150% secondary display: **1.26 px** click error, full input events, **−7 ms** sync, zero cursor pixels versus 234 in the control, and both crash-recovery assertions. The test injector needed per-monitor thread DPI awareness. A2 rerun passed (0 protected marker pixels; 1,071 control); A5 rerun passed (357 ms auto-edit, 737 ms first frame, 1,552 ms saved). The five-minute soak has been interrupted by input and remains queued. See [VALIDATION.md](VALIDATION.md).

## Next steps (in order)

**Dan authorized continuing verification.** Screen recordings are deleted after measurement. No `--force`; capture and input tests wait for idle. Soak attempts stopped on resumed input at 247.8 s, 187.4 s and 184.4 s, with settled-memory spreads of 2, 3 and 1 MB respectively. None is a completed five-minute pass.

1. Finish the uninterrupted five-minute soak and record its actual duration, resolution and memory measurements.
2. Stop for Dan's hand test before new features. The separate 30-minute/4K soak remains unverified; this PC currently records 2560×1440.
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
   - Check that sound and picture stay aligned. The automated sync test now passes.
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
