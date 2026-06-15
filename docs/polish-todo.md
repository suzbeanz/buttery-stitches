# Buttery Stitches — polish & quality running list

Working toward a Hatch-by-Wilcom-level, open-source embroidery digitizer. This is
the living audit/polish list: check items off as they land.

## Auto-digitize (flat image → embroidery) — the big one
- [x] Anti-aliasing fringe became dozens of thin "running" objects — drop short
      thin slivers; only keep long strokes as running.
- [x] Despeckle harder + blur the source to merge fringe (fewer, cleaner objects).
- [x] Raster segmentation pre-pass: median-cut quantization flattens the image to
      N solid colors BEFORE tracing, so each color is a clean solid region (no
      anti-aliasing fringe). Own quantizer — no RgbQuant dependency needed.
- [x] Smart per-region stitch type on import: auto-digitize now runs the
      "Fix stitches" cleanup automatically (satin for thin strokes, tatami for
      broad, safe densities, color-grouped order).
- [x] De-dupe: avoid a fill AND a running outline of the same shape (now
      all-fills, one object per color).
- [x] Stitch order: largest fills first so small details land on top.

## Text
- [x] Preview must render with every font — use the font's own winding (nonzero),
      like a browser, instead of recomputing it.
- [x] Per-stroke satin (medial axis): rasterize → distance transform → Zhang–Suen
      thinning → satin column down each skeleton branch (variable width from the
      distance transform). Falls back to a column fill for tiny shapes.
- [ ] Tune skeleton branch joins / corners on complex glyphs (B, R) — small gaps
      at junctions are acceptable for now.

## Accessibility & foolproof (mission: pro power, free, for everyone)
- [x] Guided quick-start empty state: big "Use a picture / Add words / Draw it"
      buttons so a first-timer knows exactly what to do.
- [x] Dialogs are keyboard-accessible: Escape closes; role="dialog" + aria-modal +
      aria-label for screen readers; backdrop-click closes only on the backdrop.
- [x] Plainer language on key actions (Use a picture, Add words, Clean up the
      stitching, Print thread list).
- [x] Only ship fonts that actually work (foolproof picker).
- [ ] First-run tour / inline tips for advanced params (what & why, plainly).
- [ ] Bigger touch targets + calmer "advanced" grouping; full contrast pass.

## UX / UI
- [x] Toolbars wrap on narrow screens instead of clipping tooltips/menus.
- [x] Tall dialogs scroll on short/mobile screens (max-height + overflow).
- [ ] Deeper mobile pass: tune tap targets / type scale on phones.

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
- [ ] OPTIMIZATION (not correctness): route fill travel around counters and/or
      reorder fill sub-runs to cut jumps. Current output is correct (jumps are
      short, no long stitches); this just reduces jump count.
- [x] Realistic edit-render performance: skip per-stitch preview for very dense
      objects (>4000 stitches), keeping the solid body + outline.
