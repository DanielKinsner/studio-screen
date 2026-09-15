import { expect, test } from "vitest";
import { flashTimes, pairOffsets } from "./av-measure.mjs";

test("missing flashes cannot report zero milliseconds of sync", () => {
  expect(pairOffsets([], [1, 3, 5, 7, 9, 11])).toEqual({ offsetsMs: [], meanMs: null });
});

test("detects six pulses, ignores warmup, and measures signed offsets", () => {
  const frames = Buffer.alloc(720 * 576);
  for (const second of [1, 3, 5, 7, 9, 11])
    frames.fill(255, second * 60 * 576, (second * 60 + 12) * 576);
  const flashes = flashTimes(frames);
  expect(flashes).toEqual([1, 3, 5, 7, 9, 11]);
  expect(pairOffsets(flashes, flashes.map((t) => t + 0.049))).toEqual({ offsetsMs: [49, 49, 49, 49, 49], meanMs: 49 });
  expect(pairOffsets(flashes, flashes.map((t) => t - 0.010)).meanMs).toBe(-10);
});
