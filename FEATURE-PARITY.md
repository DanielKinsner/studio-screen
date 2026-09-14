# Feature parity tracker — v0.2

Reference review: 2026-09-14. The target is the combined screen-recording and editing workflow of Screen Studio and FocuSee, excluding camera and microphone capture. This application is independent and does not claim complete parity.

FocuSee's own [April 2026 update](https://focusee.imobie.com/news/focusee-2026-april-update.htm) places 3D Motion after the original 2.0 release. The current [3D guide](https://focusee.imobie.com/guide/3d-motion-effect.htm), [motion blur guide](https://focusee.imobie.com/guide/motion-blur.htm), [cursor guide](https://focusee.imobie.com/guide/cursor-effect.htm), [Screen Studio guide](https://screen.studio/guide/home), and [typing speed guide](https://preview.screen.studio/guide/speed-up-typing-segments) informed this update.

| Capability | Studio Screen v0.2 | Remaining boundary |
|---|---|---|
| Display/window capture | Windows source picker, browser sharing, pause/resume, stop shortcut | Long-session, GPU, device-change coverage |
| Custom region | Rectangle cropped before encoding, preserving internal audio | Native OS region overlay; pixel-entry controls |
| Internal PC audio | Windows whole-PC loopback; stereo 48 kHz verified | Per-application isolation and driver/device matrix |
| 3D zoom | Shared WebGL perspective renderer; manual X/Y/Z rotation, focus, offsets, FOV, four angle presets | Reference-product physical spring tuning and more presets |
| Automatic 3D | Click-generated focus; recorded-pointer-driven tilt and optional pan | Native event hooks and unusual window geometry |
| Motion blur | Three spatial samples of moving screen and cursor, used by preview and export | Adaptive/higher quality sampling; motion-cost optimization |
| Motion styles | Focused, smooth, gentle easing | Custom spring physics |
| Cursor effects | Dark/light/dot, scale, angle, smoothing, idle/timed hide, ring/pulse, synthesized click sound | Erasing the cursor baked into source pixels; native cursor assets |
| Metadata | Display and live DWM-window coordinates; clicks, Ctrl/Alt/Win combinations and function keys; typing activity booleans | Polling can miss short events; high-DPI/multi-monitor matrix |
| Shortcut overlays | Timed readable shortcut chips in preview/export; never stores plain typed text | Remapping/formatting UI; complete keyboard/layout coverage |
| Timeline | Drag/move/resize focus, caption, element and speed sections; trim, cuts, undo/redo, keyboard editing | Multiple sources, reorder/ripple editing, exact frame scheduling |
| Speed sections | 0.5–4× per-section overrides; typing activity generates 2× sections | Automatic silence/idle removal; overlap stacking (first section wins) |
| Canvas | Gradients, colors/images, padding, corners, shadow, crop, six ratios, browser title bar, watermark | Other device mockups and frame presets |
| Styles | Three looks; locally saved styles; import/export style files | Team/shared style libraries |
| Annotations | Text, arrow, spotlight, opaque redact, soft blur, box, ellipse, numbered step, color | Motion keyframes and dragging elements directly in preview |
| Captions | Manual/imported SRT/WebVTT; three themes, size/placement, burned-in export, edited-time SRT | Automatic transcription/translation and word highlighting |
| Music/audio | Source/music gain, looped imported track, fade-in/out over edited duration | Ducking, stems, waveform/audio editing, AI enhancement |
| Camera/microphone | Excluded by request; no recording controls or device requests | Deferred |
| Exports | MP4 where encoder is available, WebM, GIF, PNG; composited 3D included | Foreground real-time export; guaranteed CFR/hardware pipeline |
| 4K/60 fps | Selectable targets | Sustained performance not certified |
| Local projects | IndexedDB autosave, library, embedded archive; v1/v2 migration | Disk streaming, recovery, huge-file archive compression |
| Speaker notes | In-app notes during capture | Auto-scrolling/capture-excluded native teleprompter |
| Mobile/cloud | Not implemented | Native mobile devices, public share links, analytics/embeds |

Next priorities: disk-backed capture/recovery, native cursor suppression, deterministic export scheduling, and broader Windows display/driver testing. macOS/Linux behavior is not validated.
