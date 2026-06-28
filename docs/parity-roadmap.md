# Parity roadmap — "all the professionalism of the leading commercial suite"

Grounded in the two articles the user shared (identical content). They credit
the market leader's success to **six concrete pillars**. Out of scope by the user's call:
**sending designs to machines** (Wi-Fi/network) — we only export files, as today.
Also out of scope: multi-decoration (screen print, cutting, chenille, Coloreel)
and 3D puff/foam, unless asked.

## The article's 6 pillars → where we stand

| # | Commercial-suite pillar (article) | Our equivalent today | Status |
|---|---|---|---|
| 1 | **EMB format** — a rich native format that stays fully editable, switch properties per design/fabric | `.embproj` (objects + vectors + params + now editable nodes) | ✅ have — strengthen |
| 2 | **Quick Design Resize** — resize with per-stitch min/max safeguards; filters bad stitches; keeps quality | Vector objects regenerate stitches at any size; machine-safety floors in engine | ⚠️ partial — **build the resize UX + safeguards + imported-stitch recalc** |
| 3 | **Fabric Assist Tool** — pick fabric → auto density / stitch length / underlay / push-pull comp | Fabric profiles (woven/knit/pile/sheer) scaling density, pull, underlay | ✅ have — expand + name it |
| 4 | **Embroidery-Specific Alphabets (ESA)** — fonts built for embroidery that resize without quality loss; plus shapes/glyphs/fills | Live-digitized OFL fonts (regenerated at any size = resize-quality) | ⚠️ partial — **build lettering depth (baselines, spacing, monogram); expand fonts** |
| 5 | **Auto-assign stitch properties** — auto stitch type + parameters from shape size | Classifier (inscribed-thickness → running/satin/tatami) + `fixStitches` auto-clamps | ✅ have — polish + surface |
| 6 | **Auto-Branching** — auto-sequence/branch to cut jumps, trims, travel | Travel routing (intra-object travel, nearest-neighbor order, fabric-aware trims) — 234→~3 per 1000 | ✅ have — add explicit "re-sequence/branch" command |

**Takeaway:** we already match 4 of the 6 (1, 3, 5, 6). The two real gaps are
**#2 Quick Resize** and **#4 lettering depth**. The rest of "professionalism" is
the broader commercial feature surface below.

## Beyond the article (the rest of full commercial-grade professionalism)

- **Realistic preview** (the "realistic-render"-style mode) — photoreal thread rendering, not just
  a stitch-redraw player.
- **Thread/color brand libraries** — Madeira/Isacord/etc. charts, nearest-thread
  matching, color reduction on import/trace.
- **Design elements / decorative effects** — motif fills, pattern fills, gradient
  (density) fills, carving stamps, radial/spiral; motif runs / e-stitch outlines.
- **Design Info & validation depth** — density map, accurate stitch/runtime
  estimate, hoop-fit check, thread-break risk warnings (we have DesignCheck +
  worksheet to build on).
- **Templates & hooping** — hoop library, multi-hoop, reusable design templates.
- **Design organizer/library + batch** — browse, manage, batch export.
- **Stability & performance at scale** — large designs stay smooth.

## Phased plan

### Phase 1 — close the two named gaps + make our matches first-class
> **Status:** ✅ Quick Resize node-sync (resize/align/distribute carry the node
> model); ✅ Lettering depth (multiline + arch baselines, persisted & re-editable);
> ✅ `.embproj` round-trip hardened (nodes/text-arch/appliqué/satin verified).
> Fabric Assist (picker), Auto stitch-type (Clean up), Auto-branch (engine
> routing) already shipped — naming/surfacing pass remains.

1. **Quick Design Resize** (pillar 2): a "Resize design" control (target W×H or %)
   that re-runs the engine (vector objects recalc stitches automatically) AND, for
   imported raw-stitch designs, rescales with min/max stitch safeguards; surface
   resize warnings via the existing validator. *Verify: metric probes (longest
   stitch ≤ limit, density in range) before/after resize; CPython export.*
2. **Lettering depth** (pillar 4): text baselines (straight, **arch/circle**,
   envelope), letter **spacing/kerning**, multiline, and **monogram** frames;
   expand the OFL font set. *Verify: layout unit tests; journey "all fonts sewable".*
3. **Name & expose the matches**: a labeled **Fabric Assist** picker (expand the
   fabric library), an **Auto stitch-type** indicator, and an explicit
   **Re-sequence / Auto-branch** command (one-click travel optimization). *Verify:
   existing engine tests + new resequence test.*
4. **Strengthen `.embproj`** (pillar 1): guarantee full round-trip re-editability
   (nodes, params, text specs) and a version migration path. *Verify: round-trip test.*

### Phase 2 — decorative professionalism + thread/color + validation depth
> **Status:** ✅ Thread management (CIELAB chart matching + agglomerative color
> reduction, "Threads" panel); ✅ decorative fills — gradient/ombré, **motif fill**
> (wave/chevron/diamond/cross, tiled + clipped), **motif runs** (motif repeated
> along a line), and **true-relief carving** (needle skips the carve motif, leaving
> un-stitched grooves the fill floats over — safe, reads best where curves cross
> the rows); ✅ Design Info & estimator (thread length, run-time, hoop-fit). **Phase
> 2 complete.**

5. **Thread brand libraries**: Madeira/Isacord/etc. palettes, nearest-thread match,
   and color reduction on trace/import. *Verify: pure matching tests.*
6. **Decorative fills & motif runs** (the "design elements" category): motif fill,
   pattern fill, gradient/density-gradient fill, carving stamp, radial/spiral;
   motif/e-stitch outlines. *Verify: engine coverage/longest-stitch probes.*
7. **Design Info & validation depth**: density heat-map, stitch + runtime estimate,
   hoop-fit, thread-break risk. *Verify: pure-metric tests.*

### Phase 3 — polish & scale
> **Status:** ✅ Realistic realistic-render preview (tube-shaded thread, "3D" toggle);
> ✅ batch export (all formats → one .zip); ✅ expanded hoop library (8 common
> machine sizes). Remaining: design templates, multi-hoop splitting, a design
> organizer/library, and deeper performance work for very large designs.
8. **Realistic preview** (realistic-render-style thread shading). ✅
9. **Templates & hooping** — hoop library ✅; multi-hoop + design templates remain.
10. **Batch export** ✅ (.zip of all formats); design organizer/library remains.
11. **Performance at scale** — stitch preview is a single canvas Shape already;
    very-large-design rendering/playback virtualization remains.

## Verification reality (how we keep it honest)

We test headlessly: pure-function unit tests, **CPython `pyembroidery`** export
checks across all five formats, and metric probes (trims+jumps/1000, coverage,
longest stitch, density). Inherently visual items — realistic-render rendering, the *look*
of lettering and decorative fills — need the user's eye on the deployed build; the
plan calls those out so we tune by sew-out, not by guess.

## Out of scope (per the user)

- **Machine connectivity** (send-to-machine / Wi-Fi) — we export files only.
- Multi-decoration (screen print, cutting, chenille, Coloreel) and 3D puff/foam —
  unless requested later.
