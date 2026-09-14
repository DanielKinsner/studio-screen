# Status — Studio Screen

**Last updated:** 2026-09-14

## Where things stand

- v0.2.1 works: Windows capture with system audio, editor, 3D focus, annotations, captions, WebM/MP4/GIF export.
- Assessment against Screen Studio + FocuSee done. Dan chose **Option A: feel first** — see [docs/SPEC.md](docs/SPEC.md) for the approved spec and [docs/PLAN.md](docs/PLAN.md) for the task plan.
- Personal tool. No mic or camera for now.

## Current phase

**A1 — Smooth camera and cursor.** In progress.

| Task | State |
|---|---|
| 1. Spring + memo primitives | not started |
| 2. Precomputed cursor path | not started |
| 3. Auto zooms that glide | not started |
| 4. Spring camera path | not started |
| 5. Camera feel settings + UI | not started |
| 6. Playback at 60 fps | not started |
| 7. Phase close + hand-test script | not started |

## Next up after A1

A2 (hide the app while recording + countdown) → A3 (frame-by-frame export) → A4 (Rust capture helper, starts with a proof) → A5 (auto-edit on stop).

## How to check the build

```powershell
npm install
npm run test
npm run build
```
