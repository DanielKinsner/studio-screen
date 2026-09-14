import { describe, expect, it } from "vitest";
import { stretch } from "./stretch";

const rate = 48000;
function sine(seconds: number, hz: number) {
  return Float32Array.from(
    { length: Math.round(seconds * rate) },
    (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate),
  );
}
/** Frequency estimated from upward zero crossings in the middle of the signal. */
function pitch(samples: Float32Array) {
  const from = Math.floor(samples.length * 0.2),
    to = Math.floor(samples.length * 0.8);
  let crossings = 0;
  for (let i = from + 1; i < to; i++)
    if (samples[i - 1] < 0 && samples[i] >= 0) crossings++;
  return crossings / ((to - from) / rate);
}
function rms(samples: Float32Array) {
  let sum = 0;
  for (const v of samples) sum += v * v;
  return Math.sqrt(sum / samples.length);
}

describe("Time stretch", () => {
  it("speeds audio up without raising the pitch", () => {
    const [out] = stretch([sine(2, 440)], 2, rate);
    expect(out.length).toBe(rate);
    expect(Math.abs(pitch(out) - 440)).toBeLessThan(6);
    expect(rms(out.subarray(4000, -4000))).toBeGreaterThan(0.3);
  });
  it("slows audio down without lowering the pitch", () => {
    const [out] = stretch([sine(1, 300)], 0.5, rate);
    expect(out.length).toBe(2 * rate);
    expect(Math.abs(pitch(out) - 300)).toBeLessThan(6);
  });
  it("keeps every channel the same length and handles very short input", () => {
    const out = stretch([sine(0.5, 200), sine(0.5, 900)], 4, rate);
    expect(out.map((c) => c.length)).toEqual([rate / 8, rate / 8]);
    const tiny = stretch([new Float32Array(100)], 3, rate);
    expect(tiny[0].length).toBe(33);
  });
  it("passes audio through untouched at normal speed", () => {
    const input = sine(0.25, 500);
    expect(stretch([input], 1, rate)[0]).toBe(input);
  });
});
