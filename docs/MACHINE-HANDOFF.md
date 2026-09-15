# Move Studio Screen to another Windows machine

Updated 2026-09-15 after the 0.4.0 hand-test fix run on Daniel Kinsner's office PC. Everything is on `main`. Read [STATUS.md](../STATUS.md) first for the current stopping point and the 0.4.0 hand test, then [VALIDATION.md](../VALIDATION.md) (section "0.4.0") for measured evidence and [the run log](plans/2026-09-15-hand-test-fixes-run-log.md) for every decision. Nothing is pending in a private branch.

## Resume here

**Version 0.4.0.** 115 JavaScript unit tests in 16 files pass, plus the production build, browser smoke, A1 playback, the new browser tests (`editor-interactions`, `scrub-frames`, `3d-fit`, `timeline-resize`, `cutting`, `focus-dot`), the new desktop tests (`export-location`, `alt-tilt`), A2, A5 and the packaged smoke test on the 0.4.0 portable. A3's correctness passes on every run; its 30 s speed budget is load-sensitive on a busy PC.

**Next is Dan's hand test of 0.4.0 (steps in STATUS.md).** The portable EXE exists only on the office PC; on another machine rebuild it with `npm run desktop:pack`. Open items: the capture helper's own sync test measured sound ~57 ms late on 2026-09-15 (−5 ms the day before, no helper changes; do not add an offset), and exporting a browser-captured WebM shows only its first second (found by the repaired `tests/desktop-capture.mjs`; cause in STATUS.md heads-up 4). The separate 30-minute/4K soak and timed 4K60 export remain unverified. Do not treat this machine's measurements as destination-hardware proof.

## Get the complete source

The private repository is https://github.com/DanielKinsner/studio-screen. Sign in with a GitHub account that has access.

```powershell
git clone https://github.com/DanielKinsner/studio-screen.git
Set-Location studio-screen
git switch main
git pull --ff-only origin main
```

For an existing checkout, first check `git status` and preserve any local changes. Then switch to `main` and pull with `--ff-only`. Do not reset or clean an existing checkout to follow this guide.

All app code, Electron code, Rust helper sources, `Cargo.lock`, `package-lock.json`, assets, specs, plans, test scripts, and status/evidence documents are committed. No extra source branches or stashes were present during the handoff audit.

## Requirements and launch

- Windows x64. Windows 11 24H2 is needed for the helper's screen-change/idle tracking. Run the capability check on the destination hardware.
- Node.js and npm. This checkout was checked with Node 24.15.0 and npm 11.6.2.
- Rust with the Windows MSVC toolchain, Visual Studio C++ build tools and the Windows SDK. This machine used Rust/Cargo 1.98.0, `stable-x86_64-pc-windows-msvc`.
- Internet access for npm/Cargo dependencies on the first build. Both dependency lockfiles are included.

```powershell
npm ci
npm test
npm run build
cargo build --release --locked --manifest-path native/studio-capture/Cargo.toml
npm run native:check
npm run desktop
```

The native capability command prints individual checks; inspect each result, not just its exit code. If the helper is unavailable, capture can fall back to browser capture, which has different cursor behavior.

For active development after setup:

```powershell
npm run desktop:dev
```

Build a portable executable on the destination with `npm run desktop:pack`. If Electron download/extraction causes Windows rename trouble, the existing installed Electron distribution can be used:

```powershell
$env:ELECTRON_BUILDER_COMPRESSION_LEVEL = '3'
npm run desktop:pack -- --config.electronDist=node_modules/electron/dist
```

The current package version is **0.4.0**; the app's footer reads it from `package.json` at build time. The office PC's `release/Studio Screen 0.4.0.exe` is 129,972,345 bytes, SHA-256 `37CD371FA2A829A669DDDD3E0D256984347591F846BCD03215E99664E8731212`. Check it with `node tests/packaged-smoke.mjs --portable` (uses a throwaway profile). Do not identify an old executable solely by its filename; source and the current status document take precedence over old artifact receipts.

## What Git does not transfer

| Local content | How to bring it across |
|---|---|
| `node_modules/`, `dist/`, native `target/` | Recreate using the commands above. |
| `release/` executables | Copy a specifically identified artifact separately, or rebuild from current source. Not uploaded to Git. |
| Recordings and final exports | Copy the `Studio Screen` folder under the Windows Videos known folder. Native takes include `recording.mp4`, `events.jsonl`, `meta.json`, and `project.json`. Custom `STUDIO_PROJECTS_DIR` / `STUDIO_EXPORT_DIR` settings override this location. |
| Editable projects | Prefer **Save project** to create self-contained `.studio` files, then import those on the other machine. This embeds media and removes the old machine's recording folder/video URL. Merely copying a library database can retain absolute paths. |
| Desktop app preferences/library | Normally `%APPDATA%\studio-screen`; `STUDIO_USER_DATA` can override it. Preserve a backup with the app closed. A profile copy alone is not a substitute for the recording files or `.studio` exports. |
| Browser editor projects/styles | Stored in the browser's site storage; they do not follow the Git checkout. Export projects and custom styles from the browser editor. |
| Generated test evidence/fixtures | Ignored `tests/*-results.json`, videos, screenshots and `tests/.*` folders. The scripts recreate them; evidence summaries are tracked in `VALIDATION.md`. |

On the audited machine, the standard Videos path is `C:\Users\SM - Dan\Videos`; its `Studio Screen` subfolder was absent at audit time. The desktop profile exists at `C:\Users\SM - Dan\AppData\Roaming\studio-screen`. This does not rule out projects in browser storage, the desktop profile, custom folders, or imported external files. No personal media/profile files were uploaded to GitHub.

## Tests and the paused work

Read `STATUS.md` first, then `docs/SPEC.md`, `docs/PLAN.md`, and the later sections of `VALIDATION.md`. Older validation sections describe earlier versions, not the current implementation.

The current evidence is summarized at the top of this guide and in STATUS.md. Earlier 61- and 65-test notes in historical documents are superseded by the 115 JavaScript tests of 0.4.0. Vite's existing large-bundle warning remains.

Browser tests use installed Microsoft Edge. Some media tests also need FFmpeg and ffprobe; configure your installation instead of relying on this PC's AutoPod path:

```powershell
$env:FFMPEG_PATH = (Get-Command ffmpeg.exe -ErrorAction Stop).Source
$env:FFPROBE_PATH = (Get-Command ffprobe.exe -ErrorAction Stop).Source
```

Native recording tests move the pointer and send controlled keys. Run them only with the PC idle, in the order described in `STATUS.md`. `tests/export-formats.mjs` requires the fixture generated by `tests/desktop-capture.mjs`.

## Offline source fallback

An older optional `studio-screen-main.bundle` may exist locally under `release/`; it is not refreshed by this handoff and may omit the latest fixes. Prefer cloning/pulling GitHub main. If using an older bundle, fetch and fast-forward main before building. It contains the committed main history and this guide, but not dependencies, generated builds, recordings, or app profiles. Copy it to the other machine, then:

```powershell
git clone -b main .\studio-screen-main.bundle studio-screen
Set-Location studio-screen
git remote set-url origin https://github.com/DanielKinsner/studio-screen.git
git fetch origin
```

Use the setup commands above afterward. The GitHub clone remains the simplest way to get the current source.
