# Studio Screen

A local-first screen recorder and video editor for Windows, with a browser editor. Inspired by the capture-to-polished-video workflows of Screen Studio and FocuSee. This is an independently built application, not affiliated with either product.

**Current priority: screen capture and internal PC audio. Camera and microphone capture are intentionally excluded.**

## Run

```powershell
npm install
npm run desktop:dev
```

The desktop window opens maximized on the monitor containing the pointer, respecting Windows DPI scaling. The preview uses physical display pixels up to 4K; fullscreen landscape preview fills a 3840×2160 display without padding. Restoring/resizing the window or changing monitors updates preview resolution automatically.

The browser editor is also available with `npm run dev` at `http://127.0.0.1:5173`. For a desktop build without the development server:

```powershell
npm run build
npm run desktop
```

Build a portable Windows executable:

```powershell
npm run desktop:pack
```

On Windows machines where antivirus temporarily prevents Electron's downloaded directory from being renamed, use the already installed distribution:

```powershell
$env:ELECTRON_BUILDER_COMPRESSION_LEVEL='3'
npm run desktop:pack -- --config.electronDist=node_modules/electron/dist
```

Output: `release/Studio Screen 0.2.1.exe`. It is a local development build, not a signed public release. No deployment or publication is performed.

## Workflow

1. Choose **New recording** and select a display or window. **System audio** is on by default. On Windows desktop this uses the PC's audio loopback, including audio from other applications. It is not restricted to the selected window's audio.
2. Optionally select a **Custom area**. Only the configured rectangle is stored in the recorded video. Percentages refer to the selected source. Browser users select the actual source in the browser's sharing dialog.
3. Record, pause/resume, then finish with the floating controls or **Ctrl+Shift+R** in the desktop app.
4. Clicks become zooms automatically: clicks close together share one zoom that glides between them, and the camera follows the cursor when it nears the edge of the view. Open **Focus & 3D** to pick a **Camera feel** (Snappy, Smooth, Floaty; move time and bounce under **Camera spring**), or choose **Add 3D zoom** and try Left, Right, Overhead, or Hero. Adjust tilt, rotation, perspective, position, and magnification.
5. Drag timeline clips to move them; drag their edges to resize. **Pacing** adds speed sections or finds typing activity. **Remove 1s** removes a range; the Pacing panel restores it. Arrow keys move a selected clip; Alt+arrows resize its end.
6. Use **Canvas** for framing, browser chrome, watermark, and reusable looks; **Cursor** for smoothing, styles, click sounds, idle hiding, and shortcut overlays; **Captions** and **Annotate** for explanatory overlays.
7. Export WebM, supported MP4, or GIF. Save an editable `.studio` project with embedded media for transfer or backup. PNG frame export is also available.

The first project is a clearly labeled, procedurally animated sample. Its content and click events are examples, not footage captured from another product. Timeline thumbnails are generated from the actual source media.

## Implemented

- Native Windows display/window picker and internal stereo PC audio capture.
- Custom-area capture, 30/60 fps request, pause/resume, external share-stop handling, desktop stop shortcut.
- Local video import and decoding. MediaRecorder WebM duration metadata finalized without rewriting streaming clusters.
- Non-destructive trim, cut ranges, global playback speed from 0.5× to 4×, frame stepping, timeline zoom, undo/redo.
- Click-driven focus on Windows display and window recordings: nearby clicks are grouped into one zoom with focus keyframes, rapid or already-centred clicks don't jolt the camera, and manual zooms under a second apart stay zoomed. Manual and automatic 3D zoom with X/Y tilt, Z rotation, field of view, offsets, focus, and angle presets.
- Spring-driven camera (zoom, pan, and 3D tilt) precomputed once per edit in output time, so scrubbing and playback show identical frames and speed sections don't change the camera's pace. Snappy/Smooth/Floaty presets plus move time and bounce. Edge-triggered cursor following. Exportable perspective and sampled spatial motion blur.
- Spring-smoothed pointer path that lands exactly on every click, dark/light/dot styles, rotation, size, idle hiding, timed hiding, click rings/pulses, and synthesized click sounds.
- Captured Ctrl/Alt/Win + letter/number and function-key shortcut overlays. Typing metadata stores activity booleans, never plain typed text. Window key activity is restricted to the foreground capture window.
- Global speed plus per-section 0.5–4× speed overrides; typing activity can generate 2× sections. Preview, export, duration display, and SRT timing share the same edited timeline mapping.
- Draggable/resizable focus, caption, element, and speed clips, including keyboard movement and resize controls.
- Eight background gradients, custom colors/images, padding, corners, shadow, crop enlargement, six aspect ratios, browser title bar, and text watermark.
- Three built-in looks, local saved styles, and `.studio-style` import/export.
- Timed text, arrows, spotlight, opaque redaction, soft blur, rectangles, ellipses, and numbered steps with color controls.
- Manual captions and SRT/WebVTT import; caption themes, placement, size, burned-in export, and edited SRT download.
- Internal-audio volume, imported looping music, source/music fades following the final edited duration.
- One shared compositor for preview and export; MP4 when the installed browser exposes its encoder, WebM, GIF, PNG.
- IndexedDB autosave and project library; self-contained `.studio` import/export. Fonts are bundled locally.
- Keyboard shortcuts, labeled controls, dialog focus management, reduced-motion support, responsive editor.

