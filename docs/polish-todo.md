# Buttery Stitches — polish & quality running list

Working toward a Hatch-by-Wilcom-level, open-source embroidery digitizer. This is
the living audit/polish list: check items off as they land.

## Auto-digitize (flat image → embroidery) — the big one
- [x] Anti-aliasing fringe became dozens of thin "running" objects — drop short
      thin slivers; only keep long strokes as running.
- [x] Despeckle harder + blur the source to merge fringe (fewer, cleaner objects).
- [ ] Real region segmentation (raster flood-fill) for solid fills, not edge
      outlines — the deeper Hatch-level rebuild.
- [ ] Smart per-region stitch type: broad → tatami, thin/text → satin.
- [ ] Optional RgbQuant pre-quantization for cleaner color separation.
- [ ] De-dupe: avoid a fill AND a running outline of the same shape.

## Text
- [x] Preview must render with every font — use the font's own winding (nonzero),
      like a browser, instead of recomputing it.
- [ ] Per-stroke satin (medial axis) for truly crisp cursive lettering.

## Stitch quality / engine
- [x] Nonzero-winding fills (counters cut, overlapping script letters union).
- [x] Per-region + per-pass runs with jumps (no long carry stitches).
- [x] Satin column fill for lettering; split wide throws.
- [x] Lock/tie stitches, min-stitch filtering, underlay.

## UX / UI
- [x] Instant styled tooltips; keep them inside the window at the edges.
- [x] Collapsible panels; icon toolbar; alignment snapping + guides.
- [x] Multi-select + group move; double-click text edit; shapes menu.
- [x] "Fix stitches" smart cleanup.
- [ ] Audit every component for spacing/contrast/affordances consistency.
- [ ] Empty/loading/error states polish pass.

## Known correctness caveats
- [x] Within-row gap-crossing stitches in fills (over counters) — split fill +
      underlay runs at long travels so they jump instead (longest stitch now caps
      at the stitch length, verified ~4 mm on a donut).
- [ ] Proper fill travel: route around counters along the edge rather than
      jumping (fewer trims) — the "complex fill" upgrade.
- [ ] Realistic edit-render performance on very large designs.
