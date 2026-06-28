# Tooling vs. the leading commercial digitizers — where we stand

An honest map of our digitizing toolset against the pro packages (the
industry-standard commercial suites). Goal: know exactly which tools we have, which are
"good enough," and which real gaps remain to *truly* compete.

## What we have (core digitizing — ~80% of everyday work)

| Capability | Commercial digitizers | Buttery Stitches | Status |
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
- ✅ **Per-node editing (add + delete + corner↔curve)** — Points tool inserts a
  vertex by clicking the outline, deletes the focused one (Del), and toggles a
  node between a sharp corner (square handle) and a smooth curve (round handle)
  with `C` / double-click. Drawn running & fill objects keep editable control
  nodes (a node model that densifies into the polyline the engine reads); move
  and transform carry the nodes so curves stay editable.
- ✅ **Two-rail satin (Input B)** — "Column" tool: draw edge A then edge B for
  true variable-width satin; the engine/model already stored columns as rails.
- ✅ **Appliqué** — "Appliqué" tool / fill toggle: placement run → STOP → tackdown
  → STOP → satin cover, as one object. STOP encodes cleanly in PES; DST/EXP pause
  via color-stop (the native mechanism); VP3 fidelity is partial.

## Remaining gaps

Ranked by **value ÷ effort**.

1. **Motif / pattern fills & motif runs** — decorative repeating motifs along a
   run or tiled in a fill (candlewicking, etc.). *Medium–high effort.*

2. **Carved / stipple / spiral fills** — we have contour fill; the rest of the
   decorative fill family is missing. *Medium effort.*

3. **Draggable bezier tangent handles** — corner↔curve is in via smooth-node
   tagging; explicit per-node tangent handles (drag the curve's "ears") would add
   the last bit of fine control. *Medium effort.*

## Verdict

For everyday digitizing — run/bean, satin, two-rail satin, tatami, appliqué,
lettering, auto-digitize, node add/delete/drag + corner↔curve, measure, shapes,
clean underlay/comp/routing — **we now cover the core production toolset** and the
hand-digitizing finesse. The main remaining differentiators are the decorative
fill/motif family and draggable bezier tangent handles.
