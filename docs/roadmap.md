# Buttery Stitches — Roadmap

Living plan for the work ahead. The stitch engine is mature (see
`docs/stitch-logic.md`); this tracks UX/feature work. Order reflects the latest
priorities.

## Phase 0 — Mobile correctness (in progress)
The editor must work on a phone, not just resize.
- [x] Touch on the canvas: pinch-zoom, two-finger pan, tap-to-draw/select.
- [x] **Dynamic viewport height** (`100dvh`) so the browser address bar never
      cuts off the bottom of the fixed-height app shell.
- [x] **Side panels scroll** — flex scroll containers need `min-h-0`, and the
      document no longer rubber-bands (`overscroll-behavior`).
- [ ] Verify on a real device (no headless browser available here): homepage
      scroll, editor fits, Layers/Properties drawers scroll, gestures.
- [ ] Compact the top bar / simulator bar on narrow screens if they still crowd
      the canvas (consider a single scrollable row instead of wrapping).

## Phase 1 — Arrange: align, distribute, group, layer order (NEXT)
Everyday layout power. Pure geometry + store actions; no engine changes.
- **Align** selected objects: left / center / right / top / middle / bottom
  (to the selection's bounds, or to the hoop when one object is selected).
- **Distribute** 3+ objects: even horizontal / vertical spacing.
- **Group / ungroup**: a group id on objects so they select & move together;
  the canvas treats a group as one selection unit.
- **Layer order in the Layers panel**: move an object up/down one step, and to
  front/back — small buttons per row, plus keyboard (`[` / `]`). Reuse the
  existing `reorderObjects` store action.
- Toolbar/cluster UI: an "Arrange" control group, enabled on multi-select.
- Tests: align math, distribute spacing, group move is one undo step, reorder.

## Phase 2 — Better image digitizing
Raise the floor on photo/logo → stitches.
- Pre-trace cleanup: blur/quantize tuning, background removal, despeckle small
  regions so tiny islands don't become confetti.
- Smarter color reduction (perceptual clustering) and a live color count.
- Map traced regions through the real classifier (satin vs tatami vs running)
  and merge slivers; order colors to minimize changes.
- Stronger "this is a photo" guard with a helpful preview.

## Phase 3 — Auto-appliqué (later)
Placement run → STOP → tackdown → satin cover-stitch, with a fabric-color guide.

## Smaller tracked items (fold in opportunistically)
- Replace `window.alert` error paths with an on-brand inline toast.
- Design-wide fill-angle override in the Design panel (engine plumbing exists).
- Edge-walk underlay following the shared grain.
- Migrate residual `navy/butter/paper` aliases to canonical `ink/cream/char`.

## Done recently
Crisp text always (thin strokes satin, smoothed rails); stitch-direction
continuity; travel routing + retrace ties; machine-safety floors; QA/QC pass
(a11y, mobile scaffolding, atomic outline, worksheet rebrand, lint clean).
