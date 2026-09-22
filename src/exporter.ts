import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  MatroskaInputFormat,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_VERY_HIGH,
  StreamTarget,
  UrlSource,
  VideoSampleSink,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type InputAudioTrack,
  type StreamTargetChunk,
  type VideoSample,
} from "mediabunny";
import { gifWriter } from "./gif";
import type { Project } from "./types";
import { dimensions, releaseCompositor, renderFrame } from "./compositor";
import { outputDuration, sourceTime } from "./timeline";
import { renderAudioChunk, type PcmReader } from "./audioMix";

export type ExportFormat = "mp4" | "webm" | "gif";
export type ExportProgress = {
  frame: number;
  frames: number;
  /** How many seconds of video are rendered per second of work. */
  speed: number;
};
export type ExportWriter = {
  write: (position: number, data: Uint8Array) => Promise<void>;
};
export type ExportOptions = {
  format: ExportFormat;
  height: number;
  fps: number;
  signal: AbortSignal;
  progress: (share: number, info: ExportProgress) => void;
  /** Stream the file somewhere (e.g. to disk). Without it the result is a Blob. */
  writer?: ExportWriter;
};

const SAMPLE_RATE = 48000;
/** Seconds of audio mixed at a time; kept just ahead of the video. */
const AUDIO_CHUNK = 5;

const aborted = () => new DOMException("Export cancelled", "AbortError");

function pcmReader(track: InputAudioTrack): PcmReader {
  const sink = new AudioBufferSink(track);
  return async (from, to) => {
    const sampleRate = await track.getSampleRate();
    const count = await track.getNumberOfChannels();
    const length = Math.round((to - from) * sampleRate);
    if (length <= 0) return null;
    const channels = Array.from(
      { length: count },
      () => new Float32Array(length),
    );
    for await (const { buffer, timestamp } of sink.buffers(from, to)) {
      const offset = Math.round((timestamp - from) * sampleRate);
      const skip = Math.max(0, -offset),
        at = Math.max(0, offset),
        n = Math.min(buffer.length - skip, length - at);
      if (n <= 0) continue;
      for (let c = 0; c < count; c++)
        channels[c].set(
          buffer
            .getChannelData(Math.min(c, buffer.numberOfChannels - 1))
            .subarray(skip, skip + n),
          at,
        );
    }
    return { sampleRate, channels };
  };
}

/** Decode a whole (short) audio or video file's sound into one AudioBuffer. */
async function decodeMusic(blob: Blob) {
  try {
    return await new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(
      await blob.arrayBuffer(),
    );
  } catch {
    const input = new Input({
      source: new BlobSource(blob),
      formats: ALL_FORMATS,
    });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) return undefined;
      const duration = await track.computeDuration();
      const pcm = await pcmReader(track)(0, duration);
      if (!pcm) return undefined;
      const buffer = new AudioBuffer({
        numberOfChannels: pcm.channels.length,
        length: pcm.channels[0].length,
        sampleRate: pcm.sampleRate,
      });
      pcm.channels.forEach((c, i) => buffer.copyToChannel(c, i));
      return buffer;
    } finally {
      input.dispose();
    }
  }
}

/**
 * The frame on screen at each of the given rising timestamps, decoding the file
 * in order. Used for WebM: browser recordings with sound have no cue index,
 * keyframes seconds apart and a new cluster every second, and mediabunny's
 * lookup by time returns nothing for a frame whose keyframe sits in an earlier
 * cluster. Slower across long cuts, since it decodes the footage it skips.
 */
async function* samplesInOrder(
  sink: VideoSampleSink,
  start: number,
  timestamps: Iterable<number>,
): AsyncGenerator<VideoSample | null, void, unknown> {
  // Starts at the keyframe before `start`, or the file's first one.
  const decoded = sink.samples(start);
  let current: VideoSample | null = null;
  let next: VideoSample | null = null;
  let ended = false;
  try {
    for (const t of timestamps) {
      while (!ended) {
        if (!next) {
          const result = await decoded.next();
          if (result.done) {
            ended = true;
            break;
          }
          next = result.value;
        }
        if (next.timestamp > t) break;
        current?.close();
        current = next;
        next = null;
      }
      yield current ? current.clone() : null;
    }
  } finally {
    current?.close();
    next?.close();
    await decoded.return(undefined);
  }
}

async function loadImage(blob?: Blob) {
  if (!blob) return undefined;
  const image = new Image();
  image.src = URL.createObjectURL(blob);
  await image.decode();
  return image;
}

/**
 * Render the edit frame by frame: decode the exact source frame for every
 * output frame, draw it with the shared compositor, and encode it. Runs as
 * fast as the machine allows and does not depend on the window being visible.
 */
