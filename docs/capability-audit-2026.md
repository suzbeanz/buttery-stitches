# Buttery Stitches — Full Capability Audit vs Wilcom / Hatch (2026-07)

> **Progress log (2026-07-08).** Landed since this audit was written:
> - **Fixed the flagship-flow crash**: stray `process.env` debug refs in the A*
>   travel router broke every auto-digitize in the browser ("process is not
>   defined"); removed + a lint rule bans bare `process` in shipped source.
>   Verified fixed by driving the real app.
> - **Production data (§6)**: worksheet & Check panel now share one runtime
>   model (was 600 vs 700 spm), plus bobbin estimate and per-color thread
>   usage for spool ordering.
> - **Motif library (§5)**: 4 → 15 motifs in grouped picker (line/geo/nature).
> - **Editing (§4)**: boolean subtract/intersect exposed in the UI (hole
>   punching); numeric X/Y/W/H entry for the selection (also a keyboard-only
>   authoring path); fixed satin centerlines not scaling on resize.
> - **Thread content (§5)**: user-importable CSV/JSON thread charts, persisted
>   locally — real brand codes on the worksheet without shipping licensed data.
> - **Hooping (§6)**: rotate-hoop-90° button. **Sequencing**: one-click stable
>   "Sort by color" with a thread-change counter in the Stitch Order panel.
> - **Studio UX** (from a hands-on Playwright walkthrough): labeled
>   EXPORT/CLEAN UP/CHECK top-bar actions, machine-brand captions on export
>   formats, plain-language hints on Density/Angle/Pull comp/Underlay, honest
>   3D-toggle tooltip.
> - All 960 unit + 10 e2e tests green (e2e config now honors `CHROMIUM_PATH`
>   for sandboxed environments).
>
> **Progress log 2 (2026-07-09) — digitization depth.** Landed:
> - **Bézier tangent handles** (the #1 missing pro gesture): smooth nodes
>   carry explicit hIn/hOut; densifyRing honors them as Hermite tangents with
>   exact cubic-Bézier equivalence; draggable mirrored "ears" on the focused
>   node (Alt = cusp), seeded from the implied tangent so grabbing never jumps
>   the shape. Survive move/scale/rotate/resize/serialize.
> - **Editable satin columns** (missing gesture #2): drawn satins are now
>   node-backed on their CENTERLINE — move/insert/delete/curve/ears reshape
>   the spine and the rails rebuild at the set width. Engine equivalence
>   locked by test (identical stitches to the legacy path).
> - **Density heat overlay**: rasterizes the final stitch stream (1mm grid)
>   and paints caution→danger cells in stitch view ("Heat" toggle) — shows
>   *where* thread piles up (stacked objects, underlay + edge meetings), not
>   just which object's parameter is high.
> - **Tooling truth**: `npm run typecheck` was a silent no-op (tsc --noEmit on
>   a solution-style tsconfig validates nothing); now `tsc -b --force`, which
>   immediately caught a real error.
>
> Still open, in priority order: **sew-out calibration** (Tier 0.3 — needs a
> real machine), real third-party file fixtures + import fuzzing (0.2),
> Pyodide worker (0.1 — the CSP/self-hosted-wheel half already shipped),
> multi-angle-line fill networks, photo-stitch, multi-hoop splitting.

**Question asked:** can this be *as good as Wilcom / Hatch* for digitizing images into machine
embroidery files?

**Short answer:** the stitch **engine** is already genuinely competitive — in several
places it uses the same algorithms the pros do, and it's cleaner, deterministic, and
measurable in ways their code isn't. But "as good as Wilcom/Hatch" is **not primarily a
code problem**, and the biggest thing standing between this project and that claim is not
an algorithm — it's **validation**: nothing here has been calibrated against, or verified
by, a real machine sew-out, and it can't read a single real-world `.pes`/`.dst` file in an
automated test. Everything else (content, manual-editing depth, signature features) is
work, not mystery.

This audit reconciles the optimistic internal docs (`gap-audit.md`, `parity-roadmap.md`,
`tooling-comparison.md`) with a fresh, evidence-cited read of the code. It complements the
engineering audit in [`AUDIT.md`](../AUDIT.md) (CSP, Pyodide, tests, a11y) rather than
repeating it.

> A note on the target. "Wilcom/Hatch" is two tiers. **Hatch** is the hobby/mid product built
> on Wilcom's engine — *Hatch parity is a realistic goal for this project.* **Wilcom
> EmbroideryStudio e4** is the industrial flagship (chenille, multi-decoration, PhotoStitch,
> 200+ ESA fonts, team networking). Matching *that* is a multi-year surface. This audit
> aims the roadmap at **Hatch parity first**, flagging where the flagship pulls further ahead.

---

## Verdict by area (scorecard)

| Area | Where it stands vs Hatch | Confidence |
|---|---|---|
| **Core stitch engine** (fills, satin, underlay, comp, routing) | **~80–90%.** Genuine parity on the fundamentals; a few real math holes. | High — code-verified |
| **Auto-digitize (logos/line-art)** | **~70%.** Strong for clean, limited-color art; the review workflow is above entry tools. | High |
| **Auto-digitize (photos/thread-painting)** | **~0%.** Explicit non-goal today. The single largest auto-digitize gap. | High |
| **Manual digitizing depth** (the pro daily workflow) | **~50%.** Missing the two most-used pro gestures (Bézier handles, satin-rail reshape). | High |
| **Lettering / monogramming** | **~40%.** Good baselines; weak per-letter control, only 13 fonts, satin fonts unreliable. | High |
| **Thread & color content** | **~15%.** Excellent matching *math*, but 44 generic colors and zero real brand charts. | High |
| **File formats** | **~40%.** 5 formats vs 30+; non-DST/PESv1 gated behind a 10 MB WASM download. | High |
| **Hooping & production** | **~30%.** No multi-hoop, no rotation, no large-design split; thin worksheet. | High |
| **Validation against reality (sew-outs, real fixtures)** | **~5%.** The credibility gap. Math is unproven on fabric. | High |
| **Engineering / reliability** | See `AUDIT.md`. CSP currently breaks import + most exports *in production*. | High |

**One-line summary:** *the algorithms are largely there; the calibration, content, manual
finesse, and production plumbing are not.*

---

## 1. The credibility gap — this is the real blocker (Tier 0)

Everything the project claims about stitch quality is **deterministic math that has never
touched fabric.** That is simultaneously its most interesting property and its biggest
liability versus Wilcom/Hatch, whose real moat is *decades of empirical calibration tables*
distilled from millions of actual stitch-outs.

Three concrete, closeable problems make the "parity" claim unproven today:

1. **No sew-out calibration.** The internal `gap-audit.md` says it plainly: the pull-comp
   model's two constants (`PULL_STRAIN`, `BACKING`) are "physically plausible but not yet
   fit to a real sew-out," and predictive compensation is gated on calibrating them. Density
   (0.30–0.40 mm), underlay insets, pull-comp (0.2 mm default), fabric multipliers — all are
   reasonable textbook numbers, none are validated on a hoop. **Until a design is stitched
   on a real machine on real stabilizer and measured, "as good as Wilcom" is a hypothesis.**

2. **No real third-party file fixtures.** (Also `AUDIT.md` §6.1–6.3, HIGH.) The round-trip
   test only decodes bytes the app itself produced — a bug shared by the encoder and decoder
   is invisible — and there is *zero* proof the app can read a `.pes`/`.dst` produced by an
   actual machine or by Wilcom itself. For a tool whose whole job is machine-file
   interchange, this is the highest-value test to add.

3. **The deployed product is partly broken.** (`AUDIT.md` §1, HIGH.) The enforced
   Content-Security-Policy blocks the PyPI fetch that *every import* and *JEF/EXP/VP3/PES-v6/
   appliqué* export depend on. It works in dev, fails on GitHub Pages. You cannot be "as good
   as Hatch" while import is dead on the live site.

**None of this is exotic.** It's a stitch-out rig, a handful of licensed sample files, a
worker + CSP fix, and honest measurement. But it must come **first** — it's what turns the
engine's math from a claim into a fact, and it will surface real calibration errors the unit
tests can't.

---

## 2. Core engine — the genuine strength (~80–90%)

Evidence-verified. This is not a toy; it's a two-stage digitizer with hand-digitizer
heuristics most hobby tools lack.

**At or near parity (code-confirmed):**

- **Fills:** concavity-aware tatami with boustrophedon cells + geodesic connectors and
  ¼-brick stagger (`fill.ts:463`); contour/echo via distance-transform iso-contours
  (`contour.ts:125`); gradient/density-ramp + 2-color error-diffusion blend (`fill.ts:488,
  1029`); true relief carving (`fill.ts:1148`); and **three** directional-fill solvers —
  spine-march turning, per-limb flow, and a harmonic guidance field (`turning.ts`,
  `field.ts:339`) with coverage self-checks. The guidance field is *above* typical hobby tools.
- **Satin:** medial-axis auto-columns that track stroke width incl. tapers/serifs
  (`medial.ts:678`), density auto-tighten on width (AmeFird-style, `satin.ts:107`), wide-column
  split with deterministic seam-scatter, short-stitch inset on inner curves (`satin.ts:44`),
  auto width-scaled pull-comp.
- **Underlay:** center-run / edge-walk / zigzag tiered by width+weight, concavity-aware
  tatami underlay, +45° second pass on heavy (`underlay.ts:149`).
- **Routing:** nearest-neighbour + Or-opt block reordering, A* buried-travel over a coverage
  raster to hide jumps instead of trimming (`index.ts:1361`) — genuinely ahead of basic
  greedy tools; internal bench shows ~1 trim / 1000 stitches.
- **QA:** short/long-stitch, out-of-hoop, pucker-density, over-wide-satin, and a nice
  **buried-detail** warning via z-order analysis (`validate.ts:145`).

**Real engine gaps (math/behavior, not content):**

- **G1 — One angle per fill region.** Angle variation only comes from the *automatic*
  solvers; a digitizer cannot hand-partition a region into angle blocks or drop multiple
  guide lines (Wilcom's hallmark turning-fill workflow). No radial fill. (`turning.ts`,
  `field.ts`)
- **G2 — Curved-fill coverage hole.** The project's own sharpened metric shows curved
  (turning/field) fills at **~87%** coverage and contour at ~94% vs ~99% for flat — rows
  spaced along the spine spread apart on the outer radius. Curvature-aware density is the
  fix, and it's already scoped in `gap-audit.md` #4.
- **G3 — Heuristic (not calibrated) compensation.** Pull/push use fixed coefficients; no
  fabric-fitted distortion model (ties back to Tier 0).
- **G4 — Push comp on satin only,** not fills; single lock-stitch style; no user-set
  per-object entry/exit points.
- **G5 — Greedy routing,** not global — flattered by the current single-region-heavy bench
  corpus (`index.ts:207`).

---

## 3. Auto-digitizing — strong for logos, absent for photos (~70% / ~0%)

The image→stitch path is a *segment-then-vectorize* pipeline (k-means++ quantize → denoise →
imagetracerjs contours → classify → clean → objects), with genuinely nice touches:
stack-don't-carve small features (`stack.ts`), boundary underlap gap-proofing
(`underlap.ts`), idealization of repeats/congruent circles (`idealize.ts`), primitive
recognition, and an OCR + manual-retype + guided-original-letterform text path.

**The five real gaps:**

1. **No photo-stitch / thread-painting / gradient mode** — the biggest auto-digitize gap.
   Photos are *detected and warned about*, not converted. The engine already has
   `multiBlendFill`/gradient styles, but the digitizer never drives them. This is Hatch
   *PhotoStitch* / Wilcom photo-flash territory.
2. **Segmentation rides on imagetracerjs**, a general raster tracer, not a stitch-aware
   segmenter; photographic input fragments and Bézier fidelity is capped by the library.
3. **Shape classification is threshold-driven** (mean-width/elongation constants), not a
   true column/complex-fill/branch decomposition — junctions from the medial-axis satin can
   fray, and the user only gets a whole-color auto/satin/outline switch.
4. **No real thread libraries** to snap to (see §5).
5. **Almost no digitizing-parameter control** in the dialog — no per-region density, angle,
   underlay type, pull-comp, or stitch length before/after tracing.

---

## 4. Manual digitizing depth — the pro daily workflow is half-there (~50%)

For clean everyday work the toolset is broad (run/bean, satin, two-rail column, tatami,
appliqué, shapes, paint-bucket, measure, node add/delete + corner↔curve, alignment,
grouping, layer reorder). But the **two most-used professional editing gestures are missing**,
and a few routine ones are engine-only:

1. **No true Bézier tangent handles.** Node smoothness is a binary corner/smooth flag driving
   a cardinal spline (`nodes.ts:22`). A digitizer cannot drag a curve's tangent
   length/direction — the single most-used gesture in Wilcom Reshape.
2. **Satin columns aren't reshape-editable.** After creation a satin has no editable nodes
   (`objects.ts:41`); only a global width slider. You can't move a rail point, add/delete
   rung pairs, taper a stroke, or fix a twist — core satin work.
3. **Single stitch angle per region; no angle-line network** (see G1).
4. **Boolean subtract/intersect exist in code but aren't in the UI** (`boolean.ts:230` vs
   `PropertiesPanel.tsx:312`) — only same-color merge is exposed. No interactive hole-punch.
5. **Lettering lacks per-letter control** — text is one merged fill object with global
   spacing; no per-pair kerning, per-glyph reshape/rotate/baseline nudge, no envelope
   distortion; true per-stroke satin lettering is reliable only on the one authored flagship
   font (Oswald). 13 fonts vs hundreds of ESA fonts.

Secondary: no explicit underlay-*type* picker (edge-run/zigzag/lattice), pull-comp exposed
only on satin, no numeric angle/position/size entry, no user-set entry/exit points.

---

## 5. Content — excellent math, empty shelves (~15% thread, ~40% formats)

The *algorithms* around content are strong; the *content itself* is nearly absent. This is
pure work (some of it licensing), not insight.

- **Thread catalogs: one generic 44-color chart.** Matching is solid CIELAB ΔE and
  deliberately brand-agnostic so real charts drop straight in (`match.ts:42`), but the code
  explicitly declines to ship Madeira/Isacord/Sulky/Robison-Anton data. Result: the worksheet
  renders brand/code as "—" and can't tell a user which spools to buy — a *core* deliverable
  of pro digitizing. **This is the highest-value content gap.**
- **Formats: 5 write / 5 read** (PES, DST, JEF, EXP, VP3) vs 30–40. Only DST + PES-v1 are
  native TS; everything else — plus *any appliqué* (STOP) — needs a ~10 MB Pyodide download
  the code itself notes fails on memory-constrained mobile. No HUS/VIP/XXX/SEW/PCS/TAP.
- **Import doesn't re-digitize** — every stitch run becomes a raw running object with
  `Imported N` colors (`embImport.ts:33`); no "convert stitches to objects."
- **Motif/pattern library is a 4-shape stub** (wave/chevron/diamond/cross, `motifs.ts:31`)
  shared across motif-fill/motif-run/carve. No pattern editor, no pattern-within-satin.
- **Fonts:** 13 faces, no user font import, no ESA/BX embroidery-font support.

---

## 6. Hooping & production — thin (~30%)

- **No hoop rotation, no multi-hooping, no large-design splitting** — oversized designs are
  only *flagged* (`info.ts:65`), never split or tiled. Multi-hooping and alignment stitches
  are standard pro features, entirely absent.
- **8 generic hoop presets**, no brand/machine-specific hoop libraries.
- **Worksheet** is decent for the home tier (color sequence, swatches, per-stop counts) but
  lacks bobbin estimate, per-color thread usage (for spool ordering), needle assignments, and
  stabilizer/setup notes. Two runtime estimates disagree (600 vs 700 spm across
  `worksheet.ts` and `info.ts`).

---

## 7. Missing stitch types

- **Cross-stitch** — absent. First-class in Hatch.
- **Chenille** — absent. An entire Wilcom product tier (out of scope per internal roadmap,
  reasonable to defer).
- **Pattern-within-satin** (relief points inside a satin column) — absent.

---

## Prioritized roadmap

Ordered by *what actually blocks the "as good as Hatch" claim*, not by ease.

### Tier 0 — Prove the engine on reality (do first; unblocks every quality claim)
- **0.1** Fix the CSP so import + all exports work on the deployed site; move Pyodide to a
  Web Worker with abort/timeout (`AUDIT.md` §1, §2). *Without this the live product is
  partly broken.*
- **0.2** Commit real third-party `.pes`/`.dst` fixtures (with redistribution rights) + a
  Pyodide-backed import round-trip test; fuzz malformed bytes (`AUDIT.md` §6.1–6.3).
- **0.3** **Sew-out calibration loop.** Stitch a calibration design on a real machine,
  measure pull-in/registration, fit `PULL_STRAIN`/`BACKING` + density + underlay insets to
  the result. This is the one thing that converts "math parity" into *actual* parity.

### Tier 1 — Content parity (highest value/effort ratio; mostly work, not insight)
- **1.1** Ship real thread brand catalogs (Madeira/Isacord/RA/Sulky) — the matching engine
  already accepts them; this is a licensing/data-entry task with huge perceived value.
- **1.2** Expand the motif/pattern library (4 → dozens) + a simple pattern editor;
  pattern-within-satin.
- **1.3** More native formats (HUS/VIP/XXX/SEW) and native STOP so appliqué + JEF/EXP/VP3
  don't force the Pyodide path.
- **1.4** Lettering depth: per-pair kerning, per-glyph reshape/baseline nudge, reliable
  per-stroke satin for all fonts, more fonts, monogram frames.

### Tier 2 — Manual digitizing finesse (the pro daily gestures)
- **2.1** Bézier tangent handles on nodes (§4.1) — highest-impact editing change.
- **2.2** Editable satin rails: move rail points, add/delete rungs, taper (§4.2).
- **2.3** Multi-angle-line networks per fill region + radial fill (G1).
- **2.4** Expose boolean subtract/intersect + a hole-punch tool (§4.4).
- **2.5** Numeric entry (angle/position/size) and per-object entry/exit points.

### Tier 3 — Signature capability & the coverage math
- **3.1** Curvature-aware density to close the ~87% curved-fill coverage hole (G2) — already
  scoped internally, now measurable.
- **3.2** **Photo-stitch / thread-painting mode** — the flagship differentiator; drive the
  existing blend/gradient fills from a photographic segmenter.
- **3.3** Multi-hooping + hoop rotation + large-design splitting.
- **3.4** Density heatmap overlay; richer worksheet (bobbin, per-color usage, needle/setup);
  reconcile the runtime constants.

### Tier 4 — Reach / defer
- Cross-stitch (if targeting that market); chenille (large, likely out of scope);
  global-optimal routing; a true fabric-simulation-in-the-loop optimizer.

---

## Bottom line

Buttery Stitches is a **remarkably strong engineering achievement** — the engine is
algorithmically credible, deterministic, and (uniquely) measurable, and for clean logo/text
digitizing on a well-calibrated setup it can already produce good files. The internal claim
of "math parity with the commercial leaders on the fundamentals" is **largely defensible from
the code.**

But "as good as Wilcom/Hatch" is decided by four things the code alone can't deliver:
**(1) proof on real fabric** (calibration + real fixtures — Tier 0), **(2) content** (threads,
fonts, motifs, formats — Tier 1), **(3) manual finesse** (Bézier + satin-rail editing —
Tier 2), and **(4) signature features** (photo-stitch, multi-hooping — Tier 3). The good news:
almost none of it is a research problem. It's a stitch-out rig, a data-entry effort, a
handful of editing tools, and one genuinely new feature. Do Tier 0 first — everything else is
built on believing the stitches.
