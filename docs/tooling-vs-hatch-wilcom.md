# Tooling vs. Hatch / Wilcom — where we stand

An honest map of our digitizing toolset against the pro packages (Wilcom
Hatch / EmbroideryStudio). Goal: know exactly which tools we have, which are
"good enough," and which real gaps remain to *truly* compete.

## What we have (core digitizing — ~80% of everyday work)

| Capability | Wilcom/Hatch | Buttery Stitches | Status |
|---|---|---|---|
| Running / walk stitch | Run (open object) | Line tool + Pencil (freehand) | ✅ |
| Satin column | Satin / Input A | Satin (centerline) | ✅ |
| Tatami / complex fill (+ holes) | Complex Fill | Fill (tatami, nonzero-winding holes) | ✅ |
| Node / reshape editing | Reshape | Points tool (drag vertices) | ⚠️ partial |
| Curves | Bezier input | Curve (smooth) toggle | ✅ (global, not per-node) |
| Premade shapes | Ellipse/rect/etc. | Shapes (box, circle, triangle, heart, star, line) | ✅ |
| Lettering | Lettering | Words (13 live-digitized OFL fonts) | ✅ |
| Auto-digitize image | Auto-digitize / PhotoStitch | Image (k-means + trace) | ✅ |
| Paint-style fill | — | Brush + Bucket (freehand/flood) | ✅ (nice extra) |
| Underlay | Auto underlay | Tiered underlay (center/edge/zigzag by width) | ✅ |
| Pull/push compensation | Pull comp | Pull + push comp | ✅ |
| Stitch sequence / resequence | Sequence | Layer panel order ([ ]) | ✅ |
| Thread/colors | Color palette | Color management + worksheet | ✅ |
| Fabric presets | Fabric | woven/knit/pile/sheer profiles | ✅ |
| Read embroidery files | Read | .pes/.dst/.jef/.exp/.vp3 + .embproj | ✅ |
| Write embroidery files | Write | 5 formats via pyembroidery | ✅ |
| Travel/trim optimization | Auto | intra-object travel, fabric-aware trims | ✅ |

## Recently closed

- ✅ **Bean / triple run** — first-class in Properties ("Line weight: Single /
  Triple / Bean"), engine-supported.
- ✅ **Measure tool** — point-to-point distance + angle on the canvas (key `M`).
- ✅ **Per-node editing (add + delete)** — Points tool now inserts a vertex by
  clicking the outline and deletes the focused one (Del).
- ✅ **Two-rail satin (Input B)** — "Column" tool: draw edge A then edge B for
  true variable-width satin; the engine/model already stored columns as rails.
- ✅ **Appliqué** — "Appliqué" tool / fill toggle: placement run → STOP → tackdown
  → STOP → satin cover, as one object. STOP encodes cleanly in PES; DST/EXP pause
  via color-stop (the native mechanism); VP3 fidelity is partial.

## Remaining gaps

Ranked by **value ÷ effort**.

1. **Per-node corner↔curve handles** — paths are stored as densified polylines,
   so true bezier handles need a control-point data model. The finesse capstone.
   *Medium effort.*

2. **Motif / pattern fills & motif runs** — decorative repeating motifs along a
   run or tiled in a fill (candlewicking, etc.). *Medium–high effort.*

3. **Carved / stipple / spiral fills** — we have contour fill; the rest of the
   decorative fill family is missing. *Medium effort.*

## Verdict

For everyday digitizing — run/bean, satin, two-rail satin, tatami, appliqué,
lettering, auto-digitize, node add/delete/drag, measure, shapes, clean
underlay/comp/routing — **we now cover the core production toolset**. The main
remaining differentiators are per-node bezier handles (needs a model change) and
the decorative fill/motif family.
