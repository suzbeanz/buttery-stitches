# Engine internals

A map of the stitch engine for contributors — what turns vector objects into a
machine stitch file, and where the recent math-first subsystems live. Pair it with
the benchmark (`bench/`, `npm run bench`) and the [Wilcom gap audit](./wilcom-gap-audit.md).

## Pipeline at a glance

```
Project (objects: fill | satin | running)
  └─ designFor(project)                         src/lib/engine/index.ts
       ├─ per object: generateObjectRuns()       → StitchRun[] (underlay → top)
       │    fill → field / contour / turning / flow / tatami / satin / motif / …
       ├─ routeGroups()                           cross-object travel order + direction
       └─ assemble: jumps, trims, ties, capping  → EngineStitch[]   (the one stream)
                                                    drives BOTH preview and export
  └─ export/index.ts → pes | dst | jef | exp | vp3
```

`EngineStitch` = `{ x, y, colorId, objectId, jump?, trim?, stop? }`. Everything
downstream (simulator, exporter, benchmark metrics) reads this one stream, so the
preview can never disagree with the file.

## Fills (`engine/fill.ts`, `field.ts`, `contour.ts`, `turning.ts`)

- **Grain angle** — PCA principal axis + Wilcom's 16-angle "fewest-fragments" search,
  one coherent angle per object (`autoFillAngleForRegions`).
- **Tatami** — concavity-aware boustrophedon, geodesic (Dijkstra) connectors that
  never slash a notch, ¼-brick + jitter stagger.
- **Guidance field** (`field.ts`) — the default for a curved single-spine band. Solves
  a harmonic sweep potential `u` (Laplace/SOR, Dirichlet caps at the PCA-axis extremes,
  Neumann sides); fill rows are its isolines, spaced by `density·|∇u|` at a **low
  percentile** so the fanned outer edge stays covered, with alternate-row thinning on
  the crowded inner edge. Generalises `turningFill`/`flowFill`; falls back to tatami
  via a coverage self-check.
- **Contour** — distance-transform iso-contour rings (0.2 mm cell, 0.9 density step so
  raster jitter doesn't open gaps).
- Others: gradient/ombré, two-thread blend, motif, carve, line-art ribbon.

## Satin & underlay (`satin.ts`, `medial.ts`, `underlay.ts`)

Medial-axis columns (distance transform → Zhang–Suen thinning → branch tracing),
density auto-tighten on width, curvature compensation, wide-column/corner split.
Underlay is tiered (center / edge-walk / zig-zag) by width + weight; fills get an
inset edge run + concavity-aware perpendicular pass.

## Routing (`engine/index.ts`)

Three layers, all travel-minimising:
- **Region order** (`orderByTravel`) and **run order** (`orderByNearest`) — NN + 2-opt.
- **Cross-object** (`routeGroups` → `orderColorBlock`) — NN seed + **Or-opt** (relocate
  chains of 1–3 objects, reversal-free so underlay→top order and appliqué STOPs stay
  intact) + **per-object direction**: a reversible object (no underlay / no STOP) is
  entered from whichever end is nearer (`reversibleGroup`/`reverseGroup`).
- **Buried travel** — A* on a coverage raster decides trim-vs-hidden-stitch.

## Simulation & pull compensation (`bench/distortion.ts`)

The physical layer (first slices of "simulation-in-the-loop"):
- **`simulateDistortion(stream)`** — penetrations are nodes of a mass-spring network;
  each stitch is a spring whose rest length is `PULL_STRAIN` under its drawn length
  (taut thread gathers fabric), the backing anchors nodes toward where they were
  placed. Relaxing to equilibrium predicts the distortion; `pullIn(mm)` is the net
  inward gather.
- **`precompensate(stream)`** — solves the inverse: the *placed* positions whose
  simulated landing equals the digitized target (iterated fixed point
  `placed += target − simulate(placed)`). Drives landed-vs-target error ~0.26 → ~0.02 mm.
- **`applyPrecompensation(stream)`** — emits the warped, exportable stream.

**Not default-on**: `PULL_STRAIN`/`BACKING` need calibrating against a real sew-out,
and predictive comp must be reconciled with the heuristic `pullComp` first.

## Machine safety (enforced, not just warned)

`MIN_FILL_DENSITY` 0.3 mm floor, min-stitch 0.5 mm drop + coincident collapse, satin
≤ 7 mm, per-format stitch-length caps with auto-split (`export/index.ts`). `validate.ts`
surfaces warnings; `info.ts` estimates stitches/thread/runtime.

## Benchmark (`bench/`)

`npm run bench` scores a deterministic corpus on stitch economy, travel %, segment
evenness (`lenCV`, `short%`), accurate **thread-footprint coverage**, and predicted
**pull-in**, writing `bench/baseline.json` for diffing. This is the scoreboard the
whole "surpass Wilcom" effort is measured on — a metric moving the wrong way is a
regression; the right way is progress.
