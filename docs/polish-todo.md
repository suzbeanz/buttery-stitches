# Buttery Stitches — polish & quality running list

Working toward a Hatch-by-Wilcom-level, open-source embroidery digitizer. This is
the living audit/polish list: check items off as they land.

## Stitch quality — crisp & intelligent (2026-06-15)
- [x] Satin DENSITY COMPENSATION on curves: throws are placed by advancing until
      whichever rail (the outer one on a curve) has moved one stitch spacing, so
      the convex edge stays evenly covered instead of fanning into gaps and the
      concave edge packs tighter — crisp, professional satin. Locked with a
      rail-gap test; coverage stays 0.97–1.00 across the fonts.
- [x] Intelligent routing: a region's satin strokes are sewn in nearest-neighbor
      order (reversing a stroke when its far end is closer) so the needle takes
      the shortest path — fewer, shorter jumps. Pure reordering, geometry intact.
      Verified: "Butters" exports to all 5 formats, longest stitch 5.5mm.
- [ ] Next quality passes to consider: inset fill edge-underlay so it hides under
      the top layer; smart tatami angle (principal axis) for broad fills;
      corner mitering on very sharp satin turns.

## Full codebase audit (2026-06-15)
Three-way audit (engine/correctness, React/UI/state, cross-cutting hygiene).
Baseline: typecheck clean, lint 0 errors / 12 a11y warnings, 240 tests green.

Fixed:
- [x] Coincident (0 mm) penetrations: assembled design now passes through
      `collapseCoincident`, dropping same-hole punches where a tie cluster ends on
      the run's start point or a fill span is narrower than the stitch spacing.
- [x] Undo/redo left `selectedIds` pointing at deleted objects → ghost
      Transformer/Properties. Store now reconciles selection whenever the object
      set changes.
- [x] Editor shortcuts (tool keys, Space, p) leaked through open modals → guarded
      on `[aria-modal]`.
- [x] `useTemporalStore` selector returned a fresh object each call → TopBar
      re-rendered on every undo-stack tick. Wrapped in `useShallow`.
- [x] `finishDraft` read colors via a stale render closure (could silently drop a
      shape) → reads fresh store state.
- [x] American-spelling fixes (labelled/normalise/serialising/stabilising).
- [x] Removed 10 unused `@expo-google-fonts/*` deps (fonts ship as bundled .ttf).
- [x] Fixed stale `CONTRIBUTING.md` "README roadmap" reference.

Deferred — now done:
- [x] Hoist `generateDesign()` to one memoized source: `designFor(project)` shared
      by the canvas, validation, exporter, and worksheet.
- [x] `satinUnderlay` resamples rails to a common count before centerline/edge runs.
- [x] Douglas–Peucker rewritten iteratively (no deep stack / per-level allocs).
- [x] Commit name/color text edits on blur (one undo step per rename).
- [x] Added "salted red" to the Tailwind theme; swapped arbitrary red classes.
- [x] `manualChunks` splits Konva into its own vendor chunk (chunk warning gone).
- [x] Dialog focus: move focus into the dialog on open, restore on close
      (`useDialogFocus`), applied to the text, image, and help dialogs.

Still open (need a decision or are larger):
- [ ] Counters that *graze* their outer ring aren't cut out (`ringContains` needs
      all sampled points inside) — risk: changing it could re-break script unions.
- [ ] Full Tab focus-trap inside dialogs (initial/restore focus done; trapping Tab
      cycling skipped — needs browser verification). Keyboard path for layer
      drag-reorder (still mouse-only).
- [ ] Single shared palette module for the Konva/printable-HTML hex literals
      (Tailwind side can't import it without a loader).
- [ ] Run Playwright e2e (the export path) in CI — currently unit-only.

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
- [x] HOMEPAGE THEMING: rebuilt as a printed butter wrapper — navy press-ink on
      cream paper (primary), a "salted" red stamp + eyebrow accents (occasional),
      butter-yellow as a tertiary highlight (icon chips, step circles), and the
      butter-stick ruler tick lines used liberally as section dividers/trim.
- [x] Skeleton quality: chained skeleton segments straight through junctions, so
      an s / serif stems stay one smooth stroke instead of fragmenting. Lettering
      satin coverage jumped to 65/65 regions across all 8 fonts (poppins "s"
      0.63 -> 1.00; playfair serifs 0.79 -> 1.00). Verified export: playfair
      "Goose" fully satin, longest stitch ~7mm, all 5 formats valid.
- [x] Clicking an add/edit action (Use a picture, Add words, Add shape, edit
      text) now switches the user from Stitch view back to Edit view.
- [x] LETTERING (was: horrible flat tatami): lettering now defaults to SATIN
      that follows each stroke's medial axis — rebuilt medial.ts with
      variable stroke width, closed-loop handling (o/e/a/d counters stitch all
      the way around), and edge overshoot. The engine measures coverage and only
      ships satin when it actually fills the glyph (>=82%), otherwise falls back
      to a solid tatami fill, so text is never broken. Verified: all 8 fonts
      sewable; "Goose" exports to all 5 formats with longest stitch 6.75mm.
- [x] Skeleton on S-curves and serifs (was a follow-up): fixed by chaining
      segments through junctions — the "s" and serif stems now satin cleanly
      (65/65 regions across all 8 fonts; verified export ~7mm longest).
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
- [x] Drag-to-select (marquee/box select): with the Select tool, dragging on
      empty canvas draws a rubber-band rectangle (butter fill, dashed navy) and
      selects every object it grazes on release; a tiny drag is treated as a
      click and clears. Pure helpers in src/lib/marquee.ts, unit-tested.
- [x] HOOP MOCKUP rebuilt to match the reference: a light greige PLASTIC machine
      hoop (not wood) — rounded-square double frame with a seam channel, a
      mounting-bracket arm with a slot on the left, a silver tension screw at the
      bottom, and centering registration ticks.
- [ ] STITCH-VIEW PLAY still shows an empty frame — playback never reveals
      stitches. Investigate SimulatorBar rAF + simIndex/simTotal + StitchView
      reveal; it must animate from 0 and actually draw.
- [ ] Footer: "Made With ❤️ by Suz" linking LinkedIn
      (https://www.linkedin.com/in/suzie-schmitt/) and GitHub
      (https://github.com/suzbeanz/).
- [ ] Homepage / landing with sections: About, What Buttery Stitches Does, How
      to use it (marketing page in front of the editor).
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