## Parity status

This is a working v0.2 build, **not full feature parity with either reference product**. See [FEATURE-PARITY.md](FEATURE-PARITY.md) for the implementation and remaining work. In particular:

- Full native cursor removal/replacement is not implemented. Captured source pixels may already include a cursor; the editable overlay cannot erase it. Window metadata uses live DWM frame bounds; unusual border/DPI configurations still need broader coverage.
- Native cursor suppression, configurable physical springs, multiple source clips/reordering, automatic idle/silence removal, and disk-backed crash recovery remain open.
- Native iPhone/iPad/mobile capture is not implemented. macOS/Linux native capture/audio behavior is not validated.
- Automated transcription, AI noise enhancement, silence/filler removal, cloud sharing/analytics, and interactive web embeds are not implemented. Camera and microphone capture are intentionally excluded.
- Video export runs in real time in the foreground (frame-by-frame export is phase A3 in [docs/PLAN.md](docs/PLAN.md)). 4K/60 are selectable targets, not verified sustained-performance guarantees. Source frame delivery varies with motion and system load.
- Recordings/export buffers currently live in memory until saved. Long sessions, crash recovery, disk streaming, precise frame scheduling, high-DPI multi-monitor cursor alignment, and large project archives need further engineering and soak tests.

## Validation

```powershell
npm run test
npm run build
# Start npm run dev in another terminal first:
node tests/browser-smoke.mjs
node tests/desktop-capture.mjs
node tests/desktop-capture.mjs --region
node tests/export-formats.mjs
node tests/v2-proof.mjs
node tests/v2-visual.mjs
node tests/v2-audio.mjs
node tests/audio-proof.mjs
node tests/hidpi-window.mjs
node tests/a1-playback.mjs
node tests/a1-preview-perf.mjs
node tests/packaged-smoke.mjs
node tests/portable-launch.mjs
```

Browser tests currently use installed Microsoft Edge. Desktop tests create a controlled Electron window and play a quiet 440 Hz tone through Windows; they exercise actual desktop capture and audio loopback, not a mocked MediaRecorder. The native test briefly activates its own fixture and sends controlled mouse/key input to verify metadata. Run it while the desktop is idle. Test outputs stay under `tests/` and are ignored by git. Run native and format tests sequentially because they share the captured fixture file.

`audio-proof.mjs` uses `FFMPEG_PATH`, falling back to this machine's AutoPod FFmpeg installation. It independently decodes the source and exported audio, checks for the expected tone, and checks level preservation. See [VALIDATION.md](VALIDATION.md) for current evidence and its limits.

## Structure

- `src/App.tsx`: editor, recorder, and project workflows.
- `src/media.ts`: capture, playback, and video/GIF export.
- `src/compositor.ts`, `src/perspective.ts`: shared canvas/WebGL rendering.
- `src/camera.ts`, `src/cursorPath.ts`, `src/spring.ts`: precomputed spring camera and cursor paths (`src/motion.ts` re-exports them).
- `src/MotionPanel.tsx`, `src/EditorPanels.tsx`, `src/TimelineClip.tsx`: focus controls, editor panels, and direct timeline editing.
- `src/timeline.ts`: pure cut/speed mapping, automatic zoom grouping, typing detection, and caption parsing.
- `src/storage.ts`: IndexedDB and portable projects.
- `src/webm.ts`: minimal streaming WebM duration finalization.
- `electron/`: sandboxed desktop bridge, source chooser, Windows cursor sampler.

The browser build can be hosted separately, but Windows loopback and global pointer metadata require the desktop build. 3D needs WebGL graphics acceleration. Video exports run in the foreground; motion blur increases rendering cost.
