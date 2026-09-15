import type { Media } from "./compositor";

/** Longest side of the held picture; it only shows while a seek is in flight. */
const HOLD_SIZE = 1920;

/**
 * The preview's "last good frame", like an editing app holding the previous
 * picture while the next one decodes. Export never uses this: it decodes every
 * frame exactly.
 */
export class FrameHold {
  private canvas: HTMLCanvasElement | null = null;
  private video: HTMLVideoElement | null = null;
  private time = NaN;
  private has = false;

  /** Keep a copy of the picture the video is showing, if it is a settled frame. */
  capture(video: HTMLVideoElement | null) {
    if (!video) return;
    if (video !== this.video) {
      this.video = video;
      this.has = false;
      this.time = NaN;
    }
    if (video.seeking || video.readyState < 2 || !video.videoWidth) return;
    if (this.has && video.currentTime === this.time) return;
    const scale = Math.min(
      1,
      HOLD_SIZE / Math.max(video.videoWidth, video.videoHeight),
    );
    const width = Math.max(2, Math.round(video.videoWidth * scale)),
      height = Math.max(2, Math.round(video.videoHeight * scale));
    this.canvas ??= document.createElement("canvas");
    if (this.canvas.width !== width || this.canvas.height !== height)
      Object.assign(this.canvas, { width, height });
    this.canvas.getContext("2d")!.drawImage(video, 0, 0, width, height);
    this.time = video.currentTime;
    this.has = true;
  }

  /**
   * What the compositor should draw: the live video once its frame is ready,
   * otherwise the held picture. `keep` copies ready frames (paused preview);
   * playback passes false so it doesn't copy every frame.
   */
  media(video: HTMLVideoElement | null, keep = true): Media {
    if (!video) return { video };
    if (!video.seeking && video.readyState >= 2) {
      if (keep) this.capture(video);
      return { video };
    }
    if (this.has && this.video === video && this.canvas)
      return {
        video,
        frame: {
          image: this.canvas,
          width: video.videoWidth,
          height: video.videoHeight,
        },
      };
    return { video };
  }
}

/**
 * Seeks a paused video without piling seeks on top of each other: while one
 * is in flight only the newest requested time is remembered, and it runs when
 * the current seek lands.
 */
export class Seeker {
  private busy = false;
  private target: number | null = null;
  private settled: number | null = null;

  constructor(
    private video: HTMLVideoElement,
    /** Called when the video has arrived at the newest requested time. */
    private landed: () => void,
  ) {}

  seek(t: number) {
    if (this.busy) {
      this.target = t;
      return;
    }
    this.start(t);
  }

  /** Forget any queued seek (playback takes over the video clock). */
  cancel() {
    this.target = null;
    this.settled = null;
  }

  private start(t: number) {
    const v = this.video;
    if (Math.abs(v.currentTime - t) < 0.0005 || (t === this.settled && v.paused))
      return;
    this.busy = true;
    const done = () => {
      v.removeEventListener("seeked", done);
      this.busy = false;
      this.settled = t;
      const next = this.target;
      this.target = null;
      if (next !== null && next !== t) this.start(next);
      if (!this.busy) this.landed();
    };
    v.addEventListener("seeked", done);
    v.currentTime = t;
  }
}
