import type { Point, Project } from './types';
import { dimensions, renderFrame } from './compositor';
import { outputDuration, sourceTime } from './timeline';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { finalizeWebm } from './webm';
import type { Region } from './RegionPicker';
export function videoMime(format: string) {
  const options = format === 'mp4' ? ['video/mp4;codecs=avc1.42001f,mp4a.40.2', 'video/mp4'] : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return options.find(m => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));
}
export async function loadVideo(blob: Blob) {
  const v = document.createElement('video'); v.src = URL.createObjectURL(blob); v.playsInline = true; v.preload = 'auto';
  await new Promise<void>((resolve, reject) => { v.onloadeddata = () => resolve(); v.onerror = () => reject(new Error('This video format could not be decoded. Try MP4 or WebM.')); });
  return v;
}
export function releaseVideo(v?: HTMLVideoElement | null) { if (v) { v.pause(); URL.revokeObjectURL(v.src); v.removeAttribute('src'); v.load(); } }
export async function seek(v: HTMLVideoElement, t: number) {
  if (Math.abs(v.currentTime - t) < .005 && v.readyState >= 2) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Video seeking timed out.')); }, 12000);
    const done = () => { cleanup(); resolve(); }; const cleanup = () => { clearTimeout(timeout); v.removeEventListener('seeked', done); };
    v.addEventListener('seeked', done); v.currentTime = t;
  });
}
export async function getDuration(v: HTMLVideoElement) {
  if (Number.isFinite(v.duration)) return v.duration;
  await seek(v, 1e10); const duration = v.currentTime; await seek(v, 0); return duration;
}
export type CaptureOptions = { mic: boolean; camera: boolean; system: boolean; denoise: boolean; fps: number; region?: Region };
export async function capture(options: CaptureOptions) {
  const streams: MediaStream[] = []; let context: AudioContext | undefined; let unsubscribe: (() => void) | undefined; let cropTimer: ReturnType<typeof setInterval> | undefined; let cropVideo: HTMLVideoElement | undefined;
  const cleanup = () => { unsubscribe?.(); void window.studioDesktop?.track(false); clearInterval(cropTimer); if (cropVideo) { cropVideo.pause(); cropVideo.srcObject = null; } streams.forEach(s => s.getTracks().forEach(t => t.stop())); void context?.close(); };
  try {
    const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: options.fps }, audio: options.system }); streams.push(display);
    if (display.getVideoTracks()[0].readyState === 'ended') throw new Error('Screen sharing ended before recording started.');
    let voice: MediaStream | undefined, camera: MediaStream | undefined;
    if (options.mic || options.camera) {
      const devices = await navigator.mediaDevices.getUserMedia({ audio: options.mic ? { echoCancellation: options.denoise, noiseSuppression: options.denoise, autoGainControl: options.denoise } : false, video: options.camera ? { width: 1280, height: 720 } : false }); streams.push(devices);
      if (options.mic) voice = new MediaStream(devices.getAudioTracks()); if (options.camera) camera = new MediaStream(devices.getVideoTracks());
    }
    let recordedVideoTracks = display.getVideoTracks();
    if (options.region) {
      const region = options.region; cropVideo = document.createElement('video'); cropVideo.muted = true; cropVideo.srcObject = display; await cropVideo.play();
      const output = document.createElement('canvas'); output.width = Math.max(2, Math.round(cropVideo.videoWidth * region.width / 2) * 2); output.height = Math.max(2, Math.round(cropVideo.videoHeight * region.height / 2) * 2); const ctx = output.getContext('2d')!;
      const paint = () => ctx.drawImage(cropVideo!, cropVideo!.videoWidth * region.x, cropVideo!.videoHeight * region.y, cropVideo!.videoWidth * region.width, cropVideo!.videoHeight * region.height, 0, 0, output.width, output.height);
      paint(); cropTimer = setInterval(paint, 1000 / options.fps); const cropped = output.captureStream(options.fps); streams.push(cropped); recordedVideoTracks = cropped.getVideoTracks();
    }
    const mixed = new MediaStream(recordedVideoTracks);
    const audioInputs = [display, voice].filter((s): s is MediaStream => !!s && s.getAudioTracks().length > 0);
    if (audioInputs.length) { context = new AudioContext(); await context.resume(); const dest = context.createMediaStreamDestination(); audioInputs.forEach(s => context!.createMediaStreamSource(s).connect(dest)); dest.stream.getAudioTracks().forEach(t => mixed.addTrack(t)); }
    const mimeType = videoMime('webm'); if (!mimeType) throw new Error('Recording is not supported in this browser. Open Studio Screen in Chrome or Edge.');
    const record = new MediaRecorder(mixed, { mimeType, videoBitsPerSecond: 16000000 }); const cameraRecord = camera ? new MediaRecorder(camera, { mimeType, videoBitsPerSecond: 4000000 }) : undefined;
    const chunks: Blob[] = [], cameraChunks: Blob[] = []; const points: Point[] = [];
    record.ondataavailable = e => { if (e.data.size) chunks.push(e.data); }; if (cameraRecord) cameraRecord.ondataavailable = e => { if (e.data.size) cameraChunks.push(e.data); };
    let started = performance.now(), pausedAt = 0, paused = 0, stopping = false;
    const elapsed = () => ((pausedAt || performance.now()) - started - paused) / 1000;
    if (window.studioDesktop) { unsubscribe = window.studioDesktop.onPoint(pt => { if (pausedAt || stopping) return; const r = options.region; const x = r ? (pt.x - r.x) / r.width : pt.x, y = r ? (pt.y - r.y) / r.height : pt.y; if (x >= 0 && x <= 1 && y >= 0 && y <= 1) points.push({ ...pt, x, y, t: elapsed() }); }); await window.studioDesktop.track(true); }
    let endResolve: (v: { video: Blob; camera?: Blob; duration: number; points: Point[]; hasSystemAudio: boolean }) => void;
    let endReject: (e: Error) => void;
    const done = new Promise<{ video: Blob; camera?: Blob; duration: number; points: Point[]; hasSystemAudio: boolean }>((res, rej) => { endResolve = res; endReject = rej; });
    let duration = 0;
    record.onerror = () => { cleanup(); endReject(new Error('Recording failed. Check available memory and try a shorter recording.')); };
    const cameraDone = new Promise<void>(resolve => { if (cameraRecord) cameraRecord.onstop = () => resolve(); else resolve(); });
    record.onstop = async () => { await cameraDone; cleanup(); try { const fixed = await finalizeWebm(new Blob(chunks, { type: mimeType }), duration * 1000); endResolve({ video: fixed, camera: camera ? await finalizeWebm(new Blob(cameraChunks, { type: mimeType }), duration * 1000) : undefined, duration, points, hasSystemAudio: display.getAudioTracks().length > 0 }); } catch { endReject(new Error('Could not finalize the recording.')); } };
    const stop = () => { if (stopping) return; stopping = true; duration = elapsed(); if (cameraRecord?.state !== 'inactive') cameraRecord?.stop(); if (record.state !== 'inactive') record.stop(); };
    display.getVideoTracks()[0].onended = stop;
    started = performance.now(); record.start(1000); cameraRecord?.start(1000);
    return { done, stop, elapsed, pause: () => { if (record.state === 'recording') { pausedAt = performance.now(); record.pause(); cameraRecord?.pause(); } }, resume: () => { if (record.state === 'paused') { paused += performance.now() - pausedAt; pausedAt = 0; record.resume(); cameraRecord?.resume(); } } };
  } catch (e) { cleanup(); throw e; }
}
export async function exportVideo(p: Project, options: { format: string; height: number; fps: number; signal: AbortSignal; progress: (v: number) => void }) {
  const duration = outputDuration(p); if (duration <= .05) throw new Error('Keep at least one frame in the timeline to export.');
  const canvas = document.createElement('canvas'); Object.assign(canvas, dimensions(p.settings.aspect, options.height));
  let video: HTMLVideoElement | undefined, camera: HTMLVideoElement | undefined, music: HTMLVideoElement | undefined, background: HTMLImageElement | undefined, context: AudioContext | undefined, stream: MediaStream | undefined, recorder: MediaRecorder | undefined;
  const abort = () => { if (options.signal.aborted) throw new DOMException('Export cancelled', 'AbortError'); };
  try {
    if (p.video) video = await loadVideo(p.video); if (p.camera) camera = await loadVideo(p.camera); if (p.music) music = await loadVideo(p.music);
    if (p.backgroundImage) { background = new Image(); background.src = URL.createObjectURL(p.backgroundImage); await background.decode(); }
    abort();
    if (options.format === 'gif') {
      const gif = GIFEncoder(); const frames = Math.ceil(duration * options.fps);
      for (let i = 0; i < frames; i++) {
        abort(); const t = sourceTime(p, i / options.fps);
        if (video) await seek(video, t); if (camera) await seek(camera, Math.min(t, camera.duration - .001));
        renderFrame(canvas, p, t, { video, camera, background });
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data; const palette = quantize(data, 256); const indices = applyPalette(data, palette);
        gif.writeFrame(indices, canvas.width, canvas.height, { palette, delay: 1000 / options.fps, repeat: 0 }); options.progress((i + 1) / frames); await new Promise(r => setTimeout(r, 0));
      }
      gif.finish(); return new Blob([new Uint8Array(gif.bytes())], { type: 'image/gif' });
    }
    const mimeType = videoMime(options.format); if (!mimeType) throw new Error(`${options.format.toUpperCase()} encoding is not available in this browser. Choose WebM.`);
    for (const v of [video, camera]) if (v) { await seek(v, p.trimStart); v.playbackRate = p.settings.speed; }
    context = new AudioContext(); await context.resume(); const destination = context.createMediaStreamDestination();
    if (video) { const gain = context.createGain(); gain.gain.value = p.settings.volume / 100; context.createMediaElementSource(video).connect(gain).connect(destination); }
    if (music) { music.loop = true; const gain = context.createGain(); gain.gain.value = p.settings.musicVolume / 100; context.createMediaElementSource(music).connect(gain).connect(destination); }
    if (camera) camera.muted = true;
    renderFrame(canvas, p, p.trimStart, { video, camera, background }); stream = canvas.captureStream(options.fps);
    if (video || music) destination.stream.getAudioTracks().forEach(t => stream!.addTrack(t));
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: options.height >= 2160 ? 32000000 : 10000000 }); const chunks: Blob[] = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<Blob>((resolve, reject) => { recorder!.onstop = () => resolve(new Blob(chunks, { type: mimeType })); recorder!.onerror = () => reject(new Error('Video encoding failed. Try a lower resolution.')); });
    recorder.start(1000); await Promise.all([video?.play(), camera?.play(), music?.play()]); const start = performance.now();
    while (true) {
      abort(); const elapsed = (performance.now() - start) / 1000; if (elapsed >= duration) break;
      const t = sourceTime(p, elapsed);
      for (const v of [video, camera]) if (v && Math.abs(v.currentTime - t) > .2) await seek(v, t);
      renderFrame(canvas, p, t, { video, camera, background }); options.progress(elapsed / duration);
      await new Promise(r => setTimeout(r, 1000 / options.fps));
    }
    recorder.stop(); const result = await done; options.progress(1); return options.format === 'webm' ? await finalizeWebm(result, duration * 1000) : result;
  } finally {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream?.getTracks().forEach(t => t.stop()); releaseVideo(video); releaseVideo(camera); releaseVideo(music); if (background) URL.revokeObjectURL(background.src); await context?.close();
  }
}
