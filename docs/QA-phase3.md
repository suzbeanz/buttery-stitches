# Phase 3 — QA / QC notes

The stitch engine and simulator, with a synthetic-user pass.

## Design principles that keep it correct

- **One source of truth for stitches.** `generateDesign(project)` produces a
  single ordered event stream (stitch / jump / trim, with colour + underlay
  flags). The simulator and the exporter both consume it, so the preview can
  never disagree with the exported file.
- **All stitch math is pure and unit-tested.** running, satin, fill, resample,
  sequencing, validation, and the render-segmenter each have tests
  (`src/lib/engine/*.test.ts`). The Konva/React layer only draws.
- **End-to-end format check.** The exact `embroidery.py` that ships to Pyodide
  was run against a multi-colour command-stream plan in CPython: PES/DST/JEF/
  EXP/VP3 all write, and the PES round-trips with 2 threads and a real
  COLOR_CHANGE.

## Synthetic user testing — flows & findings

| Flow | Risk | Outcome |
| --- | --- | --- |
| Switch to Stitch view with an empty project | Play/scrub on nothing | `simTotal === 0` disables Play; slider maxes at 0 — no crash. |
| Press Play after it reaches the end | Nothing happens / stuck | Play restarts from 0 when at the end. |
| Switch to Edit while playing | Animation keeps running in background | `setViewMode` stops playback; the rAF effect cleans up. |
| Draw tools while in Stitch view | Confusing dead clicks | Canvas is read-only in Stitch view **and** the tool buttons are disabled with a tooltip. |
| Delete / reorder a layer during simulation | Index runs past the new end | `setSimTotal` clamps `simIndex`; design recomputes from the project. |
| A fill drawn with a self-touching or tiny outline | Engine throws | Guards: outline < 3 pts ⇒ no stitches; the per-object count is wrapped in try/catch. |
| Long satin throw (wide column) | One giant loose stitch | Throws are split so no segment exceeds the safe width (`capSegmentLength`), and validation warns. |
| Fill with a hole | Hole gets stitched over | Even-odd scan-line leaves holes empty (tested). |

## Known limitations (tracked)

- The simulator rebuilds render segments each frame (`O(n)`); fine for logos,
  but very large designs (>~15k stitches) may want incremental drawing.
- Satin "throw splitting" caps stitch length but doesn't yet insert a true
  centre split-stitch; good enough to keep stitches bounded for v1.
- Fill travel between disjoint row spans is a plain connecting stitch; the
  sequencer will jump/trim it when long, but a smarter travel path is a
  follow-up.
- Auto thread-order optimisation is deferred to the auto-digitize pipeline
  (Phase 4); Phase 3 respects the user's layer order as the stitch sequence.
