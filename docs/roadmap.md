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

## Phase 1 — Arrange: align, distribute, group, layer order ✅
- [x] **Align** (left/center/right/top/middle/bottom) — to the selection's box,
      or to the hoop when one object is selected (`src/lib/arrange.ts`).
- [x] **Distribute** 3+ objects: even horizontal / vertical center spacing.
- [x] **Group / ungroup** (`groupId` on objects; `setSelection` expands to the
      whole group via `expandGroups`, so they select/move/align/delete together).
- [x] **Layer order**: per-row up/down in the Layers panel, plus an Arrange
      control group (to back / backward / forward / to front) on any selection.
- [x] Keyboard: `[` / `]` re-order, `Ctrl/Cmd+G` group, `Ctrl/Cmd+Shift+G` ungroup.
- [x] Tests: align math, distribute spacing, `moveOrder`, group selection.

## Phase 2 — Better image digitizing (in progress)
Raise the floor on photo/logo → stitches.
- [x] **k-means color clustering** (`kmeansPalette`, Lloyd + spread seeding)
      replaces median-cut in the quantizer — distinct hues no longer merge to
      mud when a background dominates the pixel count.
- [x] **Border-based background detection** (`borderBackgroundColor`) — the most
      common border color is removed, instead of "largest area" (which wrongly
      dropped big subjects). Falls back to area when the border is transparent.
- [x] Area despeckle of tiny regions (existing) keeps confetti out.
- [ ] Optional: morphological despeckle of the quantized raster to smooth ragged
      cluster edges on noisy photos.
- [ ] Map traced regions through the real classifier (satin vs tatami) and
      merge slivers; order colors to minimize changes.
- [ ] Stronger "this is a photo" guard with a helpful preview.

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
