# Professional Digitizing Spec — Authoritative Rebuild Reference

The single source of truth for rebuilding the Buttery Stitches digitizing engine to
professional sew-out standard. Synthesized from 9 research pillars (commercial and
open-source digitizing tooling, industry educators, and machine-vendor bulletins) and
cross-checked against our current engine (`src/lib/engine/`, `src/lib/bench/`).

Companion docs: [`engine-internals.md`](./engine-internals.md), [`gap-audit.md`](./gap-audit.md).

---

## 1. Executive summary — what separates pro from naive

A naive engine converts pixels/vectors to stitch coordinates. A professional engine
treats a design as an **ordered graph of parameterized objects** and runs a
**physics-aware generation pass** that respects four invariants the machine and the
fabric impose. Five principles capture the whole difference:

1. **The needle and the fabric set hard physical limits, and they are enforced, not
   suggested.** A stitch shorter than the needle diameter (~0.8 mm for a 75/11) punches
   a hole already full of thread → thread shred, bird-nest, needle break, *machine jam*.
   A satin float wider than ~7 mm snags. Density tighter than the thread can clear
   perforates and puckers. Pros encode these as floors/caps the generator can never
   violate — including **after** lock-stitch and connector insertion, which is exactly
   where our current engine leaks (see §4).

2. **Every stitch deforms the fabric; the geometry is pre-distorted to compensate.**
   Thread tension pulls fabric inward across the stitch axis (pull) and shoves it
   outward along the axis (push). Columns are widened, fill rows extended, and the
   amount scales with width and fabric stretch. Without this, circles sew as eggs,
   counters close, and adjacent objects gap.

3. **Stitches sit on a foundation, never on raw fabric.** Underlay (chosen by cover
   type + width + fabric) binds fabric to stabilizer, lofts the cover off the weave,
   and gives the top a cross-grain grid to grab. It runs *first*, *inset*, and at a
   *different angle* to the cover.

4. **Stitch type is chosen by local shape width, and coverage is a guarantee.** Width
   < ~1.3 mm → run/bean; ~1.3–7 mm → satin (split or convert above ~7 mm); wider/
   irregular → tatami. Density and angle are set so the thread footprint actually
   covers the region (measured, not assumed).

5. **The whole design is one engineered path.** Objects are sequenced bottom-up /
   inside-out / center-out; connectors are chosen by distance (hidden travel < jump <
   tie-off+trim+tie-in); ties bracket every trim and color change; pathing minimizes
   trims, color changes, and registration drift. Anchoring (tie-in/tie-off) is not
   optional polish — an unlocked start or a trim with no preceding lock is the #1 cause
   of unraveling and bird-nesting.

The moat is that all of this is **derived from an object model** (geometry + property
bag) so a fabric/size change re-stitches correctly — a flat stitch list (DST/PES)
cannot. Generation is a deterministic downstream pass, which makes the benchmark
possible.

---

## 2. Per-pillar spec — rules + parameters the engine MUST encode

### Pillar 1 — Underlay

| Cover type / condition | Underlay | Key params |
|---|---|---|
| Satin column ≤ ~2 mm | Center-run only | 1.5–2.0 mm stitch len, 1 pass, no inset |
| Satin 2–3.5 mm | Edge-run / contour | inset **0.4–0.6 mm**, 1.5–2.0 mm len |
| Satin > ~4 mm | Edge-run + zigzag | zigzag ~45° off cover, **cap max throw**, sparse spacing |
| Satin ~6–8 mm+ / pile fabric | Edge-run + double-zigzag ("German") | two opposing-angle passes |
| Large fill | Edge-walk perimeter + perpendicular fill | underlay row spacing **2.0–3.0 mm** (~3× top), len 3.0–4.0 mm, 90° to top (or 45/135 lattice) |

Universal rules:
- Underlay runs **at a different angle** to the cover (perpendicular preferred for
  fills; ~45° offset for zigzag under satin). Never parallel — it sinks into the
  troughs and gives no support.
