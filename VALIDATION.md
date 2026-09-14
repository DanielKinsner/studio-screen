# Validation — 2026-09-14

## Verified in this workspace

| Check | Evidence / result |
|---|---|
| Production compilation | TypeScript check and Vite production build pass |
| Timeline tests | Trim/cut overlap mapping, speed mapping, eased zoom bounds, click-evidence focus generation, SRT parsing and malformed-range rejection pass |
| Browser editing | Edge automation exercised backgrounds, padding, manual zoom, annotation text, trim, playback and export; no page errors |
| Responsive layout | 1440×1000 and 390×844 inspected; no mobile horizontal overflow |
| Persistence | Edits survive page reload; self-contained recorded-media `.studio` project exports and reopens with trim preserved and playable media |
| Undo | Two consecutive edits undo independently under React StrictMode |
| Actual Windows capture | Controlled native window captured with system audio, pause/resume and editor handoff; no mocked capture API |
| Source recording | VP9 + Opus, 48 kHz stereo, approximately 3.86 seconds; finalized WebM decodes without FFmpeg errors |
| Internal-audio proof | Independent decode detects the generated 440 Hz tone in source and composed export; RMS difference below 0.1 dB in the latest repeat |
| Composed WebM export | 1280×720 VP9, Opus stereo 48 kHz, source duration retained, decoder-clean |
| MP4 export | H.264 + AAC stereo 48 kHz, 1280×720, 1.0044 seconds for a one-second trim |
| GIF export | 854×480 looping GIF, 1.05 seconds for a one-second trim; quantized 15 fps target |
| Custom-area capture | Native window crop recorded at 50% source width/height and exported with internal audio; separate native test passes |
| Font assets | Bundled in production output; no external font request required |
| Packaged desktop | Local assets load, native picker works, packaged Windows pointer helper emits coordinates, system audio defaults on and microphone defaults off |
| Final portable executable | Launched its extracted embedded application, selected its own window, recorded internal audio, and saved the result; `tests/portable-results.json` |

Raw receipts and captures are under `tests/` and ignored by git. Re-run scripts described in `README.md` to regenerate them. The audio receipt is `tests/audio-results.json`; UI/format receipts are `tests/browser-results.json`, `tests/export-results.json`; native capture receipts are `tests/native-results.json` and `tests/region-results.json`.

## Limits of this evidence

These results certify short controlled Windows/Edge workflows, not full Screen Studio/FocuSee parity. They do not certify sustained 4K/60 fps, long recordings, crash recovery, all hardware/audio drivers, every desktop display configuration, captured cursor suppression, mic input, camera, mobile devices, macOS/Linux or cloud features. Frame rates are requested targets and Chromium can deliver variable-rate video. Exports currently use foreground, real-time rendering.

Feature gaps and next engineering priorities are tracked in `FEATURE-PARITY.md`. Camera is deferred per the user's instruction, and microphone capture is lower priority and off by default.

## Windows artifact

- File: `release/Studio Screen 0.1.0.exe`
- Size: 128,259,833 bytes
- SHA-256: `0FC7F3B0C17FDE706E3F38FAD2838EAAFB6DEC16D39659787C51962FE63B4499`
- Authenticode: NotSigned; local development build, not a public release.
- Build: Electron 44.3.0, Windows x64 portable; bundled pointer helper explicitly unpacked from ASAR.
- Artifact receipt: `tests/build-results.json`. Portable launch and captured-media proof refer to this final artifact, after correcting short-path/native-frame authorization and helper placement.
