import { describe, expect, it } from "vitest";
import { EditHistory } from "./history";

const clock = () => {
  const c = { t: 0, now: () => c.t };
  return c;
};

describe("Edit history", () => {
  it("merges a gesture's edits into the step its first edit created", () => {
    const c = clock();
    const h = new EditHistory<number>(200, 500, c.now);
    h.record(1);
    // A drag from 1.65 to 2.5 in many small steps.
    let value = 1.65;
    for (let i = 0; i < 40; i++) {
      h.record(value, { gesture: "magnification", held: true });
      value += 0.02;
      c.t += 16;
    }
    expect(h.past).toEqual([1, 1.65]);
    expect(h.undo(value)).toBe(1.65);
    expect(h.undo(1.65)).toBe(1);
  });
  it("starts a new step once the gesture ends", () => {
    const h = new EditHistory<string>(200, 500, clock().now);
    h.record("a", { gesture: "slider" });
    h.record("b", { gesture: "slider" });
    h.endGesture("slider");
    h.record("c", { gesture: "slider" });
    expect(h.past).toEqual(["a", "c"]);
  });
  it("ignores ending a different gesture", () => {
    const h = new EditHistory<string>(200, 500, clock().now);
    h.record("a", { gesture: "one" });
    h.endGesture("two");
    h.record("b", { gesture: "one" });
    expect(h.past).toEqual(["a"]);
  });
  it("ends a gesture after 500 ms without an edit unless the pointer is held", () => {
    const c = clock();
    const h = new EditHistory<string>(200, 500, c.now);
    h.record("a", { gesture: "keys" });
    c.t += 400;
    h.record("b", { gesture: "keys" });
    c.t += 600;
    h.record("c", { gesture: "keys" });
    expect(h.past).toEqual(["a", "c"]);
    c.t += 2000;
    h.record("d", { gesture: "keys", held: true });
    expect(h.past).toEqual(["a", "c"]);
  });
  it("never merges different gestures or edits without one", () => {
    const h = new EditHistory<string>(200, 500, clock().now);
    h.record("a", { gesture: "x" });
    h.record("b", { gesture: "y" });
    h.record("c");
    h.record("d");
    expect(h.past).toEqual(["a", "b", "c", "d"]);
  });
  it("keeps the newest 200 steps", () => {
    const h = new EditHistory<number>(undefined, undefined, clock().now);
    for (let i = 0; i < 250; i++) h.record(i);
    expect(h.past).toHaveLength(200);
    expect(h.past[0]).toBe(50);
    expect(h.past.at(-1)).toBe(249);
  });
  it("clears redo after a new edit, and undo breaks a gesture", () => {
    const h = new EditHistory<string>(200, 500, clock().now);
    h.record("a", { gesture: "s" });
    expect(h.undo("b")).toBe("a");
    expect(h.future).toEqual(["b"]);
    h.record("a", { gesture: "s" });
    expect(h.future).toEqual([]);
    expect(h.past).toEqual(["a"]);
    expect(h.redo("x")).toBeUndefined();
  });
  it("redoes what was undone", () => {
    const h = new EditHistory<string>(200, 500, clock().now);
    h.record("a");
    h.record("b");
    expect(h.undo("c")).toBe("b");
    expect(h.undo("b")).toBe("a");
    expect(h.redo("a")).toBe("b");
    expect(h.redo("b")).toBe("c");
    expect(h.past).toEqual(["a", "b"]);
  });
});