- Underlay is **inset 0.4–0.6 mm** from the finished edge so it stays hidden.
- **Cap the zigzag underlay max stitch length** so loose throws don't float/destabilize.
- **Scale up for unstable/lofty fabric** (fleece: double; terry: zigzag even on thin
  columns; pique: prefer double-zigzag). **Scale down for stable wovens** (center-run
  only on thin borders). Heavier underlay (0.8–1.2 mm spacing) lets you *lower* top
  density to keep the hand soft.
- Order within a multi-type underlay: **zigzag/tatami underlay BEFORE edge-run**, both
  before cover (else the later wide zigzag pulls the edge-run inward and ruins the border).

### Pillar 2 — Push/Pull compensation

| Column width | Pull comp (total width add) |
|---|---|
| 2 mm | ~0.15 mm |
| 5–6 mm | ~0.25–0.30 mm |
| 7 mm | ~0.30 mm |
| Stretchy pique/knit | up to ~0.40 mm |

| Fabric class | Pull comp baseline |
|---|---|
| Wovens / denim / canvas | ~0.20 mm (minimal) |
| Cotton tee / polo | ~0.20–0.26 mm |
| Knit / jersey / fleece | 0.35–0.40 mm |
| Pique / performance / very stretchy | up to 0.40 mm |
| Leather / coated | minimal comp + sparse spacing 0.6–0.8 mm (tear-out) |

Rules:
- Implement as a **width-graduated curve**, not a constant. Support **both** absolute
  (mm/side) **and** percentage-of-width (e.g. 110%) modes, combinable, asymmetric,
  accepting negatives.
- **Small/thin columns:** switch to a fixed offset and a small-column boost so a thin
  column reaches a **minimum sewable width ~1.0–1.2 mm**. Per-side add =
  (target_safe_width − measured_width)/2.
- **Fills:** extend row endpoints past the digitized edge on penetration sides; overlap
  adjacent objects ~0.2 mm (stable) to ~1.0 mm (high-stretch).
- **Circle→egg fix:** apply comp on the axis perpendicular to stitch direction and/or
  rotate fill angle. Keep fill angle ≥15–20° off horizontal when a satin border runs
  along a flat edge (prevents row-splitting).
- Drive comp from a **fabric profile** (stretch class) bound at generation time, not a
  global constant. Pair with underlay; never solve pull by comp alone. Manage push by
  capping satin width (~8–10 mm) and splitting, not over-densifying.

### Pillar 3 — Density & stitch length

| Quantity | Value |
|---|---|
| Default coverage spacing (satin & tatami) | **0.40 mm** (4 pt / 63.5 SPI) for 40 wt |
| Denim/twill/canvas | 0.30–0.40 mm |
| Cotton tee / polo | ~0.38–0.40 mm |
| Knit / jersey / fleece | 0.45–0.60 mm |
| Silk / fine woven | 0.55–0.70 mm |
| 3D foam / puff | 0.16–0.22 mm |
| 60 wt fine | ~0.30–0.35 mm | 30 wt | ~0.45–0.50 mm | 12 wt | 0.6–0.8 mm |
| Underlay spacing | ~2× top (1.5–4 mm) |
| **Min stitch length (run/satin)** | **floor ~0.5 mm; target ≥ needle dia (0.8 mm); green zone 1.5–3.0 mm** |
| Max fill/run stitch length | 3–4 mm (tatami), 1.5–3 mm run |
| Min satin width | ~1.0–1.5 mm (below → run/bean) |
| Max single satin stitch | ~7 mm garments, 10–12 mm specialty → auto-split |

Rules:
- **Auto-vary satin density with column length** (open on short stitches, tighten on
  long); auto-tighten as columns widen.
- **Enforce a minimum-stitch-length filter** that drops/merges sub-threshold stitches
  globally (a common default 0.1 mm; recommend ≥0.3 mm). **This must run after all
  insertion passes (ties, connectors), not just per-object.**
