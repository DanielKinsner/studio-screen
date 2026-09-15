import { useEffect, useRef } from "react";
import type { Project } from "./types";
import { demoFrame } from "./compositor";
import { loadVideo, releaseVideo, seek } from "./media";
/** Twelve thumbnails of the trimmed footage, sampled at the given source times. */
export default function Filmstrip({
  project,
  times,
}: {
  project: Project;
  times: number[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const key = times.map((t) => t.toFixed(3)).join(",");
  useEffect(() => {
    let alive = true;
    let video: HTMLVideoElement | undefined;
    const draw = async () => {
      try {
        const media = project.video || project.videoUrl;
        if (media) video = await loadVideo(media);
        if (!alive) {
          releaseVideo(video);
          return;
        }
        const frames = ref.current?.querySelectorAll("canvas");
        if (!frames) return;
        for (let i = 0; i < frames.length; i++) {
          if (!alive) return;
          const time = +key.split(",")[i] || 0;
          if (video) await seek(video, time);
          if (!alive) return;
          const source = project.demo ? demoFrame(time) : video;
          if (source)
            frames[i]
              .getContext("2d")
              ?.drawImage(source, 0, 0, frames[i].width, frames[i].height);
        }
      } catch {
        /* The main video preview reports invalid media. */
      } finally {
        releaseVideo(video);
      }
    };
    void draw();
    return () => {
      alive = false;
    };
  }, [project.video, project.videoUrl, project.demo, key]);
  return (
    <div className="clip-thumbnails" ref={ref}>
      {times.map((_, i) => (
        <canvas width={128} height={72} key={i} aria-hidden="true" />
      ))}
    </div>
  );
}
