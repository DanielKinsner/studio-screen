import {
  GIFEncoder,
  applyPalette,
  nearestColorIndexWithDistance,
  quantize,
} from "gifenc";

type Palette = number[][];

/** Mean squared colour error of `palette` over ~2,000 pixels spread across the frame. */
function paletteError(rgba: Uint8ClampedArray, palette: Palette) {
  const pixels = rgba.length / 4,
    step = Math.max(1, Math.floor(pixels / 2000));
  let sum = 0,
    n = 0;
  for (let i = 0; i < pixels; i += step, n++) {
    const o = i * 4;
    sum += nearestColorIndexWithDistance(palette, [rgba[o], rgba[o + 1], rgba[o + 2]])[1];
  }
  return sum / n;
}

/**
 * Animated GIF writer: one call per rendered RGBA frame.
 *
 * Frames share a palette until a fresh one would fit the picture far better
 * (a new scene); picking a new 256-colour palette for every frame made flat
 * areas shimmer as their nearest colours changed from frame to frame. The
 * first palette is the file's global one; a frame on another palette carries
 * it as a local table.
 */
export function gifWriter(width: number, height: number, fps: number) {
  const gif = GIFEncoder();
  let global: Palette | null = null,
    current: Palette | null = null;
  return {
    add(rgba: Uint8ClampedArray) {
      const fresh = quantize(rgba, 256);
      // Keep the palette unless its error is well above what a new one gets;
      // the constant keeps near-perfect fits from switching over noise.
      if (!current || paletteError(rgba, current) > 2 * paletteError(rgba, fresh) + 64)
        current = fresh;
      const first = !global;
      global ??= current;
      gif.writeFrame(applyPalette(rgba, current), width, height, {
        palette: first || current !== global ? current : undefined,
        delay: 1000 / fps,
        repeat: 0,
      });
    },
    finish() {
      gif.finish();
      return new Uint8Array(gif.bytes());
    },
  };
}