- **Short-stitch handling on curves/corners:** shorten + inset penetrations on the
  inner edge of a turn (a typical short-stitch distance default 0.25 mm), stagger.
- Match needle to thread/stitch length; knockdown fill on fuzzy fabric before detail.

### Pillar 4 — Satin vs tatami vs run/bean (width-driven type selection)

| Width | Type |
|---|---|
| < ~1.3–1.5 mm | running → double → triple/bean (3,5,7 passes) |
| ~1.3–6/7 mm | satin column |
| > ~6–7 mm (or large/irregular/holed) | tatami fill |

- Crossover lowers to 5–6 mm on stretchy/wearable; raises to 10–12 mm on stable goods.
- **Auto-split satin** above the cap: no needle-to-needle span > ~7 mm; **stagger/
  randomize split points** so no straight perforation seam appears; denser underlay
  under split satin.
- **Min tatami stitch ~4 mm** (sub-4 mm wrinkles after wash); never force tatami into
  narrow shapes — use satin or run.
- Tatami defaults: stitch len 2.5–4 mm, density 0.25–0.4 mm row spacing, ~45° angle,
  brick/staggered penetrations, edge-walk to define borders.

### Pillar 5 — Tie-in / tie-off / trims / jumps / travel

| Element | Value |
|---|---|
| Tie-in / tie-off cluster | **2–3 penetrations, each segment clamped 0.5–1.5 mm**, placed INSIDE the object |
| Lock styles | half-stitch (default), back-forth, star, cross, triangle, bowtie, zigzag |
| Scale | 100% / ~0.7 mm; larger on heavy/loose fabric & thick thread, smaller on fine 60 wt / small lettering |
| Collapse length (no jump below) | **~3.0 mm** (a common default) |
| Connector tiers | gap < collapse → hidden travel/needle-up; collapse ≤ gap < trim → jump; gap ≥ trim → **tie-off + trim + tie-in** |
| Trim threshold | 5–12 mm (tool-dependent); machine auto-trimmers only cut 5–50 mm |
| Travel-run stitch length | 1.5–2.5 mm, routed ≥1 stitch inside boundary so it's hidden |

Hard rules:
- **A tie-in on the first 2–3 stitches of EVERY object, inside the boundary.** The first
  penetration has no prior stitch holding the tail.
- **A tie-off before EVERY trim, color change, or stop.** Knot-before-trim.
- **Always bracket a trim with tie-off (before) AND tie-in (after).** Never trim naked.
- **Eliminate sub-1 mm stacked/zero-length stitches near ties, corners, direction
  changes** — clamp the tie cluster itself to 0.5–1.5 mm segments so it never piles
  penetrations into one hole.
- Prefer hidden travel/underpath over jumps; minimize total jumps/trims by pathing.
- Per-object override flags: `force_lock`, `ties` (both/before/after/neither),
  `min_jump_stitch_length`.

### Pillar 6 — Fill artistry (angle, directional fills, travel, single-path flow)

- Default fill angle **45°**; assign a **distinct angle per adjacent region** (vary
  15–90°) for contrast and to spread pull across fabric axes.
- **Directional fills for organic shapes** (curved/contour/guided/circular/ripple): the
  angle turns to follow the form; shorter stitch length = smoother curves.
- **Staggered brick penetrations** (stagger 2–4 rows; offsets 0.25/0.25 = even); never
  align penetrations into a tear-line/groove.
- Underlay perpendicular to top, ~3× spacing, inset, lengthened on pile.
- **Route all travel as buried underpath** inside the not-yet-filled body (or under an
  adjacent satin); use trims only when a run would be unavoidably visible.
- **Each region flows as one path**: entry near previous object, exit near next; "skip
  last stitch in each row"; odd centerline-underlay repeat so a column ends on the
  start side.

