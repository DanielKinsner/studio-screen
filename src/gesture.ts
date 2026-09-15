// Which continuous gesture an edit belongs to, read from the DOM event that
// caused it. A capture listener on the document runs before React's handlers,
// so while an input's onChange runs, `inputGesture()` names that input.
// Pointer releases and focus changes start a new gesture for every control.

let event: Event | null = null;
let key = "";
let epoch = 0;
let held = 0;
const ids = new WeakMap<EventTarget, number>();
let nextId = 0;

/** The gesture for the input event being handled right now, if any. */
export function inputGesture() {
  // After dispatch the event's phase returns to NONE, so a stale key can never
  // leak into a later, unrelated edit.
  return event && event.eventPhase !== Event.NONE ? key : undefined;
}

/** A mouse button or finger is down somewhere in the page. */
export const pointerHeld = () => held > 0;

/** Make every control's next edit start a new undo step. */
export const endGestures = () => void epoch++;

export function installGestures(doc: Document = document) {
  const input = (e: Event) => {
    const target = e.target;
    if (
      !(target instanceof HTMLInputElement) &&
      !(target instanceof HTMLTextAreaElement)
    )
      return;
    let id = ids.get(target);
    if (id === undefined) ids.set(target, (id = ++nextId));
    event = e;
    key = `input:${id}:${epoch}`;
  };
  const down = () => void held++;
  const up = () => {
    held = 0;
    epoch++;
  };
  doc.addEventListener("input", input, true);
  doc.addEventListener("pointerdown", down, true);
  doc.addEventListener("pointerup", up, true);
  doc.addEventListener("pointercancel", up, true);
  doc.addEventListener("focusout", endGestures, true);
  return () => {
    doc.removeEventListener("input", input, true);
    doc.removeEventListener("pointerdown", down, true);
    doc.removeEventListener("pointerup", up, true);
    doc.removeEventListener("pointercancel", up, true);
    doc.removeEventListener("focusout", endGestures, true);
  };
}
