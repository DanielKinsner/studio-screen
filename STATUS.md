# Status — Studio Screen

**Last updated:** 2026-09-14

## Where things stand

- v0.2.1 works: Windows capture with system audio, editor, 3D focus, annotations, captions, WebM/MP4/GIF export.
- Dan chose **Option A: feel first**. Approved spec: [docs/SPEC.md](docs/SPEC.md). Task plan: [docs/PLAN.md](docs/PLAN.md).
- Personal tool. No mic or camera for now.

## Current phase

**A1 — Smooth camera and cursor: built, waiting on Dan's hand test.**

| Task | State |
|---|---|
| 1. Spring + memo primitives | done |
| 2. Precomputed cursor path | done |
| 3. Auto zooms that glide | done |
| 4. Spring camera path | done |
| 5. Camera feel settings + UI | done |
| 6. Playback at 60 fps | done (59.9 fps, 0.2% dropped on a 10-minute 3D project) |
| 7. Phase close + hand-test script | done — hand test below is open |

Evidence: [VALIDATION.md](VALIDATION.md) → "A1".

### Dan's A1 hand test (open)

1. Run `npm run desktop:dev`.
2. **New recording** → pick your main display → **Record**.
3. Click something near the top-left of the screen, then within about 1 second click something near the bottom-right. Wait 10 seconds. Click something in the middle. Press **Ctrl+Shift+R**.
4. Press **Space** to play. You should see: the camera zooms toward the first click, **glides** to the second without zooming out, holds about 2 seconds, then eases out. About 10 seconds later, a separate zoom for the middle click.
5. On the timeline's Zoom row, the first two clicks are **one** clip. Select it → **Focus & 3D** → **Focus point** says "Follows 2 clicks".
6. **Focus & 3D** → **Automatic focus & animation** → **Camera feel**: try **Snappy** and **Floaty** and replay. Moves should get quicker or slower. Open **Camera spring** and set **Bounce** to about 25%: zooms should overshoot slightly and settle.
7. Pause in the middle of a glide, drag the playhead a little, press **Space**: motion continues with no jump.
8. Tell me which feel is closest to right, and anything that feels floaty, late, or jerky. Tuning numbers are in docs/PLAN.md → "Tuning constants".

Expected and not a bug yet: the real Windows cursor is still baked into recordings, so you'll see two cursors. That goes away in A4.

## Next up

A2 (hide the app while recording + countdown) → A3 (frame-by-frame export) → A4 (Rust capture helper, starts with a proof) → A5 (auto-edit on stop).

## How to check the build

```powershell
npm install
npm run test
npm run build
# With `npm run dev` running:
node tests/browser-smoke.mjs
node tests/a1-playback.mjs
node tests/a1-preview-perf.mjs
```