### Pillar 7 — Auto-digitize pipeline (raster/vector → stitches)

Pipeline: (1) **clean/flatten** bitmap (quantize to small palette, sharpen, denoise);
(2) **color-reduce** to flat regions (cap 2–8 colors typical); (3) **despeckle / hole
removal** (drop detail < ~1 mm, holes < ~1.0–1.3 mm); (4) **region/centerline detection
by local width** (skeletonize → run < 1 mm / satin 1.4–7 mm / turning-satin on curves /
tatami wider); (5) **assign stitch type + density + underlay + pull comp + splits +
short-stitch**; (6) **sequence** center-out with ties; (7) **flag/refuse** photos,
gradients, soft shading — auto output is a *draft* requiring cleanup.

| Limit | Value |
|---|---|
| Min renderable detail / stroke | ~1 mm (needle+thread) |
| Min satin column | ~1.4 mm (letter openings ≥0.8 mm) |
| Min letter height (satin) | ~4–5 mm (below → run or finer thread) |
| Closing overlap on fill | ~2 mm |

### Pillar 8 — (covered within above; sequencing detail)

Sequencing rules (Pillar from research #7 "sequencing"):
- **Color-block** same-color objects (target = #distinct colors), except where layering/
  registration forces a split.
- Order **bottom→top, inside→outside**: underlay → bg fill → secondary fills → top
  fills → detail satins/runs → registration outlines → small text (outlines/text last).
- **Center/seam outward** to push distortion to the unstitched perimeter.
- Choose **entry/exit so each object's exit is near the next object's entry**
  (nearest-pair); snap before regen.
- **Locality constraint:** keep registering pairs (outline↔its fill, text↔its box)
  sequentially close.
- Auto-sequence = constrained TSP/nearest-neighbor over entry/exit ports + edge
  underpathing + distance-based trims. Auto Start/End clear of the hoop frame.

### Pillar 9 — Object-based data model

- Design = **ordered list of objects**; each object = geometry (control points / Bézier
  corner-vs-curve nodes, independent stitch-angle lines, explicit entry/exit) **+
  property bag** {stitchType, density, underlay[], angle, pullComp, leadIn/out, tieIn/
  off, trim}.
- **Stitches are generated lazily** from geometry+properties; the editable model is the
  source of truth. Export a flattened stitch list (DST/PES/EXP/JEF/VP3) only at machine
  output.
- Reshape/re-angle/re-density/swap-type/resequence all recompute stitches
  non-destructively.
- **Density/underlay/pull-comp are fabric-profile-driven, bound at generation time** —
  changing fabric re-stitches the whole design without geometry edits.

---

## 3. Gap analysis — current engine vs spec

Rated **good** (at/above spec) / **partial** (present but incomplete or mis-tuned) /
**missing**.

| Pillar | Current behavior (file ref) | Rating | Gap to spec |
|---|---|---|---|
| **1 Underlay** | Tiered center/edge/zigzag by width+weight; fill edge-run + perpendicular concavity-aware pass; zigzag-before-edge order honored; inset 0.5 mm (`underlay.ts:79,139,157`); zigzag throw capped at `UNDERLAY_MAX_THROW=6` | **good** | No double-zigzag/"German" preset; no lattice (45/135) fill underlay; weight is `light/standard/heavy` not bound to a fabric stretch class; underlay quality unmeasured |
| **2 Pull/push comp** | Width-graduated `clamp(0.1+0.12·w, 0.2..0.7)` + fabric `scale`; push = end-trim on open columns (`satin.ts:148,162`); plus physical inverse `precompensate` (`bench/distortion.ts`) **not default-on** | **partial** | No percentage-of-width mode; no min-sewable-width floor / small-column boost (thin columns can sew skinny); fill pull comp / edge overlap not explicit; circle-axis comp not modeled; physical model uncalibrated & off |
| **3 Density & stitch length** | Default density per profile, `MIN_SAFE_DENSITY=0.3`, auto-tighten on width (`satin.ts:100`); satin ≤7 mm; per-run `dropShortStitches` (0.5 mm; satin 0.3 mm); `MAX_STITCH_MM=5` split; short-stitch inset on curves (`satin.ts:44`) | **partial** | **No global min-stitch gate after tie/connector insertion** — `collapseCoincident` only drops <0.05 mm (§4); thread-weight→density not modeled; min-stitch on inner curve relies on satin module only |
| **4 Type selection** | width<1.2 → run, 1.2–7 → satin, >7 → tatami (`classify.ts:157`); medial satin w/ coverage gate (0.82) → tatami fallback; wide/corner split with seam-scatter (`satin.ts:244`) | **good** | Bean stitch present but not an auto run→bean escalation by width; no min-tatami-width guard to avoid tatami in narrow shapes |
| **5 Ties/trims/jumps** | Auto tie-in at run start, tie-off before trim & at end; `TIE_COUNT=3`, `TIE_AMPLITUDE=0.8`; bite capped to neighbor distance (`index.ts:101,1453,1469,1497`); jump>3 mm, trim via coverage A* buried travel | **partial → DANGEROUS** | **Tie cluster has NO lower clamp (0.5 mm) and is inserted AFTER per-run short-stitch filtering; only <0.05 mm coincidents removed → 0.1–0.5 mm penetration pile-ups at every object start/end = jam source (§4).** No lock-style options; no per-object force/suppress ties; collapse-vs-jump tiers exist but tie clamp missing |
| **6 Fill artistry** | Harmonic guidance field for curved bands, contour rings, turning/flow, gradient/blend/motif/carve; geodesic connectors never slash a notch; buried travel A* (`field.ts`, `contour.ts`, `fill.ts`, `index.ts`) | **good** | Curved-fill coverage 87% (outer-edge rows spread — curvature-aware density not done); per-adjacent-region angle variation not automatic; "skip last stitch in row" not implemented |
| **7 Auto-digitize** | k-means quantize, denoise, imagetracer, Douglas-Peucker, shape recognition, stroke-vs-fill + medial, OCR lettering (`trace/*`) | **good** | No explicit despeckle-by-physical-min (<1 mm) gate documented; no min-letter-height downgrade to run; photo/gradient rejection not surfaced |
| **8 Sequencing** | Region/run order NN+2-opt; cross-object NN+Or-opt with per-object direction; color blocks preserved; buried travel (`index.ts:1031,1088`) | **good** | No explicit bottom→top/inside→outside/center-out layering policy; locality constraint for registering pairs not enforced; no Auto Start/End hoop-frame guard; greedy not global (Rural-Postman within region pending) |
| **9 Object model** | Project = objects with geometry + per-object props; `designFor` regenerates lazily & memoizes; export flattens (`index.ts:1602`, `export/*`) | **good** | Fabric profile exists (`profile.ts`) but not a full stretch-class binding all of {underlay choice, pull comp, density}; no Bézier-handle / numeric-angle editing surfaced |

---

## 4. Prioritized rebuild roadmap

Ordered by **impact on real sew-out quality and jam/break prevention**. Items P0–P1
prevent physical machine failures; P2–P4 are quality; P5+ are polish/content.

### P0 — Tie-cluster penetration pile-up (CAUSED A PHYSICAL JAM) 🔴

**Root cause.** `tieStitches()` (`index.ts:101`) builds a 3+ penetration cluster
(`[near, anchor, near, anchor]`) where `bite = min(TIE_AMPLITUDE=0.8, neighbor
distance)`. On dense satin/fill the neighbor distance is ~0.3–0.4 mm, so the tie lays
**multiple penetrations 0.3–0.4 mm apart** — below the needle diameter. These clusters
are inserted in the **assembly pass** (`index.ts:1453,1469,1497`), *after* the per-run
`dropShortStitches` filter has already run. The only post-insertion cleanup is
`collapseCoincident` with `COINCIDENT_EPS = 0.05 mm` (`index.ts:1544`) — it drops only
*exact* overlaps, **not** the 0.1–0.5 mm danger zone. Result: a pile of sub-needle
penetrations at every object start, end, and trim → the needle re-pierces laid thread →
shred / bird-nest / **jam**.

**Fix:**
1. **Clamp every tie segment to 0.5–1.5 mm** (a relative-lock rule). If the
   neighbor stitch is shorter than 0.5 mm, the tie must still throw a *full* 0.5 mm
   segment (back along the run direction), not collapse onto the anchor.
2. **Run a global minimum-stitch-length pass AFTER all insertion** (ties + connectors +
   capping): merge/drop any real (non-jump) segment < ~0.5 mm. Raise `COINCIDENT_EPS`
   handling into a proper min-stitch filter, or add `dropShortStitches(out, 0.5)` as the
   final step before `capStitchLength`.
3. Add lock-style options + per-object `force/suppress ties` and size scale.

**Validate:** benchmark `stitchLen.min ≥ 0.5 mm` and `shortPct` (< 0.8 mm) drops toward
0 on every corpus design (already computed in `bench/metrics.ts:21`); add an assertion
test that **no two consecutive real penetrations are < 0.5 mm apart anywhere in the
stream**, run over the full corpus + lettering. Physical: sew the lettering + dense-fill
sample on the machine that jammed; confirm clean starts/stops, no nest.

### P0 — Global minimum-stitch-length gate as a hard invariant 🔴

Generalize the fix above into an enforced floor over the **final** stream (the spec's
"enforce a minimum stitch length after all passes"). Today min-stitch is only applied
per-object before assembly; ties, buried-travel insertions, and split points can
re-introduce shorts. This is the single highest jam/break lever.

**Validate:** corpus assertion (`stitchLen.min`), plus a regression test that injects a
worst-case dense satin with many trims and asserts the floor holds.

### P1 — Min sewable satin width + small-column pull-comp boost

Thin columns (< ~1.0–1.2 mm) currently sew skinny / break thread. Add a min-sewable
width floor: below it, either boost width to ~1.0–1.2 mm via a fixed pull offset
((target−measured)/2 per side) or convert to run/bean. Auto-escalate run→bean by width.

**Validate:** new corpus entry with 0.8–1.2 mm columns; assert resulting satin width
≥1.0 mm or type==run; check `shortPct` and thread-break proxy. Physical: thin-script
sample.

### P1 — Short-stitch / inner-curve handling as a stream invariant

Satin module insets inner-curve stitches (`satin.ts:44`) but tatami/contour/field and
travel insertions don't share a guarantee. Add stream-level short-stitch leveling on
the inside of tight turns (stagger inner penetrations) and verify no inner-curve
pile-up.

**Validate:** `lenCV` and `shortPct` on tight-curve corpus (crescent, small letters);
no inner-radius penetration cluster < 0.5 mm.

### P2 — Fabric stretch-class profile binding {underlay, pull-comp, density}

Replace the `light/standard/heavy` underlay weight + ad-hoc `scale` with a single
**fabric profile** (woven/denim/cotton/knit/pique/fleece/terry/leather/foam) that sets
underlay choice, pull comp curve, and density together, overridable per object (Pillar
2/9). Add percentage-of-width pull-comp mode and explicit fill edge-overlap.

**Validate:** snapshot stitch deltas per profile on a fixed design; `pullInMm` from
`bench/distortion.ts` should fall as comp rises on knit profiles.

### P2 — Curvature-aware fill density (close the 87% curved-fill coverage gap)

Space rows by the spacing needed at the **widest radius** of a curve so the outer edge
stays covered. Lifts both turning and field fills.

**Validate:** `fillCoverage` on `crescent`/curved corpus → ~95–99% at fixed density;
`stitches` not inflated (efficiency frontier).

### P2 — Double-zigzag / lattice underlay presets + per-adjacent-region angle variation

Add German (edge+double-zigzag) and 45/135 lattice fill underlay; auto-vary fill angle
between touching regions.

**Validate:** underlay-quality proxy via simulator (registration/`distortMaxMm`);
visual A/B on pile-fabric sample.

### P3 — Layering & locality sequencing policy

Encode bottom→top / inside→outside / outlines+text-last / center-out, plus a locality
constraint keeping registering pairs adjacent in the path, and Auto Start/End clear of
the hoop frame.

**Validate:** broaden corpus to multi-layer designs; `travelMm`, `trims`, registration
proxy; assert outlines sequence after their fills.

### P4 — Within-region global routing (Rural-Postman) + auto multi-hoop split

Replace greedy+2-opt within-region row routing with the min-cost framing; add automatic
multi-hoop splitting at output.

**Validate:** `travelMm`/`travelRatio` on multiregion corpus; hoop-bounds validation.

### P5+ — Content & polish (parallel, cheap)

Lock-style library UI, numeric angle entry, density heatmap (coverage already computed),
more fonts/thread catalogs, 3D foam satin, specialty stitches (cross/candlewick/chenille/
sequins), trace-fidelity metric, photo→stitch realism.

---

## 5. How each item is validated

Two validation channels: **benchmark metric** (`npm run bench`, `bench/metrics.ts`,
deterministic corpus) and **physical sew-out** (the ultimate ground truth, required for
anything touching the fabric-physics constants or a jam fix).

| Roadmap item | Benchmark metric (automated) | Physical sew-out |
|---|---|---|
| P0 tie pile-up | `stitchLen.min ≥ 0.5`; `shortPct→0`; new assertion: no consecutive real pair < 0.5 mm over full corpus + lettering | Re-sew the jamming lettering + dense fill; confirm clean ties, no nest |
| P0 global min-stitch gate | `stitchLen.min` floor holds after injected worst-case (dense satin + many trims) | Dense, trim-heavy sample |
| P1 min satin width / small-col comp | New 0.8–1.2 mm corpus: assert width ≥1.0 mm or type==run; `shortPct` | Thin-script lettering |
| P1 short-stitch invariant | `lenCV`, `shortPct` on tight-curve corpus; no inner-radius cluster < 0.5 mm | Crescent / small-letter sample |
| P2 fabric profile binding | per-profile stitch-delta snapshot; `pullInMm` falls as knit comp rises | Same logo on woven vs knit |
| P2 curvature-aware density | `fillCoverage` ~95–99% on crescent at fixed `stitches` | Curved-band sample (gap check) |
| P2 double-zig/lattice underlay | registration/`distortMaxMm` proxy | Pile-fabric (fleece/terry) sample |
| P3 sequencing policy | `travelMm`, `trims`, registration proxy; ordering assertions (outlines after fills) | Multi-layer logo (registration) |
| P4 global routing / multi-hoop | `travelMm`, `travelRatio`; hoop-bounds validation | Large multi-region design |
| P5+ content/polish | trace-fidelity (new), coverage heatmap visual | as applicable |

**Calibration dependency.** The physical pull model's constants (`PULL_STRAIN`,
`BACKING` in `bench/distortion.ts`) must be fit to a real test sew-out before
default-on predictive compensation; until then heuristic `pullComp` remains the
shipping path. Every physics-touching item (P2 onward) is gated on at least one
calibrated sew-out.

---

*Bottom line: the engine is already at math-parity with the commercial leaders on
fills, satin, grain, routing, and the object model. The rebuild's first job is not new
capability — it is closing the **physical-safety leaks** (P0: tie-cluster pile-ups and a
missing global min-stitch gate) that just caused a machine jam, then the **physics
fidelity** items (min width, fabric profiles, curvature-aware coverage) that decide
whether a design sews out true on a hoop.*
