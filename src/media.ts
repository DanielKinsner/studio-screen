import type { Point } from "./types";
import { finalizeWebm } from "./webm";
import type { Region } from "./RegionPicker";
export function videoMime(format: string) {
  const options =
    format === "mp4"
      ? ["video/mp4;codecs=avc1.42001f,mp4a.40.2", "video/mp4"]
      : [
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm",
        ];
  return options.find(
    (m) =>
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m),
  );
}
export async function loadVideo(source: Blob | string) {
  const v = document.createElement("video");
  if (typeof source === "string") {
    // Recordings on disk: CORS keeps canvases untainted for 3D and export.
    v.crossOrigin = "anonymous";
    v.src = source;
  } else v.src = URL.createObjectURL(source);
  v.playsInline = true;
  v.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    v.onloadeddata = () => resolve();
    v.onerror = () =>
      reject(
        new Error("This video format could not be decoded. Try MP4 or WebM."),
      );
  });
  return v;
}
export function releaseVideo(v?: HTMLVideoElement | null) {
  if (v) {
    v.pause();
    if (v.src.startsWith("blob:")) URL.revokeObjectURL(v.src);
    v.removeAttribute("src");
    v.load();
  }
}
export async function seek(v: HTMLVideoElement, t: number) {
  if (Math.abs(v.currentTime - t) < 0.005 && v.readyState >= 2) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Video seeking timed out."));
    }, 12000);
    const done = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timeout);
      v.removeEventListener("seeked", done);
    };
    v.addEventListener("seeked", done);
    v.currentTime = t;
  });
}
export async function getDuration(v: HTMLVideoElement) {
  if (Number.isFinite(v.duration)) return v.duration;
  await seek(v, 1e10);
  const duration = v.currentTime;
  await seek(v, 0);
  return duration;
}
export type CaptureOptions = {
  system: boolean;
  fps: number;
  region?: Region;
  /** Runs once the screen stream is live, before anything is recorded. */
  beforeStart?: () => Promise<void>;
};
export async function capture(options: CaptureOptions) {
  const streams: MediaStream[] = [];
  let context: AudioContext | undefined;
  let unsubscribe: (() => void) | undefined;
  let cropTimer: ReturnType<typeof setInterval> | undefined;
  let cropVideo: HTMLVideoElement | undefined;
  const cleanup = () => {
    unsubscribe?.();
    void window.studioDesktop?.track(false);
    clearInterval(cropTimer);
    if (cropVideo) {
      cropVideo.pause();
      cropVideo.srcObject = null;
    }
    streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    void context?.close();
  };
  try {
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: options.fps },
      audio: options.system,
    });
    streams.push(display);
    if (display.getVideoTracks()[0].readyState === "ended")
      throw new Error("Screen sharing ended before recording started.");
    let recordedVideoTracks = display.getVideoTracks();
    if (options.region) {
      const region = options.region;
      cropVideo = document.createElement("video");
      cropVideo.muted = true;
      cropVideo.srcObject = display;
      await cropVideo.play();
      const output = document.createElement("canvas");
      output.width = Math.max(
        2,
        Math.round((cropVideo.videoWidth * region.width) / 2) * 2,
      );
      output.height = Math.max(
        2,
        Math.round((cropVideo.videoHeight * region.height) / 2) * 2,
      );
      const ctx = output.getContext("2d")!;
      const paint = () =>
        ctx.drawImage(
          cropVideo!,
          cropVideo!.videoWidth * region.x,
          cropVideo!.videoHeight * region.y,
          cropVideo!.videoWidth * region.width,
          cropVideo!.videoHeight * region.height,
          0,
          0,
          output.width,
          output.height,
        );
      paint();
      cropTimer = setInterval(paint, 1000 / options.fps);
      const cropped = output.captureStream(options.fps);
      streams.push(cropped);
      recordedVideoTracks = cropped.getVideoTracks();
    }
    const mixed = new MediaStream(recordedVideoTracks);
    const audioInputs = [display].filter(
      (s): s is MediaStream => !!s && s.getAudioTracks().length > 0,
    );
    if (audioInputs.length) {
      context = new AudioContext();
      await context.resume();
      const dest = context.createMediaStreamDestination();
      audioInputs.forEach((s) =>
        context!.createMediaStreamSource(s).connect(dest),
      );
      dest.stream.getAudioTracks().forEach((t) => mixed.addTrack(t));
    }
    const mimeType = videoMime("webm");
    if (!mimeType)
      throw new Error(
        "Recording is not supported in this browser. Open Cool Story in Chrome or Edge.",
      );
    const record = new MediaRecorder(mixed, {
      mimeType,
      videoBitsPerSecond: 16000000,
    });
    const chunks: Blob[] = [];
    const points: Point[] = [];
    record.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    let started = performance.now(),
      pausedAt = 0,
      paused = 0,
      stopping = false,
      live = false;
    const elapsed = () =>
      ((pausedAt || performance.now()) - started - paused) / 1000;
    if (window.studioDesktop) {
      unsubscribe = window.studioDesktop.onPoint((pt) => {
        if (!live || pausedAt || stopping) return;
        const r = options.region;
        const x = r ? (pt.x - r.x) / r.width : pt.x,
          y = r ? (pt.y - r.y) / r.height : pt.y;
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1)
          points.push({ ...pt, x, y, t: elapsed() });
      });
      await window.studioDesktop.track(true);
    }
    let endResolve: (v: {
      video: Blob;
      duration: number;
      points: Point[];
      hasSystemAudio: boolean;
    }) => void;
    let endReject: (e: Error) => void;
    const done = new Promise<{
      video: Blob;
      duration: number;
      points: Point[];
      hasSystemAudio: boolean;
    }>((res, rej) => {
      endResolve = res;
      endReject = rej;
    });
    let duration = 0;
    record.onerror = () => {
      cleanup();
      endReject(
        new Error(
          "Recording failed. Check available memory and try a shorter recording.",
        ),
      );
    };
    record.onstop = async () => {
      cleanup();
      try {
        const fixed = await finalizeWebm(
          new Blob(chunks, { type: mimeType }),
          duration * 1000,
        );
        endResolve({
          video: fixed,
          duration,
          points,
          hasSystemAudio: display.getAudioTracks().length > 0,
        });
      } catch {
        endReject(new Error("Could not finalize the recording."));
      }
    };
    const stop = () => {
      if (stopping) return;
      stopping = true;
      duration = elapsed();
      if (record.state !== "inactive") record.stop();
    };
    display.getVideoTracks()[0].onended = stop;
    await options.beforeStart?.();
    if (display.getVideoTracks()[0].readyState === "ended")
      throw new Error("Screen sharing ended before recording started.");
    started = performance.now();
    live = true;
    record.start(1000);
    return {
      done,
      stop,
      elapsed,
      pause: () => {
        if (record.state === "recording") {
          pausedAt = performance.now();
          record.pause();
        }
      },
      resume: () => {
        if (record.state === "paused") {
          paused += performance.now() - pausedAt;
          pausedAt = 0;
          record.resume();
        }
      },
    };
  } catch (e) {
    cleanup();
    throw e;
  }
}
