# Buttery Stitches — Stitch Logic (the digitizer's brain)

The real-world decision logic a master digitizer carries in their head, written
down so the engine can apply it automatically. Goal: given any shape, the engine
should pick the stitch type, texture, density, angle, underlay, and compensation
that a pro would — and sew clean, every time.

Reference conditions: 40-wt poly/rayon thread, standard needle, stabilized woven
fabric. All numbers are millimeters. "Density" = gap between rows (smaller =
denser). Adjust by fabric (see §8).

---

## 1. The primitives (what each stitch is FOR)
- **Running** — a single line of needle penetrations along a path. Outlines,
  fine detail, stems, travel/underlay, redwork. Stitch length 1.5–3 mm (2.5
  typical). *Bean/triple* (back-and-forth ×3) for a bolder visible line.
- **Satin (column)** — zig-zag throws across a narrow column; smooth and shiny,
  catches light. Lettering, borders, thin tapering shapes, stems. Throw width
  ~1–7 mm. Below ~1 mm use running; above ~7 mm it's loose → split-satin or fill.
- **Tatami / fill** — parallel rows of running stitch packed to cover an area,
  brick-staggered so holes don't line up. Any broad solid area. The workhorse.
- **Textures (fill variants)** — tatami (brick), satin sheen, *contour/echo*
  (rows follow the outline — organic shapes, petals), *radial* (from a center),
  *motif/pattern* (decorative), *gradient density* (fades).

## 2. THE CORE DECISION: which stitch for a shape?
Drive it off the shape's **mean width** `w = 2·area / perimeter`, its **length**,
**aspect ratio**, **area**, and its **role** (outline vs body vs lettering).

```
if it's an open path (no area)            → RUNNING   (or bean if "bold")
else (closed area):
  w < 1.0 mm                              → RUNNING down the centerline
  1.0 ≤ w ≤ 7 mm  AND  length/ w ≥ ~2     → SATIN column along the medial axis
  1.0 ≤ w ≤ 7 mm  AND  roundish (low AR)  → small TATAMI (satin would be stubby)
  w > 7 mm  (or area is large)            → TATAMI fill
  very long + uniformly thin (w<2, len>30)→ SATIN, but split if width spikes
```
Extra rules:
- **Lettering**: same width rule, but a glyph is a *region of strokes* — satin
  each stroke via its medial axis; fall back to tatami where the skeleton/width
  isn't satin-clean (junction-heavy, serif slabs, bold faces > ~3.5 mm strokes).
- **Borders/outlines on a fill**: satin if 1–4 mm wide, else running.
- **Tiny shapes** (< ~1.5 mm any dimension, dots): single satin throw or a few
  running tacks — never tatami (too few rows to read).
- Always prefer the type that gives **enough rows to read** (≥ ~3) and **throws
  that aren't dangerously long** (≤ 7 mm).

## 3. Parameters per type (the real numbers)
| type | density (row gap) | stitch length | max single stitch | notes |
|---|---|---|---|---|
| Running | — | 1.5–3 mm (2.5) | ≤ 4 mm | bean = ×3 pass |
| Satin | 0.35–0.45 (0.4) | — | throw ≤ 7 mm | denser for small text (0.35) |
| Tatami | 0.40–0.45 | 3.5–4 mm along row | row run ≤ ~4 mm | brick offset = stitchLen/2 |
- Small text (< 6 mm tall): density 0.35, satin.
- Big satin (5–7 mm): density 0.4–0.45 (too dense = thread piles).
- Metallic/specialty thread: ~15% less dense.

## 4. Stitch ANGLE
- **Satin**: throws are perpendicular to the stroke centerline (engine: yes).
- **Tatami**: rows at a chosen angle. Pro default ~**15° or 45°**, NOT 0°/90°
  (axis-aligned rows show as obvious banding along straight edges). Best:
  orient to the shape's **principal axis**, or vary per region so adjacent fills
  don't share an angle. Lettering tatami fallback: ~45°.

## 5. UNDERLAY — the difference between amateur and pro
Underlay stabilizes fabric and gives the top stitches loft. Choose by type+width;
run it **first**, **inset ~1 mm** from the edge so it never peeks out, at a
**low density (~2–2.5 mm)** that scales loosely with the top.
- **Satin underlay** (by column width):
  - `< 2 mm`: **center-run** only.
  - `2–4 mm`: **center-run + edge-walk** (a run ~1 mm inside each rail).
  - `> 4 mm`: **zig-zag underlay** (or center + edge), spacing ~2–2.5 mm.
- **Fill underlay**:
  - **Edge-run** around the perimeter, inset ~1–1.5 mm.
  - **+ a parallel pass perpendicular to the top angle** (or a zig-zag), density
    ~2.5–4 mm, so the top rows have something to bite into.
  - Large fills: edge + **double-zig-zag** (criss-cross).
- Thin running shapes: usually no underlay.

