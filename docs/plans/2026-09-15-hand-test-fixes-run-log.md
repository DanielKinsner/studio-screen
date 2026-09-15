# Hand-test fixes: run log

Run log for [the execution plan](2026-09-15-hand-test-fixes-execution-plan.md) (section 6b). One entry per slice: what shipped, verification with numbers, skipped tests, and every deviation or judgment call.

Executor: Claude (Opus 5), one session on Dan's office PC, 2026-09-15.

## Baseline (before any change)

- `git pull origin main`: already up to date at `babac5f`.
- `npm test`: 12 files, **65 passed**. `npm run build`: OK (952.66 kB main chunk, existing size warning).
- With `npm run dev`: `node tests/browser-smoke.mjs` PASS; `node tests/a1-playback.mjs` PASS.

### Plan-vs-code notes found while reading (before slice 1)

- The timeline button the plan calls **Cut** is labelled **Remove 1s** in the code (`addCut`, App.tsx). Same behaviour (removes 1 s at the playhead).
- The footer version badge is hard-coded `v0.2.1` (App.tsx footer), so a `0.3.0` search in slice 12 would not find it. Handled in slice 12.
- Line numbers in the plan are close but not exact (App.tsx is 2,828 lines now); every cited mechanism exists as described.

## Slice 1: Deselect (R8)

**Shipped:** pressing empty timeline space clears the selection and still scrubs; pressing the preview (outside buttons and future overlay controls) clears it; Esc clears it when no modal is open. New `tests/editor-interactions.mjs` (README → Tests).

**Root cause:** the timeline's pointer-down handler only scrubbed and nothing else ever set `selected` back to null.

**Verification:**
- `node tests/editor-interactions.mjs` failed first ("Clicking empty timeline space did not clear the selection"), then PASS: 2 zoom clips before and after Delete in all three cases; empty-space press scrubbed the playhead to 97%.
- `npm test` 65 passed; `npm run build` OK; `browser-smoke` PASS; `a1-playback` PASS.

**Deviations / judgment calls:**
- With an annotation selected, a press on the preview frame still *places* that element (the existing "targeting" behaviour) instead of deselecting. Deselecting there would break annotation placement. Presses on the halo around the frame still deselect.
- Esc works even when focus is still on a slider or colour input (focus stays on a range input after dragging it), but not in text fields, textareas or selects. Other shortcuts keep the old input guard unchanged.
- The preview handler ignores `button` and `.preview-control` elements; slice 11's dot will use `.preview-control`.

