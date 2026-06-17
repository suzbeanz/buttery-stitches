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

## Real gaps to "truly compete"

Ranked by **value ÷ effort**.

1. **Bean / triple run as a first-class stitch** — exists in the engine
   (`beanRepeats`) but is buried in properties, not a one-click stitch type.
   Pros reach for it constantly (outlines, redwork, stems). *Low effort.*

2. **Measure tool** — point-to-point distance/angle readout on the canvas.
   Wilcom has it; we only have ruler units. *Low effort.*

3. **Per-node editing** — add/delete a node, and per-node corner↔curve
   (today "Curve" is a global smooth toggle, and Points only drags existing
   vertices). This is the biggest *finesse* gap for matching hand-digitizing.
   *Medium effort.*

4. **Two-rail satin (Input B)** — draw the two edges of a column for true
   variable-width satin (borders, calligraphic lettering). We do centerline
   satin only. *Medium effort.*

5. **Appliqué** — placement line → tackdown → cover stitch → stop, as one
   object. A very common production request. *Medium–high effort.*

6. **Motif / pattern fills & motif runs** — decorative repeating motifs along
   a run or tiled in a fill (candlewicking, etc.). *Medium–high effort.*

7. **Carved / stipple / spiral fills** — we have contour fill; the rest of the
   decorative fill family is missing. *Medium effort.*

## Verdict

For everyday digitizing — run, satin, tatami, lettering, auto-digitize, node
drag, shapes, clean underlay/comp/routing — **we already cover the core a
hobbyist or small shop needs**, and the auto-digitize + freehand tools are
genuinely competitive. To *truly* go toe-to-toe with Hatch/Wilcom for serious
production, the priority order above is the path: start with bean run + measure
(quick wins), then per-node editing (the finesse gap), then two-rail satin and
appliqué (the pro production gaps).
