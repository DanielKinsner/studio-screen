/** The package.json version, filled in by Vite at build time. */
declare const __APP_VERSION__: string;
declare module "gifenc" {
  export function GIFEncoder(): {
    writeFrame: (
      data: Uint8Array,
      w: number,
      h: number,
      /** Without a palette, the frame uses the first frame's (global) one. */
      options: { palette?: number[][]; delay: number; repeat?: number },
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };
  export function quantize(data: Uint8ClampedArray, count: number): number[][];
  /** Nearest palette index and its squared RGB distance. */
  export function nearestColorIndexWithDistance(
    palette: number[][],
    pixel: number[],
  ): [number, number];
  export function applyPalette(
    data: Uint8ClampedArray,
    palette: number[][],
  ): Uint8Array;
}
