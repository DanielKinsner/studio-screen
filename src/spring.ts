export type Spring = { value: number; velocity: number };

/**
 * Advance a damped spring one fixed step toward `target`.
 * `response` is roughly how long a move takes (seconds); `bounce` 0 glides in
 * without overshoot, higher values overshoot and settle.
 */
export function springStep(
  s: Spring,
  target: number,
  response: number,
  bounce: number,
  dt: number,
) {
  const omega = (2 * Math.PI) / Math.max(0.01, response);
  const damping = 1 - Math.min(0.95, Math.max(0, bounce));
  s.velocity +=
    (omega * omega * (target - s.value) - 2 * damping * omega * s.velocity) *
    dt;
  s.value += s.velocity * dt;
}

/** Cache the last few results of a pure function, compared by argument identity. */
export function memo<A extends readonly unknown[], R>(
  fn: (...args: A) => R,
  size = 4,
) {
  const entries: { args: A; result: R }[] = [];
  return (...args: A): R => {
    const index = entries.findIndex(
      (e) =>
        e.args.length === args.length && e.args.every((v, i) => v === args[i]),
    );
    if (index >= 0) {
      const [hit] = entries.splice(index, 1);
      entries.unshift(hit);
      return hit.result;
    }
    const result = fn(...args);
    entries.unshift({ args, result });
    if (entries.length > size) entries.length = size;
    return result;
  };
}
