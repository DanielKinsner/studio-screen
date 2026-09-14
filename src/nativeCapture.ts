import type { Point } from "./types";
import { parseEvents, type Activity } from "./nativeEvents";
import type { Region } from "./RegionPicker";

export type NativeResult = {
  folder: string;
  videoUrl: string;
  duration: number;
  points: Point[];
  activity: Activity;
  hasSystemAudio: boolean;
  /** "window-closed" when the recorded window went away. */
  reason: string;
};

/**
 * Record with the Windows capture helper: the video has no cursor baked in,
 * and every click, scroll, shortcut and cursor-shape change is logged on the
 * same clock as the picture and sound.
 */
export async function nativeCapture(options: {
  fps: number;
  system: boolean;
  region?: Region;
  /** Runs after the helper has warmed up, before the first recorded frame. */
  beforeStart?: () => Promise<void>;
}) {
  const desktop = window.studioDesktop!;
  let seconds = 0,
    statsAt = performance.now(),
    paused = false,
    audio = false,
    live = false,
    finished = false;
  let resolveDone!: (result: NativeResult) => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<NativeResult>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  let started: { folder: string; videoUrl: string } | undefined;
  const finish = async (duration: number, reason: string) => {
    if (finished || !started) return;
    finished = true;
    off();
    const { points, activity } = parseEvents(
      await desktop.native.events(started.folder),
    );
    resolveDone({
      folder: started.folder,
      videoUrl: started.videoUrl,
      duration,
      points,
      activity,
      hasSystemAudio: audio,
      reason,
    });
  };
  const off = desktop.native.onEvent((message) => {
    if (message.event === "started") {
      audio = !!message.audio;
      live = true;
      statsAt = performance.now();
    } else if (message.event === "stats") {
      seconds = message.seconds ?? seconds;
      paused = !!message.paused;
      statsAt = performance.now();
    } else if (message.event === "stopped")
      void finish(message.seconds ?? seconds, message.reason ?? "stopped");
    else if (message.event === "error" && live) {
      finished = true;
      off();
      rejectDone(new Error(`Recording stopped: ${message.message}`));
    } else if (message.event === "exit" && !finished)
      // The helper died mid-take; what reached the disk is still usable.
      void finish(seconds, "interrupted");
  });
  try {
    started = await desktop.native.start({
      fps: options.fps,
      audio: options.system,
      region: options.region,
    });
    await options.beforeStart?.();
  } catch (e) {
    off();
    void desktop.native.command("stop");
    throw e;
  }
  await desktop.native.command("begin");
  return {
    done,
    stop: () => void desktop.native.command("stop"),
    pause: () => {
      paused = true;
      void desktop.native.command("pause");
    },
    resume: () => {
      paused = false;
      statsAt = performance.now();
      void desktop.native.command("resume");
    },
    elapsed: () =>
      live ? seconds + (paused ? 0 : (performance.now() - statsAt) / 1000) : 0,
  };
}
