# Phase 2 — QA / QC notes

A senior-engineering pass over the manual editor, driven by **synthetic user
testing**: walking real user flows to find where people get confused or where a
flow breaks, _before_ shipping. Each finding lists the flow, the problem, and
the fix (with the test that now guards it).

## How this was verified

- **Pure logic is unit-tested.** The risky geometry/interaction math was
  extracted into pure functions (`geometry.ts`, `objects.ts`) so it's verifiable
  without a browser: dedupe, centerline recovery, affine baking, satin width,
  and type conversion all have tests.
- **Panels are tested under jsdom** with Testing Library (`*.dom.test.tsx`):
  ToolStrip, LayerPanel, PropertiesPanel — render + real interactions.
- **A Playwright e2e smoke** (`e2e/smoke.spec.ts`) drives the full draw → manage
  → type-switch flow in a real browser. It is committed for CI; the browser
  binary downloads via `npx playwright install chromium` (blocked in the
  authoring sandbox, runs in CI).

Totals: **38 unit/component tests** green, typecheck clean, production build clean.

## Findings & fixes

### 1. Double-click-to-finish left duplicate vertices  ⛔→✅
**Flow:** draw a fill, double-click the last point to finish.
**Problem:** a double-click is two `mousedown`s + a `dblclick`, so the final
vertex was placed 2–3 times on top of itself. Triangles became degenerate
4–5-point polygons with zero-length edges (which would later produce junk
stitches).
**Fix:** `dedupePath()` drops consecutive points within 0.1 mm before an object
is committed. Guarded by `geometry.test.ts › dedupes consecutive coincident
points`.

### 2. Node dragging flooded the undo history  ⛔→✅
**Flow:** select an object, drag a vertex, then press Undo.
**Problem:** each `mousemove` during a vertex drag wrote to the store, so one
drag produced dozens of undo entries — Undo crawled pixel-by-pixel.
**Fix:** vertex drags update **local component state** and write to the store
**once on release**, so a drag is a single undo step and the outline follows the
handle live. Whole-object move and transform already commit only on gesture end.

### 3. Whole-object "move" recorded no-op undo steps  ⛔→✅
**Flow:** click an object to select it (no drag).
**Problem:** the drag-end handler always baked a translation, creating a junk
undo entry even for a pure click.
**Fix:** skip the commit when the pixel delta is exactly zero.

### 4. Switching a satin object's type broke its geometry  ⛔→✅
**Flow:** select a satin column, change "Stitch type" to Running in Properties.
**Problem:** satin stores a **rail pair** (2 paths) while running/fill expect a
single polyline. Naively swapping the type left mismatched geometry — a satin
turned to running rendered two stray lines, and running→satin fed the width math
a non-rail shape (NaN width).
**Fix:** `convertObjectType()` rebuilds geometry to satisfy each type's
invariant (→satin builds rails from a centerline; satin→other collapses rails to
their centerline; running↔fill keep points). Guarded by `objects.test.ts ›
convertObjectType`.

### 5. Satin column width wasn't editable  ⛔→✅
**Flow:** draw a satin column, try to make it wider.
**Problem:** width was implicit in the rail geometry with no control.
**Fix:** a "Column width (mm)" field re-derives the rails about the fixed
centerline (`setSatinWidth`). This also models the **re-densify, don't scale**
principle locally. Guarded by `objects.test.ts › satin width` and a panel test.

### 6. "Move" and "node edit" fought over the same handles  ⛔→✅
**Problem:** putting transform handles and draggable vertices on the same
selected object at once is ambiguous and error-prone.
**Fix:** split into two tools — **Select** (move + scale/rotate via a Konva
`Transformer`) and **Node** (drag vertices) — the standard vector-editor
separation. Objects are selectable in both modes so Node-mode users can pick a
target.

### 7. Delete key firing while typing in a field  ✅ (verified safe)
**Flow:** edit a thread-color name, press Backspace to erase a character.
**Check:** the global key handler ignores `Delete`/`Backspace` when focus is in
an `INPUT`/`TEXTAREA`/`SELECT`, so editing text never deletes the selected
object.

### 8. Transforms must stay in millimeters  ✅ (by design)
Scale/rotate **bake the affine transform back into mm path coordinates**
(`applyMatrix`) and reset the node, rather than leaving a Konva scale on the
node. This keeps the data model in mm so Phase 5 resizing can re-densify
correctly instead of scaling raw stitch points. Guarded by `geometry.test.ts ›
applies an affine matrix`.

## Known limitations (tracked, not blocking)

- Scaling to a near-zero / negative box is allowed (produces a flipped or tiny
  object); recoverable with Undo. A `boundBoxFunc` minimum is a nice follow-up.
- Drawing accepts points outside the hoop boundary (validation will flag these
  in Phase 5 rather than blocking the gesture).
- Per-vertex insert/delete in Node mode isn't implemented yet (drag only).
- Multi-select move/transform is single-object for now.
