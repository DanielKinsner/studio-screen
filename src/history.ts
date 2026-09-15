/** How many undo steps are kept. */
export const HISTORY_LIMIT = 200;
/** A gesture with no edit for this long ends (keyboard arrows on a slider). */
export const GESTURE_IDLE = 500;

export type RecordOptions = {
  /** Consecutive edits with the same key merge into one undo step. */
  gesture?: string;
  /** A pointer is still held down, so a pause does not end the gesture. */
  held?: boolean;
};

/**
 * Undo and redo stacks where one undo step is one thing a person did: a whole
 * slider drag, not every value it passed through.
 */
export class EditHistory<T> {
  past: T[] = [];
  future: T[] = [];
  private gesture: string | undefined;
  private last = -Infinity;

  constructor(
    private limit = HISTORY_LIMIT,
    private idle = GESTURE_IDLE,
    private now: () => number = () => performance.now(),
  ) {}

  /** Call for every edit with the state it replaces. */
  record(previous: T, options: RecordOptions = {}) {
    const time = this.now();
    const merge =
      options.gesture !== undefined &&
      options.gesture === this.gesture &&
      this.past.length > 0 &&
      (options.held || time - this.last < this.idle);
    this.future = [];
    this.gesture = options.gesture;
    this.last = time;
    if (merge) return;
    this.past.push(previous);
    if (this.past.length > this.limit)
      this.past.splice(0, this.past.length - this.limit);
  }

  /** Finish the gesture in progress so the next edit is its own step. */
  endGesture(gesture?: string) {
    if (gesture === undefined || gesture === this.gesture)
      this.gesture = undefined;
  }

  undo(current: T): T | undefined {
    this.gesture = undefined;
    const previous = this.past.pop();
    if (previous !== undefined) this.future.push(current);
    return previous;
  }

  redo(current: T): T | undefined {
    this.gesture = undefined;
    const next = this.future.pop();
    if (next !== undefined) this.past.push(current);
    return next;
  }

  clear() {
    this.past = [];
    this.future = [];
    this.gesture = undefined;
  }
}
