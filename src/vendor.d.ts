declare module "gifenc" {
  export function GIFEncoder(): {
    writeFrame: (
      data: Uint8Array,
      w: number,
      h: number,
      options: { palette: number[][]; delay: number; repeat?: number },
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };
  export function quantize(data: Uint8ClampedArray, count: number): number[][];
  export function applyPalette(
    data: Uint8ClampedArray,
    palette: number[][],
  ): Uint8Array;
}
