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
- [x] Lettering defaults to a clean, solid TATAMI fill — reliable and correct for
      every font (matches the solid design-view render).
- [ ] Auto-satin that follows each stroke: medial-axis prototype exists
      (engine/medial.ts) but produces broken stitches on real letters, so it is
      DISABLED by default. Needs: skeleton quality on wide/serif glyphs, junction
      handling, and column ordering before it can be the default or an option.
- [ ] Tune skeleton branch joins / corners on complex glyphs (B, R) — small gaps
      at junctions are acceptable for now.

## From user testing (2026-06-15)
- [x] Hoop mockup only in Stitch view (the physical preview), made realistic
      (wood ring + tension screw + fabric + inner rim); edit view is a plain
      working surface.
- [x] "Draw it" quick-start button now works (dismisses + selects a tool).
- [x] Per-object "Stitch style: Solid fill (tatami) / Satin columns" picker so the
      user curates which shapes/fonts satin cleanly (curated-satin approach).
- [ ] Bundle a couple of monoline/open-source fonts that satin cleanly + flag
      them satin-capable so "Add words" defaults to satin where it looks good.
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

## Jot-down (2026-06-15) — to do next
- [x] Extend the butter-stick rulers in BOTH directions (positive and negative):
      rulers now run the full canvas with 0 on the hoop origin, and the bright
      butter band + edge markers show exactly where the usable hoop area (the
      size limit) stops.
- [x] Much more comprehensive synthetic user testing: src/test/journeys.test.ts
      walks complete journeys (add words, all 8 fonts, shapes + satin outline,
      clean-up, delete/undo/redo, multi-move, save/reopen) and asserts sewable
      output. It immediately caught a real app-wide bug: resampleByDistance added
      the carry instead of subtracting it, so every long straight edge (underlay
      runs, running stitches, satin centerlines) emitted one monster stitch
      (up to ~19 mm). Fixed in engine/resample.ts.
- [ ] Drag-to-select (marquee/box select): drag on empty canvas to rubber-band
      a selection rectangle and select every object it touches. (No such tool yet.)
- [ ] Foolproof for 60+: every action obvious and forgiving; plain words; no
      dead-ends; nothing that needs explaining twice.
- [ ] Keep growing the journey suite: cover the image-import path (quantize →
      trace → fix) and color-population once those settle.

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
