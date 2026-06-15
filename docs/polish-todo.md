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

## Text (PRIORITY — lettering must be top-notch; flat files only, never photos)
- [x] Preview must render with every font — use the font's own winding (nonzero),
      like a browser, instead of recomputing it.
- [x] Per-stroke satin (medial axis): rasterize → distance transform → Zhang–Suen
      thinning → satin column down each skeleton branch. Now PRUNES thinning spurs,
      SMOOTHS the staircased centerline, uses an EVEN column width, and edge-run
      underlay only (no wrong tatami hatching under letters). Column-fill fallback
      for shapes too small to skeletonize.
- [ ] Junction joins on complex glyphs; per-stroke width variation at terminals.
- [ ] Tune skeleton branch joins / corners on complex glyphs (B, R) — small gaps
      at junctions are acceptable for now.

## From user testing (2026-06-15)
- [x] Quick-start popup dismisses on outside-click / ✕ and doesn't return.
- [x] Hoop mockup: design previews inside a rounded embroidery-hoop frame with a
      user-chosen fabric background color (presets + custom).
- [x] Node tool: click a vertex to focus it, Delete removes it.
- [ ] STITCH QUALITY (top priority): auto-digitize still makes too many messy /
      irrelevant stitches; the dog logo's ring becomes a thick band. Needs lower
      density, thin-ring → satin/outline (not solid fill), and deliberate routing.
- [ ] "Clean up the stitching" button only changes params, not geometry — make it
      actually improve quality + give visible feedback (currently feels like a no-op).
- [ ] Colors don't reliably populate from a digitized image — audit palette path.
- [ ] Eraser tool; simpler/clearer toolbar + sidebars.
- [ ] Fabric *photo* backgrounds (not just color) for the mockup.

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
