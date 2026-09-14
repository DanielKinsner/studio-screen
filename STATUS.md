# Status — Studio Screen

**Last updated:** 2026-09-14

## Where things stand

Option A is built end to end: readability pass, A1 smooth camera and cursor, A2 recording gets out of the way, A3 frame-by-frame export, A4 Rust capture helper, A5 auto-edit on stop. Spec: [docs/SPEC.md](docs/SPEC.md). What was built: [docs/PLAN.md](docs/PLAN.md). Evidence: [VALIDATION.md](VALIDATION.md).

| Phase | Built | Automated checks |
|---|---|---|
| Readability | ✅ | Screenshots at 4K/150% and laptop size; no text overflow; browser tests pass |
| A1 camera & cursor | ✅ | Unit tests; 60 fps preview test; playback test |
| A2 recording UI | ✅ | Bar-exclusion frame scan with control run (browser capture); **re-run with the capture helper pending** |
| A3 export | ✅ | 60 s 1080p60 in 23 s, exact frames, pitch, cancel, minimized desktop export |
| A4 capture helper | ✅ | Helper smoke take on this PC; unit tests; **end-to-end test and soak pending** |
| A5 auto-edit | ✅ | Unit tests; browser UI check; **open-speed test pending** |

"Pending" tests record the screen or move the mouse, so they only run when the PC has been idle; they were held back while the PC was in use.

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

1. **Readability.** Text should be comfortably readable. Try **Ctrl + =** / **Ctrl + −** to size the whole interface; it's remembered next launch.
2. **Record.** **New recording** → pick your main display → leave **3-second countdown** on → **Start recording**. You should see: the editor disappears, a 3-2-1 in the middle of the screen, then a small bar at the bottom.
3. **During the take.** Click something top-left, then something bottom-right within a second. Type a few words somewhere. Press **Ctrl + K** (or any shortcut). Leave the mouse still for about 10 seconds. Open **speaker notes** (page icon) on the bar and close it again. Press **Pause**, wait, **Resume**.
4. **Finish** on the bar. Within a few seconds the editor is back with a message like "Auto-edit: 3 zooms · 1 typing speed-up · 1 idle speed-up · trimmed 2 s" and a **Back to raw** button.
5. **Check the rough cut.** Press **Space**:
   - The start skips the moment you clicked Record, and the end skips your reach for Finish.
   - There's **one** cursor, crisp, gliding, never doubled. It's an I-beam over text and a hand over links.
   - The camera zooms toward your first click and **glides** to the second without zooming out.
   - Typing plays at 2×, and the still stretch at 4×.
   - The bar, countdown and notes are **not** in the video.
6. **Timeline.** Automatic clips are **dashed**. Hover one and click its **×**: only that edit goes away. **Pacing → Back to raw** removes the whole automatic edit; **Apply automatic edit** brings it back. Click a speed clip and change its speed.
7. **Feel.** **Focus & 3D → Camera feel**: try Snappy and Floaty. Under **Camera spring**, try Bounce around 25%.
8. **Export.** **Export video** → MP4 · 1080p · 60 fps → **Export video**. Minimize the window while it renders; it keeps going. Click **Show in folder**, play the file, and check it matches the preview. Then press **Ctrl + E**: it exports again straight away with the same settings.
9. **Crash safety (optional).** Start a recording, then end task on **Studio Screen** in Task Manager. Relaunch with `npm run desktop:dev`. You should see "Recovered a recording that didn't finish", with the take open.
10. **Window recording.** Record a single app window. Close that app mid-take: the take ends and opens.

Tell me: which camera feel is right, whether the auto-trim ever cuts something you wanted, and anything that felt slow or confusing.

Recordings live in `Videos\Studio Screen\<date time>\`; exports in `Videos\Studio Screen\Exports\`.

## Next up

- Run the pending screen tests on an idle PC: `node tests/a2-recording-ui.mjs`, `node tests/a4-native-capture.mjs`, `node tests/a5-open-speed.mjs`, `node tests/a4-soak.mjs`.
- Tune camera feel from Dan's notes.
- Proposed extras (each needs a quick spec and a go): mark-a-mistake hotkey, auto-zoom on typing, device frames, captions from system audio, deleting recording folders from the library. See docs/PLAN.md.
