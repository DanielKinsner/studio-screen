# Studio Screen — "Option A" spec (approved 2026-09-14)

Personal tool for Dan. Windows 11 only. System audio yes; **no microphone, no camera** (for now).

## North star

Almost done with an edit the moment recording stops.

## Echo-back (confirmed)

Pick a screen or window → **Record** → 3-2-1 → Studio Screen gets out of the way (its window is invisible to the recording; only a small stop bar you can see). Do your thing. Hit **Stop** (bar or Ctrl+Shift+R). A few seconds later the editor opens with a **first cut already made**: a crisp cursor that glides (the real one isn't in the footage), a camera that follows what you click, typing sped up, idle waiting sped up, dead air at the start and end trimmed, your usual look applied. Watch it once, delete any auto-edit you don't like, hit **Export**, and get a smooth MP4 faster than real time. Recording writes to disk as it goes, so a crash can't eat a take.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Auto-edit style | **Applied automatically**; auto items are marked and removable in one click |
| 2 | Idle stretches (no input and nothing moving on screen for 3+ s) | **Sped up**, and the speed of each sped-up section stays editable |
| 3 | Auto-trim | **Start 0.5 s before the first action; cut the reach for Stop at the end** |
| 4 | Capture helper | **Rust sidecar program, built from source** (Rust is installed on every machine; nothing prebuilt is committed, so it can never go stale) |
| 5 | Where recordings live | **One project folder per recording in `Videos\Studio Screen\`** |

Why a separate helper program rather than a plug-in inside the app: if the helper crashes, the editor survives and the part of the recording already on disk is recoverable. A plug-in would take the whole app down with it and would need rebuilding for every Electron upgrade.

## Defaults (accepted)

- Old projects (cursor baked in) still open, marked "legacy", fake cursor off by default. Saved looks carry over unchanged.
- Helper fails → keep what was recorded, say so, offer the old capture with a "cursor will be baked in" warning.
- Recorded window closes → stop and keep the take.
- Cursor leaves the recorded monitor → it fades out; the camera holds still.
- Recording under 1 s → opens raw, no auto-edit. No clicks → no zooms, but look and trim still apply.
- Ten rapid clicks → one zoom that follows them, not ten zooms.
- Disk full → stop cleanly, keep what's written, say so.
- No GPU encoder (different PC) → software encoder, slower, with a note.
- First launch opens to New recording; the sample project stays in the library.
- The browser version stays as an editor-only test harness.

## Phases and done-criteria

### A1 — Smooth camera and cursor
1. Two clicks 1.5 s apart in different spots: the camera stays zoomed and glides between them. No zoom out/in.
2. A click while already zoomed pans the camera to the new spot.
3. Jumping to any moment shows exactly the same frame as playing up to it (automated test).
4. Preview holds a steady 60 fps on a 10-minute project with 3D on (measured).
5. One "Camera feel" control (Snappy / Smooth / Floaty); raw physics tucked under Advanced.

### A2 — Recording gets out of the way
1. Record starts a 3-2-1 countdown (on by default, can be switched off), then the main window hides.
2. The stop/pause bar is visible to you but absent from the footage (automated frame scan).
3. Stop brings the editor back to the front.

### A3 — Real rendering export
1. A 60-second 1080p60 project exports in under 30 s on the RTX 4080 PC and keeps going while minimized.
2. The output has exactly the expected frame count; no duplicated or dropped frames (ffprobe check).
3. MP4 always available; exported frames match the preview.
4. Cancel leaves no half-written file.

### A4 — Native capture helper (starts with a throwaway proof)
1. The footage contains no cursor.
2. Five clicks 30 ms apart all recorded; right-click, scroll, and cursor shape (arrow / text / hand) recorded.
3. The drawn cursor lands within 2 px of the real click on the 4K / 150% display.
4. Audio and video in sync within 20 ms (fixture flashes and beeps together).
5. Kill the app mid-recording → reopen → everything up to the kill is recoverable.
6. A 30-minute 4K60 recording keeps memory flat.

### A5 — Auto-edit on stop
1. A 5-minute recording opens in the editor within 3 s, already edited, with a one-line summary ("7 zooms · 2 typing speed-ups · trimmed 4 s").
2. Auto items look different on the timeline, delete in one click, and "Back to raw" undoes the whole pass.
3. Exportable without opening a single panel.
4. Further features are specced one at a time before building (e.g. a "mark mistake" hotkey that cuts a flub automatically).

## Budgets

- Recording 4K60 doesn't make the recorded app stutter.
- Preview holds 60 fps; scrubbing shows the frame within 100 ms.
- Export ≥ 2× real time at 1080p60, ≥ 1× at 4K60.
- Editor opens within 3 s of Stop.

## Platform

Windows 11 only. Verified on the RTX 4080 PC (4K display at 150%). Other PCs: a one-command capability check will be added in A4. The MacBook does not record.