export async function exportProject(
  p: Project,
  options: ExportOptions,
): Promise<Blob | null> {
  const { fps, signal } = options;
  const total = outputDuration(p);
  if (total <= 0.05)
    throw new Error("Keep at least one frame in the timeline to export.");
  const frames = Math.max(1, Math.round(total * fps));
  const canvas = document.createElement("canvas");
  Object.assign(canvas, dimensions(p.settings.aspect, options.height));
  const source = p.video
    ? new BlobSource(p.video)
    : p.videoUrl
      ? new UrlSource(p.videoUrl)
      : undefined;
  const input = source
    ? new Input({ source, formats: ALL_FORMATS })
    : undefined;
  const background = await loadImage(p.backgroundImage);
  let output: Output | undefined;
  try {
    const videoTrack = input ? await input.getPrimaryVideoTrack() : null;
    const audioTrack = input ? await input.getPrimaryAudioTrack() : null;
    const offset = videoTrack
      ? Math.max(0, await videoTrack.getFirstTimestamp())
      : 0;
    // Output frame i shows the source frame on screen at its edited time.
    const sink = videoTrack ? new VideoSampleSink(videoTrack) : undefined;
    const times = function* () {
      for (let i = 0; i < frames; i++) yield sourceTime(p, i / fps) + offset;
    };
    // Edits never run backwards in source time, so WebM can be read in order.
    const webm = (await input?.getFormat()) instanceof MatroskaInputFormat;
    const samples =
      sink &&
      (webm
        ? samplesInOrder(sink, sourceTime(p, 0) + offset, times())
        : sink.samplesAtTimestamps(times()));
    const started = performance.now();
    const draw = async (i: number) => {
      const next = samples ? await samples.next() : undefined;
      const sample = next && !next.done ? next.value : null;
      try {
        renderFrame(canvas, p, sourceTime(p, i / fps), {
          frame: sample
            ? {
                image: sample.toCanvasImageSource(),
                width: sample.displayWidth,
                height: sample.displayHeight,
              }
            : null,
          background,
        });
      } finally {
        sample?.close();
      }
    };
    const report = (i: number) =>
      options.progress((i + 1) / frames, {
        frame: i + 1,
        frames,
        speed: (i + 1) / fps / ((performance.now() - started) / 1000),
      });

    if (options.format === "gif") {
      const gif = gifWriter(canvas.width, canvas.height, fps);
      for (let i = 0; i < frames; i++) {
        if (signal.aborted) throw aborted();
        await draw(i);
        gif.add(
          canvas
            .getContext("2d")!
            .getImageData(0, 0, canvas.width, canvas.height).data,
        );
        report(i);
        // Let the page breathe between the heavy palette steps.
        if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
      }
      await samples?.return(undefined);
      const bytes = gif.finish();
      if (options.writer) {
        await options.writer.write(0, bytes);
        return null;
      }
      return new Blob([bytes], { type: "image/gif" });
    }

    const mp4 = options.format === "mp4";
    const videoCodec = mp4 ? "avc" : "vp9";
    if (
      !(await canEncodeVideo(videoCodec, {
        width: canvas.width,
        height: canvas.height,
      }))
    )
      throw new Error(
        `This computer can't encode ${mp4 ? "H.264" : "VP9"} at ${canvas.height}p. Try a lower resolution.`,
      );
    const audioCodec = mp4 ? "aac" : "opus";
    const music = p.music ? await decodeMusic(p.music) : undefined;
    const wantsAudio =
      (!!audioTrack && p.settings.volume > 0) ||
      (!!music && p.settings.musicVolume > 0) ||
      p.settings.clickVolume > 0;
    const withAudio =
      wantsAudio &&
      (await canEncodeAudio(audioCodec, {
        numberOfChannels: 2,
        sampleRate: SAMPLE_RATE,
      }));
    // Without an encoder the video would come out silent: say so instead.
    if (wantsAudio && !withAudio)
      throw new Error(
        `This computer can't encode ${mp4 ? "AAC" : "Opus"} audio, so the export would be silent. Try ${mp4 ? "WebM" : "MP4"}, or mute the recording, music and click sounds to export without sound.`,
      );

    const target = options.writer
      ? new StreamTarget(
          new WritableStream<StreamTargetChunk>({
            write: (chunk) => options.writer!.write(chunk.position, chunk.data),
          }),
          { chunked: true, chunkSize: 16 * 1024 * 1024 },
        )
      : new BufferTarget();
    output = new Output({
      format: mp4
        ? new Mp4OutputFormat({
            fastStart: options.writer ? false : "in-memory",
          })
        : new WebMOutputFormat(),
      target,
    });
    const video = new CanvasSource(canvas, {
      codec: videoCodec,
      quality: QUALITY_VERY_HIGH,
      keyFrameInterval: 2,
      latencyMode: "quality",
    });
    output.addVideoTrack(video, { frameRate: fps });
    const audio = withAudio
      ? new AudioBufferSource({ codec: audioCodec, quality: QUALITY_HIGH })
      : undefined;
    if (audio) output.addAudioTrack(audio);
    await output.start();

    const readSource = audioTrack ? pcmReader(audioTrack) : undefined;
    let mixed = 0;
    const mixUntil = async (until: number) => {
      while (audio && mixed < until - 1e-9) {
        const end = Math.min(total, mixed + AUDIO_CHUNK);
        await audio.add(
          await renderAudioChunk(p, mixed, end, {
            readSource,
            music,
            sampleRate: SAMPLE_RATE,
          }),
        );
        mixed = end;
      }
    };
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw aborted();
      await mixUntil(Math.min(total, i / fps + AUDIO_CHUNK));
      await draw(i);
      await video.add(i / fps, 1 / fps);
      report(i);
    }
    await samples?.return(undefined);
    await mixUntil(total);
    if (signal.aborted) throw aborted();
    await output.finalize();
    return target instanceof BufferTarget
      ? new Blob([target.buffer!], { type: mp4 ? "video/mp4" : "video/webm" })
      : null;
  } catch (e) {
    if (output && output.state !== "finalized" && output.state !== "canceled")
      await output.cancel().catch(() => {});
    throw e;
  } finally {
    releaseCompositor(canvas);
    if (background) URL.revokeObjectURL(background.src);
    input?.dispose();
  }
}
