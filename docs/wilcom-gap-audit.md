# Surpassing Wilcom — Capability-Gap Audit

Status: living document. Companion to the benchmark harness (`bench/`, `npm run bench`).
Grounded in a full read of `src/lib/engine/`, `src/lib/trace/`, `src/lib/text/`,
`src/lib/export/`, and the editor (`src/components/`). File references are the
evidence; the goal is a **prioritized, measurable** path — not a feature wishlist.

## How to read this

Each area lists what *this* engine does (with a file anchor), what Wilcom does, the
gap, and **the benchmark metric that proves the gap closed**. A gap with no metric is
flagged `needs metric` — we don't claim to beat Wilcom on anything we can't measure.

Three kinds of gap, kept distinct because they have very different cost:
- **Math** — where a solved problem beats Wilcom's heuristics. *This is the moat.*
- **Content** — fonts, thread catalogs, specialty stitch types. Work, not insight.
- **UX/Polish** — surfacing/looks. Cheap, high perceived value.

## Verdict (TL;DR)

**The fundamentals are already at math-parity with Wilcom**, and in a few places use
literally the same method (PCA + 16-angle fewest-fragments grain — Wilcom's own
auto-digitize rule — `fill.ts:296`; medial-axis satin with width-model pull comp;
concavity-aware boustrophedon tatami with geodesic routing). This is not a toy.

Wilcom's remaining leads are mostly **content and polish**, not algorithmic
superiority — closeable by work. The genuine algorithmic openings, where "pure math"
can *surpass* rather than match, are five: **(1)** directional guidance fields,
**(2)** global stitch routing, **(3)** a physical pull-compensation model, **(4)**
coverage guarantees, **(5)** simulation-in-the-loop. The benchmark already points a
finger at #1 and #2.

---

## STATUS — all five leapfrogs now implemented & benchmarked

The five openings above went from claims to measured implementations (see the
roadmap section for the per-item detail and PRs):

| # | Leapfrog | Implementation | Measured |
|---|---|---|---|
| 1 | Directional field | `engine/field.ts` — harmonic-sweep isolines, default for curved bands | curved fill follows the form |
| 2 | Global routing | `engine/index.ts` — NN + Or-opt + per-object direction | scatter travel −32%, lines −35% |
| 3 | Physical pull-comp | `bench/distortion.ts:precompensate` | landed-vs-target 0.26 → **0.02 mm** |
| 4 | Coverage guarantee | sharp thread-footprint metric + curvature-aware/contour spacing | curved 87→95%, contour 94→96% |
| 5 | Simulation-in-the-loop | `bench/distortion.ts` mass-spring fabric model | `pullIn(mm)` predicts ~0.2 mm on a solid fill |

**Current benchmark** (`npm run bench`, 13 designs): flat fills ~99% coverage, curved
95%, contour 96%, lettering 96%; travel ≤6% on scattered work; predicted pull-in
0.006–0.26 mm scaling with shape solidity.

**The frontier is no longer code — it's calibration.** The pull model's two constants
(`PULL_STRAIN`, `BACKING`) are physically plausible but not yet fit to a real
sew-out. Default-on predictive compensation (warping exported `.dst/.pes`) is gated
on (a) calibrating those from a test stitch-out and (b) reconciling with the engine's
existing heuristic `pullComp`. That, plus a 2-thread fabric mesh for cross-stitch
gathering, is the next real milestone.

---

## Capability matrix

### Fills — **parity, with two measurable holes**
| Capability | This engine | Wilcom | Gap | Metric |
|---|---|---|---|---|
| Tatami, concavity-aware | Boustrophedon cells + geodesic (Dijkstra) connectors, ¼-brick + jitter stagger (`fill.ts:463,876`) | Same class | none | `coverage`, `lenCV` ✓ |
| Contour / echo | Distance-transform iso-contours, spiral order (`contour.ts:120`) | Contour/spiral | none | `coverage` ✓ |
| Turning / flow | Rows ⟂ medial spine; multi-limb flow (`turning.ts:176,341`) | Stitch-along-form | **leaves end-gaps** | `coverage` = **97.6%** on crescent |
| Gradient, blend, motif, carve, line-art | All present (`fill.ts`, `index.ts:707,783,792`) | All present | none–minor | `coverage`, `short%` |
| Programmable/fancy/“stamp” fills | motif + carve only | Large pattern library | **content** | `needs metric` |

