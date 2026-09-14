# Studio Screen

A local-first screen recorder and video editor for Windows, with a browser editor. Inspired by the capture-to-polished-video workflows of Screen Studio and FocuSee. This is an independently built application, not affiliated with either product.

**Current priority: screen capture and internal PC audio. Camera is deferred; microphone is optional and off by default.**

## Run

```powershell
npm install
npm run desktop:dev
```

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

Output: `release/Studio Screen 0.1.0.exe`. It is a local development build, not a signed public release. No deployment or publication is performed.

## Workflow

1. Choose **New recording** and select a display or window. **System audio** is on by default. On Windows desktop this uses the PC's audio loopback, including audio from other applications. It is not restricted to the selected window's audio.
2. Optionally select a **Custom area**. Only the configured rectangle is stored in the recorded video. Percentages refer to the selected source. Browser users select the actual source in the browser's sharing dialog.
3. Record, pause/resume, then finish with the floating controls or **Ctrl+Shift+R** in the desktop app.
4. Style the canvas, add focus zooms, trim footage, remove ranges, change speed, add captions, annotations, or a music file.
5. Export WebM, supported MP4, or GIF. Save an editable `.studio` project with embedded media for transfer or backup. PNG frame export is also available.

The first project is a clearly labeled, procedurally animated sample. Its content and click events are examples, not footage captured from another product. Timeline thumbnails are generated from the actual source media.

## Implemented

- Native Windows display/window picker and internal stereo PC audio capture.
- Custom-area capture, 30/60 fps request, pause/resume, external share-stop handling, desktop stop shortcut.
- Local video import and decoding. MediaRecorder WebM duration metadata finalized without rewriting streaming clusters.
- Non-destructive trim, cut ranges, global playback speed from 0.5× to 4×, frame stepping, timeline zoom, undo/redo.
- Click-driven zooms on Windows display recordings, manually editable zoom timing and focus, eased zoom transitions.
- Display-relative pointer samples and click rings. Imported/window footage without coordinate metadata uses manual zooms.
- Eight background gradients, custom colors/images, padding, corners, shadow, crop enlargement, six aspect ratios.
- Timed text, arrows, spotlight, opaque redaction; manually authored captions and SRT/WebVTT text import.
- Source gain, looping imported music, optional microphone with browser noise suppression.
- One shared compositor for preview and export; MP4 when the installed browser exposes its encoder, WebM, GIF, PNG.
- IndexedDB autosave and project library; self-contained `.studio` import/export. Fonts are bundled locally.
- Keyboard shortcuts, labeled controls, dialog focus management, reduced-motion support, responsive editor.

## Parity status

This is a working initial build, **not full feature parity with either reference product**. See [FEATURE-PARITY.md](FEATURE-PARITY.md) for the implementation and remaining work. In particular:

- Full native cursor removal/replacement is not implemented. Captured source pixels may already include a cursor; the editable overlay cannot erase it. Window capture does not yet have global pointer-to-window coordinate mapping.
- True 3D perspective, motion blur, spring-based camera motion, per-segment speeds, keyboard shortcut visualization, and automatic typing/idle edits remain open.
- Native iPhone/iPad/mobile capture is not implemented. macOS/Linux native capture/audio behavior is not validated.
- Automated transcription, AI noise enhancement, silence/filler removal, cloud sharing/analytics, and interactive web embeds are not implemented. Camera is intentionally deferred.
- Video export runs in real time in the foreground. 4K/60 are selectable targets, not verified sustained-performance guarantees. Source frame delivery varies with motion and system load.
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
node tests/audio-proof.mjs
node tests/packaged-smoke.mjs
node tests/portable-launch.mjs
```

Browser tests currently use installed Microsoft Edge. Desktop tests create a controlled Electron window and play a quiet 440 Hz tone through Windows; they exercise actual desktop capture and audio loopback, not a mocked MediaRecorder. Test outputs stay under `tests/` and are ignored by git.

`audio-proof.mjs` uses `FFMPEG_PATH`, falling back to this machine's AutoPod FFmpeg installation. It independently decodes the source and exported audio, checks for the expected tone, and checks level preservation. See [VALIDATION.md](VALIDATION.md) for current evidence and its limits.

## Structure

- `src/App.tsx`: editor, recorder, and project workflows.
- `src/media.ts`: capture, playback, and video/GIF export.
- `src/compositor.ts`: shared canvas rendering.
- `src/timeline.ts`: pure cut mapping, zoom easing, and caption parsing.
- `src/storage.ts`: IndexedDB and portable projects.
- `src/webm.ts`: minimal streaming WebM duration finalization.
- `electron/`: sandboxed desktop bridge, source chooser, Windows cursor sampler.

The browser build can be hosted separately, but Windows loopback and global pointer metadata require the desktop build. Vercel is optional; its CLI is not installed in this workspace. If web deployment becomes useful, install it with `npm i -g vercel`.
