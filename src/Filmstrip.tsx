import { useEffect, useRef } from "react";
import type { Project } from "./types";
import { demoFrame } from "./compositor";
import { loadVideo, releaseVideo, seek } from "./media";
export default function Filmstrip({ project }: { project: Project }) {
  const ref = useRef<HTMLDivElement>(null);
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
          const time =
            project.trimStart +
            ((project.trimEnd - project.trimStart) * i) / frames.length;
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
  }, [
    project.video,
    project.videoUrl,
    project.demo,
    project.trimStart,
    project.trimEnd,
  ]);
  return (
    <div className="clip-thumbnails" ref={ref}>
      {Array.from({ length: 12 }, (_, i) => (
        <canvas width={128} height={72} key={i} aria-hidden="true" />
      ))}
    </div>
  );
}
