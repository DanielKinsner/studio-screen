import { useEffect, useState, type RefObject } from "react";

/** Size the canvas in physical pixels, including monitor changes and fullscreen. */
export function usePreviewSize(
  ref: RefObject<HTMLCanvasElement | null>,
  aspect: string,
) {
  const [size, setSize] = useState({ width: 1600, height: 900 });
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const [a, b] = aspect.split(":").map(Number),
      ratio = a / b;
    let frame = 0,
      query = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const limit =
          ratio >= 1
            ? Math.min(2160, 3840 / ratio)
            : Math.min(3840, 2160 / ratio);
        const height = Math.max(
          2,
          Math.min(
            Math.floor(limit / 2) * 2,
            Math.ceil(
              (Math.min(rect.height, rect.width / ratio) * devicePixelRatio) /
                2,
            ) * 2,
          ),
        );
        const width = Math.round((height * ratio) / 2) * 2;
        setSize((old) =>
          old.width === width && old.height === height
            ? old
            : { width, height },
        );
      });
    };
    const densityChanged = () => {
      query.removeEventListener("change", densityChanged);
      query = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
      query.addEventListener("change", densityChanged);
      measure();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    query.addEventListener("change", densityChanged);
    window.addEventListener("resize", measure);
    document.addEventListener("fullscreenchange", measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      query.removeEventListener("change", densityChanged);
      window.removeEventListener("resize", measure);
      document.removeEventListener("fullscreenchange", measure);
    };
  }, [ref, aspect]);
  return size;
}