The turning/flow coverage shortfall is the single clearest *math* gap in fills — and
the first proof point for the directional-field work below.

### Satin — **parity; one content gap**
Medial-axis column gen, density auto-tighten on width, curvature compensation
(advance-whichever-rail-leads), wide-column/​corner split with seam-scatter, short-
stitch inset on concave bends (`satin.ts:187`, `medial.ts:481`). **Missing: raised/3D/
foam satin** (content). Metric: `short%`, `lenCV`; raised satin `needs metric`.

### Underlay — **parity**
Center-run / edge-walk / zigzag tiered by width+weight for satin; edge+perpendicular
parallel pass for fill, concavity-aware (`underlay.ts:79,139`). Wilcom exposes more
named presets; the coverage is equivalent. Underlay *quality* is currently unmeasured →
`needs metric` (a registration/distortion proxy, see #5).

### Stitch direction / grain — **parity (same algorithm)**
PCA principal axis + 16-candidate fewest-fragments search + grain tiebreak
(`fill.ts:296`), one coherent angle per object, manual `directionDeg` + painted
`flowPath` overrides. This *is* Wilcom's method. The leapfrog is to go **beyond** it
(a solved field, below), not to catch up.

### Compensation & fabric — **parity in model, gap in fidelity**
Width-dependent pull comp `clamp(0.1+0.12·w)` + push trim, fabric/thread multipliers
(`satin.ts:148`, `profile.ts`). Wilcom uses richer experience tables. Both are
*heuristic*; neither predicts distortion from first principles → the physical-model
opening (#3). Metric: `needs metric` (predicted-vs-target distortion).

### Routing / sequencing — **good, but greedy (the big math opening)**
Per-region travel order + run order via nearest-neighbor **+ 2-opt**, A* buried-travel
on a coverage raster, trim-vs-slash by coverage test (`index.ts:189,1185,1064`). Solid,
but explicitly **greedy + local search, not global** (`index.ts` notes). Wilcom’s
auto-sequence is also heuristic — so a real optimizer can *beat both*. Metric:
`travel(mm)`, `travel%`, `jumps`, `trims` — currently flattered by a single-region
corpus; **broaden the corpus to expose it**.

### Special stitches — **content gap**
Have: appliqué, bean/triple, motif runs (`index.ts:637,537`, `fill.ts:1174`). Missing:
cross-stitch, candlewick, chenille, sequins, ripple/spiral. Pure content. `needs metric`.

### Auto-digitize — **strong; parity-ish**
K-means++ saliency-aware quantize, majority denoise + island consolidation,
imagetracer contours, Douglas-Peucker, shape recognition (circle/ellipse/rect/polygon)
+ idealization (regularize repeats, unify circles), stroke-vs-fill + medial satin-vs-
tatami, OCR→clean lettering via tesseract (`trace/*`). Comparable to Wilcom’s
auto-digitize for logos/line-art. Photo→stitch realism is where commercial tools (and
ML) still lead. Metric: `needs metric` (trace fidelity vs source raster).

### Lettering — **good core; content gap**
opentype.js, 13 curated faces, multi-line, arch/circle/path layout, authored-centerline
junction handling for the flagship (Oswald, 64 glyphs) (`text/*`). Missing vs Wilcom:
large font library, true monogramming, pairwise kerning tables, baseline/envelope
effects. Mostly **content + UX**. `needs metric`.

### Output / formats — **parity for the common set**
pes/dst/jef/exp/vp3 with correct Tajima ternary + per-format stitch caps + auto-split,
color/stop/trim, 8 hoop presets (`export/index.ts`, `hoops.ts`). Missing: more formats,
**automatic multi-hoop splitting**, format-specific stitch-type optimization. UX/content.

### Validation / QA — **solid; not visualized**
Stitch-length, hoop bounds, density, satin width, large-fill-no-underlay, total count
(`validate.ts:47`); design estimator (`info.ts`). Missing: **density heatmap**, and the
deeper QA the benchmark adds (coverage, travel%, lenCV). UX + `needs metric`.

### Editing / Simulation — **rich editor; 2D preview**
Paint-bucket, satin/satin-2, pencil/brush, shapes, appliqué, cut, measure, direction-
paint, flow-spine, node reshape (smooth/corner), weld/merge/split/outline/align
(`CanvasStage.tsx`, `nodes.ts`, `PropertiesPanel.tsx`). Preview is a layered-2D
“TrueView” (fuzz + lit core + fiber strands), per-stitch scrub (`render-stitches.ts`).
Missing: numeric angle entry, Bézier handles, true 3D/physical thread sim. UX + #5.

---

## Where we already match or beat Wilcom
- **Grain math is identical** (PCA + fewest-fragments) — parity by construction.
- **Concavity handling** (boustrophedon + geodesic, never-slash guarantees) is
  first-class and *self-validating* (`hasExposedSegment`), which many tools don’t do.
- **Routing already does 2-opt + A* buried travel** — ahead of basic greedy tools.
- **Determinism**: same input → same stitches, which makes the benchmark *possible*.
  A reproducible engine is a strategic asset Wilcom’s stochastic fills don’t have.

## Where Wilcom leads — and whether it’s a moat
- **Content** (fonts, brand thread catalogs, specialty stitches, 3D foam): *not a moat*
  — backlog, ship opportunistically. No math advantage to be had.
- **Polish** (auto-hoop-split, density heatmap, monogram UI, numeric angle): cheap UX
  wins; do as fast-follows.
- **The hard ones** (global routing, physical distortion, photo-realistic auto-digitize,
  sim realism): *these are where math decides the winner.* Target them deliberately.

## The leapfrog thesis (pure math)
Wilcom is decades of heuristics + lookup tables. We are already at parity on the
fundamentals, **with a reproducible engine and a metric harness** — the two things Wilcom
can’t easily retrofit. So we don’t win by re-implementing their feature list; we win by
replacing heuristics with **solved problems** on the five fronts below, each scored.

## Prioritized roadmap (leverage × tractability)

1. **Directional guidance field** *(math; high leverage, medium effort)*
   Generalize turning/flow into a smooth vector field solved over the shape (harmonic /
   principal-curvature / geodesic, boundary-aligned) and stream rows along it. Subsumes
   turning + flow + manual flow as special cases; closes the coverage hole and improves
   smoothness. **Metric: `coverage` → ~100% on `crescent`; `lenCV` down.** First proof
   point already in the baseline.
   - **Prototype shipped + tuned** (`engine/field.ts`, opt-in `fillStyle: "field"`):
     harmonic sweep potential (Laplace/SOR) + masked marching-squares isolines spaced
     by `density·|∇u|`, assembled into in-order serpentine strips (break-on-gap) with
     even-division (`ceil`) resampling + dedup. Genuine wins vs `turningFill`: **>4mm
     stitches 2 vs 30** and pile-ups eliminated, with `lenCV`/`short%` at parity.
   - **CORRECTION (sharper coverage metric).** The earlier "coverage 98.5% > 97.6%"
     field win was a **measurement artifact** of the coarse coverage raster. With the
     accurate thread-footprint metric (see below), `crescent-turning` and
     `crescent-field` are **both 87.1%** — equal. The field's real value is generality
     (one method subsumes turning/flow) + form-following direction; it did **not**
     improve coverage and it adds an SOR solve. Whether it stays the default vs reverts
     to opt-in should be revisited once the curved-fill coverage gap (below) is closed.
   - **Promoted to the auto path.** The field is now the default wherever `turningFill`
     engages (a curved single-spine band); turning is kept as the fallback when the
     field's coverage self-check declines, and `flowFill` still handles branchy shapes.
     Full-corpus A/B: **only the curved band changed (coverage 97.6%→98.5%); every
     other design byte-identical** (turning declines round/straight shapes, so the
     field is never invoked there). Follow-ups: perf (the SOR solve runs per curved
     fill — cache / coarsen for interactive edits) and extending the field to branchy
     shapes (replacing flowFill too).

2. **Global routing optimizer** *(math; high leverage, medium effort)*
   Model fill rows as required edges (Rural-Postman / min-cost matching) and inter-object
   jumps as TSP; replace greedy+2-opt. **Metric: `travel(mm)`, `travel%`, `trims`, `jumps`.**
   - **Done (object level).** `routeGroups` (the design-level cross-object sequencer) was
     pure greedy nearest-neighbour; it now seeds with NN and refines with **Or-opt**
     (relocate chains of 1–3 objects — reversal-free, so a group's underlay→top order and
     appliqué STOPs stay intact, which a 2-opt reversal would break). New corpus stressors
     `scatter-dots` (NN-trap) + `multiregion-grid`. Result: **scatter-dots travel
     220.5 → 150.6 mm (−32%)**, two-discs 65.8 → 23.5 mm; coverage unchanged. Region/run
     ordering already had 2-opt (`orderByTravel`/`orderByNearest`).
   - **Done (start/end-aware).** The block orderer now chooses each *reversible* object's
     sewing DIRECTION too — entering a running line / no-underlay shape from whichever end
     is nearer (greedy nearest-PORT seed + Or-opt with per-object flips). Reversal is gated
     to objects without underlay/STOP so underlay→top order and appliqué stay correct.
     New `scatter-lines` corpus: **travel 228.9 → 149.3 mm (−35%)**; underlaid `scatter-dots`
     correctly unaffected.
   - **Lettering corpus added** (`letteringProject`, real Oswald via the bench runner):
     `lettering-STITCH` measures the #1 embroidery job — **99.8% coverage, 5 trims for 6
     glyphs, 4% travel**. Confirms satin lettering covers and routes tightly (the high
     `short%`/`lenCV` are inherent to satin's dense throws, not a defect).
   - **Next:** the within-region Rural-Postman framing for fill rows.

3. **Physical pull-compensation model** *(math; high value, higher effort)*
   Fabric as an elastic sheet + thread tension; solve predicted distortion, pre-distort
   geometry to land on target; calibrate constants from one test sew-out. **Metric (new):
   predicted-vs-target boundary error.** Requires #5’s simulator.

4. **Coverage as a guarantee** *(math; medium)*
   Adapt density to curvature + layering to hit a target opacity with minimum stitches.
   **Metric: `coverage` at fixed `stitches` (efficiency frontier).**
   - **Metric sharpened (prerequisite done).** The coverage raster now models the real
     thread footprint (accurate point-to-segment distance, 0.15 mm cells) instead of a
     fat square stamp that read ~100% for everything. The frontier is now visible: a
     disc holds ~99% at density 0.4 (rows just touch the 0.4 mm thread) and falls to
     83% at 0.5, 73% at 0.6 — so the default density is already on the frontier (no
     over-stitching to recover). **What it newly exposes: real under-coverage** the old
     metric hid — **curved fills 87% (turning & field), contour 94%, small shapes/
     lettering 94–96%**. Flat fills are genuinely ~99%.
   - **Next (the real win):** close the curved-fill gap — rows are spaced by `density`
     along the spine, but the OUTER edge of a curve spreads wider, leaving gaps. Space
     rows by the spacing needed at the widest radius (curvature-aware density). Now
     measurable, and it lifts both turning and the field.

5. **Simulation-in-the-loop** *(math + infra; enables 3 & 4)*
   A physical thread/penetration model → honest preview **and** a loss function to optimize
   against (gaps, ridging, registration drift). **Metric (new): distortion/registration.**

Fast-follow UX/content (parallel, cheap): numeric angle entry, density heatmap (we already
compute coverage), auto multi-hoop split, more fonts/thread catalogs.

## Metrics we still need to add
The harness measures economy/efficiency/coverage today. To score the roadmap we need:
- ~~Multi-region + lettering corpus entries~~ **(done)** — scatter-dots/lines, multiregion-grid, lettering-STITCH.
- ~~Accurate fill-coverage~~ **(done)** — thread-footprint raster; revealed real under-coverage on curved/contour/small fills.
- **Trace-fidelity** metric: stitched raster vs source image (auto-digitize quality).
- **Distortion/registration** metric from the simulator (#3, #5) — the one that finally
  scores “does it sew out true,” which is ultimately how you beat Wilcom on a hoop.

---

*Bottom line: stop trying to out-feature Wilcom. We’re already even on the math that
matters and ahead on reproducibility + measurement. Win by turning five heuristics into
solved, scored problems — starting with the directional field the benchmark is already
asking for.*
