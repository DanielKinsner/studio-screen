import { describe, expect, it } from "vitest";
import { memo, springStep, type Spring } from "./spring";

function run(response: number, bounce: number, dt: number, seconds: number) {
  const s: Spring = { value: 0, velocity: 0 };
  const samples: number[] = [];
  const steps = Math.round(seconds / dt);
  for (let i = 1; i <= steps; i++) {
    springStep(s, 1, response, bounce, dt);
    samples.push(s.value);
  }
  return samples;
}

describe("Spring", () => {
  it("glides to the target without overshoot when bounce is zero", () => {
    const dt = 1 / 240;
    const samples = run(0.5, 0, dt, 3);
    expect(samples[Math.round(0.75 / dt) - 1]).toBeGreaterThan(0.99);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1.0001);
  });
  it("overshoots and then settles when bounce is added", () => {
    const dt = 1 / 240;
    const samples = run(0.5, 0.3, dt, 3);
    expect(Math.max(...samples)).toBeGreaterThan(1.02);
    expect(Math.abs(samples[Math.round(2 / dt) - 1] - 1)).toBeLessThan(0.01);
  });
  it("does not depend meaningfully on the simulation step", () => {
    const coarse = run(0.4, 0.1, 1 / 240, 2);
    const fine = run(0.4, 0.1, 1 / 480, 2);
    for (let tenth = 1; tenth <= 20; tenth++) {
      const a = coarse[tenth * 24 - 1],
        b = fine[tenth * 48 - 1];
      expect(Math.abs(a - b)).toBeLessThan(0.01);
    }
  });
  it("holds still when already at rest on the target", () => {
    const s: Spring = { value: 2, velocity: 0 };
    springStep(s, 2, 0.5, 0, 1 / 240);
    expect(s).toEqual({ value: 2, velocity: 0 });
  });
});

describe("memo", () => {
  it("reuses results for identical arguments and recomputes on change", () => {
    let calls = 0;
    const f = memo((a: object, b: number) => {
      calls++;
      return { a, b };
    });
    const key = {};
    const first = f(key, 1);
    expect(f(key, 1)).toBe(first);
    expect(calls).toBe(1);
    expect(f({}, 1)).not.toBe(first);
    expect(f(key, 2)).not.toBe(first);
    expect(calls).toBe(3);
    expect(f(key, 1)).toBe(first);
    expect(calls).toBe(3);
  });
  it("forgets the oldest entry beyond its size", () => {
    let calls = 0;
    const f = memo((n: number) => {
      calls++;
      return [n];
    }, 2);
    f(1);
    f(2);
    f(3);
    f(1);
    expect(calls).toBe(4);
  });
});
