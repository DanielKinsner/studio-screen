import { describe, expect, it } from "vitest";
import { gifWriter } from "./gif";

const W = 64,
  H = 48;

/** A soft two-colour gradient with a little per-frame noise, like screen footage. */
function screenFrame(seed: number, from: number[], to: number[]) {
  let s = seed;
  const noise = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) % 7) - 3;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = (x + y) / (W + H - 2),
        o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++)
        data[o + c] = from[c] + (to[c] - from[c]) * t + noise();
      data[o + 3] = 255;
    }
  return data;
}

/** For each frame of a GIF: does it carry its own (local) colour table? */
function localTables(bytes: Uint8Array) {
  let i = 6;
  const screen = bytes[i + 4];
  i += 7;
  if (screen & 0x80) i += 3 * 2 ** ((screen & 7) + 1);
  const skipBlocks = () => {
    while (bytes[i]) i += bytes[i] + 1;
    i++;
  };
  const frames: boolean[] = [];
  while (i < bytes.length && bytes[i] !== 0x3b) {
    if (bytes[i] === 0x21) {
      i += 2;
      skipBlocks();
    } else if (bytes[i] === 0x2c) {
      const packed = bytes[i + 9];
      i += 10;
      frames.push(!!(packed & 0x80));
      if (packed & 0x80) i += 3 * 2 ** ((packed & 7) + 1);
      i++; // LZW minimum code size
      skipBlocks();
    } else throw new Error(`Unexpected GIF block ${bytes[i]} at ${i}`);
  }
  return frames;
}

describe("GIF export colours", () => {
  it("keeps one palette across similar frames, so flat areas don't shimmer", () => {
    const gif = gifWriter(W, H, 30);
    for (let f = 0; f < 10; f++) gif.add(screenFrame(f + 1, [230, 180, 150], [60, 70, 90]));
    const local = localTables(gif.finish());
    expect(local).toHaveLength(10);
    expect(local.filter(Boolean)).toHaveLength(0);
  });

  it("switches palette at a scene change so new colours stay accurate", () => {
    const gif = gifWriter(W, H, 30);
    for (let f = 0; f < 3; f++) gif.add(screenFrame(f + 1, [250, 250, 250], [235, 235, 235]));
    for (let f = 0; f < 3; f++) gif.add(screenFrame(f + 9, [20, 90, 200], [220, 40, 60]));
    expect(localTables(gif.finish())).toEqual([false, false, false, true, true, true]);
  });
});