## 6. COMPENSATION (so the sewn shape matches the drawn shape)
- **Pull compensation** — stitches pull the fabric *toward the line of stitching*,
  so a satin column sews **narrower** than drawn and a little **longer**. Fix:
  widen satin rails by **pull-comp** (≈ 0.2–0.4 mm total; more on knits/large
  columns). Fills: extend the shape slightly **perpendicular to the row angle**.
- **Short stitches on curves/corners** — on the **inner (concave)** edge of a
  curve, the throws bunch; on the outer edge they gap. Add intermediate
  penetrations so the **outer edge spacing stays ≤ density** (density
  compensation). Engine: done in medial satin; **not yet in user satin objects**.
- **Satin corners** — at a sharp turn, miter/cap the column and add a tack so the
  outer corner isn't a long loose stitch and the inner doesn't pile.
- **Push** — dense fills push outward at the far end; trim the leading edge or
  add a tiny inset.

## 7. SEQUENCING & ROUTING (clean stitch-out)
- **Color order**: group by thread color to minimize trims (engine: yes).
- **Layer order**: underlay → fills → details/borders → small/topmost last
  (engine: regions largest-first; broadly yes).
- **Travel**: keep needle moves short; hide travels under later fills; jump+trim
  only when a move is long. Order sub-shapes/branches nearest-neighbor (engine:
  yes within a region; could be global).
- **Tie-in / tie-off** at the start of every thread run and before each trim
  (engine: yes). **Min stitch** ≥ 0.5 mm; drop/merge shorter (engine: yes).

## 8. FABRIC & THREAD MODIFIERS (multipliers on the above)
| fabric | density | underlay | pull-comp |
|---|---|---|---|
| Stable woven (default) | ×1.0 | standard | standard |
| Knit / stretch (tee) | ×0.9 (denser) | heavier (zig-zag) | +50% |
| Toweling / pile (fleece) | ×0.85 | bold + topping | + |
| Sheer / delicate | ×1.1 (lighter) | minimal | minimal |
- Thread: metallic/specialty → ~15% less dense, shorter satin throws.

---

## 9. Engine status (what we have vs need)
| rule | status |
|---|---|
| Running / satin / tatami primitives | ✅ |
| Type by width (lettering satin ≤ 2.2 mm, fix.ts ≤ 3.5 mm) | ⚠️ partial — no length/aspect/area logic; no auto-running for very thin/lines |
| Densities + clamps | ✅ (not fabric-aware) |
| Satin density compensation on curves | ⚠️ medial only — **user satin objects use uniform spacing** |
| Tatami brick stagger | ✅ |
| Tatami angle | ❌ fixed 0° default (bands on straight edges); no principal-axis / per-region variation |
| Fill underlay (edge + parallel) | ⚠️ have, but **on the boundary (not inset)**, fixed density, no zig-zag |
| Satin underlay (center + edge for wide) | ⚠️ have basic; **no zig-zag for wide**, threshold coarse |
| Pull compensation (satin) | ✅ param; ❌ not auto by width/fabric |
| Fill push/pull compensation | ❌ |
| Satin corners (miter/cap) | ❌ |
| Max stitch / split satin | ✅ (≤ 7 mm throws, region run-splitting) |
| Lock stitches, min-stitch, coincident collapse | ✅ |
| Color grouping; nearest-neighbor branch routing | ✅ / ⚠️ (not global) |
| Contour / radial / motif / gradient textures | ❌ |
| Fabric-type presets driving density/underlay/pull | ❌ (fabricColor is visual only) |
| Validation (min/max stitch, density, hoop, count) | ✅ (could warn on satin > 7 mm specifically) |

---

## 10. Roadmap to maximum power (prioritized)
1. **Unified auto-classifier** — one pure `classifyStitch(shape, fabric)` encoding
   §2 (width + length + aspect + area + role), used at import and as the default
   for drawn/imported shapes. Replaces the ad-hoc width gates. Add auto-**running**
   for very thin / open shapes.
2. **Underlay system** — pick underlay TYPE per §5 (center / edge-walk / zig-zag
   for satin; edge + parallel/zig-zag for fill), **inset edges**, density scaled
   to the top. Biggest visible-quality lift after #1.
3. **Density compensation for user satin** — bring the medial curve-compensation
   into `satinColumn` so hand-drawn satin curves are crisp too.
4. **Smart tatami angle** — principal-axis (or per-region varied) instead of 0°.
5. **Auto pull/push compensation** — pull-comp by width; fill push-pull; wired to
   a **fabric-type** setting (knit/woven/pile/sheer) that also scales density/underlay.
6. **Satin corner mitering**; **split-satin** for 7–12 mm columns.
7. **Texture options** — contour/echo fill (organic shapes), then motif/gradient.
8. **Validation tuning** — flag satin > 7 mm, underlay-off on large fills, etc.

Each step ships behind the existing journey/coverage tests + CPython export checks,
and is verifiable by metrics (coverage, rail/row spacing, longest stitch, count).
