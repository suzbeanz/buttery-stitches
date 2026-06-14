# Phase 5 — QA / QC notes

Sizing, hoops, validation surfacing, and the thread worksheet.

## The re-densification guarantee

Resizing scales the **millimetre geometry**, never stitch points. Stitches are
regenerated from geometry at a fixed density, so a bigger design gets
proportionally more stitches. Locked-in by a test: doubling a fill's width
yields **more than 2×** the stitches (area-scaling, not a naive point-scale) —
the Section 11 acceptance criterion.

## What's tested

- `layout`: design bounds/size, uniform resize-to-width, fit-to-hoop (clamped +
  centred), and the re-densification acceptance test.
- `worksheet`: colour-stop grouping with per-stop counts, duration formatting,
  and self-contained HTML generation (swatches, brand, totals).
- `DesignPanel` (jsdom): resize commits on blur, fit-to-hoop centres, hoop preset
  switching.

## Synthetic user testing — flows & findings

| Flow | Risk | Outcome |
| --- | --- | --- |
| Type a new width digit-by-digit | Each keystroke rescales (40 → 4 → 40 compounds) | Size inputs commit only on Enter/blur; live value re-syncs on undo/fit. |
| Shrink the hoop below the design | Design silently off-hoop | Validation flags "N stitches outside the hoop"; one-click **Fit to hoop**. |
| Non-uniform squash | Distorted satin widths / fill angles | Aspect lock is **on by default**; uniform scaling preserves stitch quality. |
| Resize an empty project | Divide-by-zero / NaN paths | Guarded — size controls hide until there's a design. |
| Print worksheet with nothing drawn | Blank page | Button warns "Nothing to print yet". |
| Worksheet popup blocked | Silent no-op | Opened via a Blob URL in a new tab; if blocked the browser shows its usual prompt. |
| PES colours look slightly off | Brother palette snapping in #PES0001 | #PES0060 (truer colour) is selectable in the export menu. |

## Known limitations (tracked)

- Estimated run time uses a fixed 600 spm + 20 s/colour-change; real machines
  vary — it's a ballpark, clearly labelled "Est."
- Worksheet opens in a new tab (best for print/PDF) rather than an in-app modal,
  to keep print styling isolated from the editor chrome.
