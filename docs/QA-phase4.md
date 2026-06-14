# Phase 4 — QA / QC notes

Auto-digitize, with a synthetic-user pass.

## Architecture note

The spec lists RgbQuant.js **and** imagetracerjs. imagetracerjs already does
per-colour quantization internally, so v1 uses **imagetracerjs alone** (the
spec's "start with imagetracerjs" path) — fewer moving parts, same result. The
embroidery-specific logic (simplify, classify, mm-mapping, hole attachment,
object creation) is our own **pure, tested** code; only the trace call touches
the library. If trace quality ever needs better quantization, RgbQuant can be
slotted in front without touching the converter.

## What's tested

- `douglasPeucker`, `classifyShape`, area/perimeter — pure unit tests.
- `tracedataToObjects` — fed synthetic tracedata: background removal, hole
  attachment (even-odd), and px→mm scaling/offset.
- `imageDataToObjects` — runs the **real imagetracerjs** on a synthetic image
  (the library is pure JS, so it runs in Node) → real objects out.
- `estimateColorComplexity` — noisy images score higher than flat ones.

## Synthetic user testing — flows & findings

| Flow | Risk | Outcome |
| --- | --- | --- |
| Digitize over an existing design | Silent loss of unsaved work | Apply is **undoable** (history not cleared) and the dialog warns when work exists. |
| Pick a non-image / corrupt file | Crash | `accept="image/*"` filters; decode failure shows an error and disables Digitize. |
| Image where everything is background | Empty design, confusing | Explicit "No shapes found — try more colours / turn off background removal." |
| Huge photo upload | Slow / frozen tab | Source is downscaled to ≤512 px before tracing; a spinner paints before the synchronous trace. |
| Photo instead of a logo | Garbage output, no warning | Complexity estimate flags likely photos with guidance to use fewer colours. |
| Logo on a white background | Background stitched as a big block | Background removal (largest colour area) is on by default; transparent palette entries are skipped. |
| Speckly / noisy edges | Hundreds of micro-objects | Despeckle drops shapes below 1 mm²; outlines simplified at 0.3 mm. |

## Known limitations (tracked)

- **Auto-satin is deferred.** Thin regions become running stitches; medium/large
  become fills. Turning a fill into a satin column is one click in the editor
  (Phase 2), which is more reliable than medial-axis extraction from a trace.
- Curved (`Q`) trace segments are flattened to their endpoints before
  simplification — fine after Douglas–Peucker, but very smooth curves lose a
  little fidelity.
- Object order follows imagetracerjs's layer/colour order; the user can reorder
  in the layer panel.
