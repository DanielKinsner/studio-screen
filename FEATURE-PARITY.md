# Feature parity tracker — Option A build

Reference review: 2026-09-14, against the current Screen Studio (macOS) and FocuSee (Windows/macOS) guides and changelogs. Target: their combined screen-recording and editing workflow for a personal Windows tool, excluding microphone and camera. Independent application; no claim of complete parity.

Legend: ✅ matches the reference behaviour · 🟡 partial · ❌ not built · ⛔ excluded on purpose.

## Signature features

| Capability | Screen Studio | FocuSee | Studio Screen | Notes / remaining |
|---|---|---|---|---|
| Clean cursor: hide, resize, restyle after recording | ✅ | ✅ | ✅ | Capture helper records without the cursor; drawn cursor follows recorded shape (arrow, text, hand). Custom app cursors draw as an arrow. |
| Auto-zoom on clicks | ✅ | ✅ | ✅ | Nearby clicks glide in one zoom; clicks on the recording bar or outside the area are ignored. |
| Spring camera and cursor feel | ✅ | ✅ | 🟡 | Snappy/Smooth/Floaty + move time/bounce; needs hand-tuning against the reference feel. |
| Motion blur | ✅ | ✅ | 🟡 | Three camera-motion samples; no per-pixel velocity blur. |
| 3D motion | — | ✅ | ✅ | Manual angles, presets, cursor-driven tilt. |
| Speed up typing automatically | ✅ | ✅ | ✅ | Applied on stop, marked automatic, rate editable. |
| Speed up idle/waiting time | — | 🟡 (silence) | ✅ | 3 s+ with no input and no real screen change → 4×; caret blinks ignored. |
| Auto trim start/end | — | — | ✅ | 0.5 s before first action; cuts the reach for Stop. |
| Recording hides the app, countdown | ✅ | ✅ | ✅ | Bar and countdown excluded from capture (verified by frame scan). |
| Teleprompter / notes invisible to capture | 🟡 | ✅ | ✅ | Notes panel in the floating bar. |
| Crash-safe recording | — | — | ✅ | Fragmented MP4 on disk; helper finishes the file if the app dies; recovery on launch. |
| Fast GPU export, MP4 always | ✅ | ✅ | ✅ | Frame-by-frame WebCodecs; 60 s 1080p60 in ~23 s on an RTX 4080. |
| Auto-zoom on typing | — | ✅ | ❌ | Candidate extra (spec first). |
| Mic, webcam, camera layouts | ✅ | ✅ | ⛔ | Excluded by decision. |
| Captions from speech | ✅ | ✅ | ❌ | Manual/SRT captions only. Needs on-device speech-to-text; no mic, so system audio only. |
| Noise reduction / voice enhance | ✅ | ✅ | ❌ | Not relevant without a mic. |
| Phone recording (iOS/Android) | ✅ | ✅ | ❌ | Out of scope. |
| Share links, comments, analytics | ✅ | ✅ | ❌ | Out of scope (personal tool). |

## Full inventory

| Capability | Studio Screen | Remaining boundary |
|---|---|---|
| Display/window/region capture | Rust helper (Windows Graphics Capture, no cursor, no yellow border), 10–60 fps, pause/resume, window-closed ends the take; browser-capture fallback | Displays wider than 4096 px untested; window resize pads/crops to the starting size |
| System audio | WASAPI loopback, same clock as video, silence filled | Per-application isolation |
| Input events | Low-level hooks: pointer (240 Hz), left/right clicks, wheel, shortcuts, typing activity (never key text), cursor shape; window recordings only log keys for that window | Drag gestures are not interpreted |
| Screen activity | Dirty regions per frame (Windows 11 24H2+) | Older Windows: idle speed-ups off |
| Zoom/camera | Precomputed spring path in edited time; identical scrub/play/export; follow cursor near view edges | Hand-tuning |
| Cursor | Spring smoothing that lands on clicks, sizes/styles/angle, idle/timed hide, click rings/pulses/sounds, recorded shapes, hidden outside the area | Custom cursor images |
| Timeline | Drag/move/resize zoom, caption, element and speed clips; trim, cuts, undo/redo; dashed automatic clips with one-click remove | Multiple source clips, ripple edits |
| Auto-edit | Trim, typing 2×, idle 4×, zooms, last look; Back to raw / Apply again | Extras such as a "mark mistake" hotkey (spec first) |
| Canvas | Gradients, colors/images, padding, corners, shadow, crop, six ratios, browser title bar, watermark | Device mockups |
| Styles | Three looks, saved styles, import/export, last look reused for new recordings | — |
| Annotations | Text, arrow, spotlight, redact, soft blur, box, ellipse, numbered step | Keyframed motion, drag in preview |
| Captions | Manual/SRT/WebVTT import, themes, burned-in export, edited-time SRT | Automatic transcription |
| Music/audio | Source/music gain, looped music, fades; pitch-preserving speed changes in export | Ducking, waveform editing |
| Export | MP4 (H.264/AAC), WebM (VP9/Opus), GIF, PNG frame; streamed to disk; cancel removes the file; Ctrl+E quick export | 4K60 sustained speed not measured |
| Projects | Folder per recording (video, events, meta, project.json) + IndexedDB library; `.studio` archives embed media; older projects migrate as legacy | Library doesn't delete folders |
| Interface | rem type scale (12 px minimum), AA+ contrast, Ctrl +/− interface zoom | — |
| Mobile/cloud | Not implemented | Out of scope |

macOS/Linux capture is not supported.
