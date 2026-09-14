# Feature parity tracker

Reference review: 2026-09-14. Sources: [Screen Studio guide](https://screen.studio/guide/home), [Screen Studio zoom guide](https://preview.screen.studio/guide/adding-editing-zooms), [FocuSee features](https://focusee.imobie.com/). These products have different feature sets; the target is their combined workflow, with screen recording and PC audio prioritized by the user. No claim of complete parity is made.

| Capability | Studio Screen implementation | Remaining work / boundary |
|---|---|---|
| Display and window capture | Electron source picker; browser screen-sharing picker | Multi-display, DPI, GPU and long-session soak tests |
| Custom area capture | Pre-encode rectangular crop; preserves system audio | Interactive OS region overlay and pixel-coordinate entry |
| Internal PC audio | Windows WASAPI loopback via Chromium/Electron; stereo 48 kHz verified | Per-application isolation; device-change and unusual driver coverage |
| Pause/resume / stop shortcut | Implemented and exercised in native capture | OS recording toolbar outside main app |
| Local video import | MP4/WebM and other browser-decodable formats | Broader native decoder coverage |
| Automatic click focus | Windows display cursor/click samples create zooms | Window-coordinate tracking, robust native event hook, missed very short clicks |
| Manual zoom and focus | Editable start/end/scale/position; eased transitions | Spring controls, continuous follow and transition tuning |
| Cursor scale and click effects | Metadata overlay with configurable size/click rings | Removal of original cursor pixels, native cursor asset capture, cursor styles, hide-on-idle, click audio |
| Background and framing | Gradients, solid, imported image, padding, corners, shadow, aspect presets | Reusable style/preset library, device frames |
| Timeline editing | Trim, cut ranges, undo/redo, scrub, keyboard frame step | Split/reorder/multiple source clips, drag handles, speed segments, ripple tools |
| Playback speed | Global 0.5–4× | Automatic typing acceleration and idle/silence removal |
| 3D motion / motion blur | Open | Shared export-capable perspective and motion renderer |
| Annotations | Text, arrow, spotlight, solid privacy masks | True blur, richer shape styles, annotation dragging/keyframes |
| Captions | Manual captions, SRT/WebVTT import, burned-in export | Automatic speech transcription, translation, caption theme library |
| Keyboard overlays | Open | Recording-scoped shortcut metadata and renderer |
| Music / audio control | Source volume and imported looping music | Fades, ducking, independent mic/system stems and audio editing |
| Microphone | Optional, off by default; capture-time suppression | Lower priority; no microphone device validation performed |
| Camera and camera effects | Deferred by user | No camera UI exposed |
| Speaker notes | Editable in-app notes during capture | Auto-scrolling teleprompter and capture-excluded native overlay |
| Mobile/iOS capture | Open | Native device integration |
| MP4/WebM/GIF export | Real local composited output, PNG frames | Guaranteed CFR/hardware pipeline and deterministic frame/audio sync |
| 4K / 60 fps | Selectable encode targets | Sustained native performance and final file proof still required |
| Local projects | IndexedDB, library, embedded-media archive | Crash recovery, streaming to disk, archive compression and migrations |
| Web sharing / embeds | Open | User-approved hosting/integration provisioning, links, analytics, interactive content |

## Next engineering priorities

1. Disk-backed native capture with interruption recovery and 30/60 fps performance receipts.
2. Native cursor suppression, high-DPI display/window coordinate mapping, and consistent click metadata.
3. Deterministic export timing with per-segment speeds, frame-accurate cuts, and richer focus transitions.
4. Motion blur, 3D framing, keyboard overlays, reusable styles, and direct timeline manipulation.
5. Broaden OS/codec/device coverage; add other requested reference-product features after the core capture lane is reliable.
