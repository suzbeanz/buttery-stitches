# Wilcom/Hatch parity plan — buttery-stitches digitizer

## Context

Goal: make the auto-digitizer as good as Wilcom/Hatch, judged by **the exported machine file truly capturing the uploaded image**. Constraints set by the user: auto-digitize into **editable objects** (Hatch-style), priority input is **logos & clean artwork**, **no AI — pure math/deterministic logic**, must-have formats **DST + PES**.

Exploration finding that frames everything: this codebase is already far beyond a naive digitizer — k-means quantization + classification heuristics in `src/lib/trace/`, Wilcom-class auto fill-angle (PCA + fewest-fragments), medial-axis auto-satin (`engine/medial.ts`), tiered underlay, NN+Or-opt sequencing with A* buried-travel routing, a reference-validated native DST writer (byte-identical stitch section to pyembroidery), PES v1 with full PEC thumbnails, an oracle-differential CI, a bench harness, and a physical calibration swatch. So this is a **targeted gap-closing plan**, not a rebuild. Verified in-code: the July 2026 sew-out note in `bench/distortion.ts:25-28` (woven swatch measured dead-on ±0.5mm → calibration is a knit/fleece problem, not a launch blocker), `satinCenterlines`/`makeSatinFromRails` plumbed through all transforms, `encodeTernaryStream(plan, stopAsColorChange)` in `export/native/dst.ts:93`.

Priority order (impact-per-effort on "file captures image"): **P0 → P1 → P2 → P3 → P4 → P6 → P5 → P7 → P8**.

---

## Phase 0 — Export truth pack (small, do first)

Every claim in the exported file becomes true, verified, complete.

- `src/lib/export/index.ts`:
  - Route STOP-bearing DST plans through the native writer: thread a `stopAsColorChange` flag into `encodeDst` reusing `encodeTernaryStream(plan, true)` (already production-tested via `encodeT01`). Kills the ~10MB Pyodide download for appliqué DST. Keep Pyodide gating only for PES v1 STOP (until Phase 6).
  - Plumb the design label: `ExportOptions.label` → `encodeDst`/`encodePes` header info (today every file says "Untitled" in `LA:`).
  - **Export-time decode-back verification**: after native encode, decode with the existing test-only decoders (`ternary-decode.ts` for DST/T01, `pec-decode.ts` for PES) and assert penetration count, block/color count, and bbox match the plan within 1 tenth; friendly error on mismatch instead of shipping a corrupt file.
- `src/lib/engine/validate.ts`: fix dead thresholds (12mm warning unreachable under the 6.5mm engine cap) and add a **measured-density warning** using `bench/metrics.ts` coverage/stitch-length functions (pure over `EngineStitch[]`) — warn on thread pile-up (pucker risk) and fill coverage < 0.97 (gaps).
- Doc drift: README says median-cut / 2-opt / 0.35mm; code does k-means / Or-opt / 0.30mm.

Tests: STOP-bearing DST plan decode-back in `dst.test.ts`; label round-trip; existing oracle CI covers equivalence.

## Phase 1 — Fidelity metric: "did the file capture the image?"

The measuring instrument for everything after; deterministic 0–100 score.

- New `src/lib/bench/fidelity.ts` (pure, no canvas):
  - `rasterizePlan(design, colors, cellMm=0.1)`: stamp stitched segments as 0.3mm-wide capsules into a color-label grid, later-sewn overwrites earlier (reuse rasterization idioms from `medial.ts`).
  - `fidelityScore(source, plan, colors, mmPerPx)` components: per-color **region IoU** (area-weighted, small regions weighted up), **boundary chamfer distance** (the number Phase 2 must move), **color ΔE** (CIELAB vs assigned threads), **spill** (stitches on source background). Composite: `100·(0.5·IoU + 0.25·exp(−chamfer/0.5) + 0.15·(1−ΔE/50) + 0.10·(1−spill))`. Optional "as-sewn" variant scoring `simulateDistortion` output — first production caller of `bench/distortion.ts`.
- Wire into `imagepipeline.test.ts` as ratcheted baselines (fail on >1pt regression); show score + disagreement overlay in `AutoDigitizeDialog.tsx`.

## Phase 2 — First-party tracer: subpixel boundaries + Bézier fitting (biggest fidelity lever)

Replace imagetracerjs boundary extraction (polyline-quality, gap-prone between colors) with a first-party tracer. New `src/lib/trace/boundary.ts` + `src/lib/trace/fitcurve.ts`:

1. Trace the **crack lattice** of the existing k-means label map (today it's wastefully flattened back to RGBA for imagetracerjs) into closed loops; adjacent colors share the exact same polyline → hairline gaps between fills die at the source (shrinks the load on `weldSliverGaps`/underlap).
2. **Subpixel snap** when `hasAntiAliasing(source)`: sample the original image along boundary normals, place vertices at the α=0.5 color crossing (clamped ±1 src px). Raise upscale target 480→~1024px (adaptive to ~0.1–0.15mm/px).
3. **Corner detection**: turning angle over a ~1.2mm arc-length window, maxima >~40° are corners.
4. **Schneider least-squares cubic Bézier fitting** corner-to-corner (chord-length parameterization, Newton–Raphson reparameterize, split at max-error; tol = detail preset's `simplifyTolMm`).
5. Emit both densified `Path` and `NodePath` (corner/smooth nodes with handles) → auto-digitized objects become node-editable day one (`EmbObject.nodes` already defined).

Integration: keep `tracedataToObjects`' ~400 lines of classification heuristics intact by feeding the same rings+palette structure; `recognizeShape` snap keeps first priority; imagetracerjs behind a fallback flag for one release. Acceptance: Phase 1 chamfer improves on every corpus image; full `imagecorpus`/`imagepipeline` gate stays green; new unit tests (circle fit <0.1mm, corner preservation, zero-gap shared-boundary property).

## Phase 3 — Editable auto-satin objects (the structural Hatch-parity gap)

Auto-satin is currently derived at stitch time and not grabbable. Two tiers, cheapest first:

- **3a. Persist + edit centerlines**: at digitize-apply time, run the engine's own satin decomposition (extract `acceptableSatin` logic from `engine/index.ts` into a shared `planSatinDecomposition`) and store centerlines on `EmbObject.satinCenterlines` — the engine already prefers authored centerlines via `columnsFromCenterlines`. Persist only when the decomposition passes `MIN_SATIN_COVERAGE`; determinism already pinned by `medial-tjunction.test.ts`. Extend the node editor to drag/add/remove centerline vertices (transforms already carry the field everywhere).
- **3b. "Break apart to satin columns"** command in `objects.ts`: explode into real `type:"satin"` rail-pair objects via `makeSatinFromRails(col.rails[0], col.rails[1], colorId)` + one residual fill from `residualRegions` for junction wedges, sharing a `groupId`. One-way door (say so in the UI), then fully editable with the existing Column tool.

Tests: explode → recompile → `satinCoverage` within 1%; fidelity score unchanged; `.embproj` round-trip.

## Phase 4 — Turning-fill coverage 97.6% → ≥99.3%

The documented top math gap (crescent benchmark). First add a bench diagnostic dumping `residualRegions` for the crescent so the missing 2.4% is located. Expected fixes in `engine/turning.ts`:
- **Curvature-adaptive station spacing**: advance along the spine by `Δs = density/(1 + κ·d_outer)` (clamped to `[0.35·density, density]`, κ smoothed over 3 stations) so the outer edge of bends never starves.
- **Cap closure**: extend the spine through tips via the existing `extendSpine`, and replace the hard span-length reject near caps with a bounded binary-search shrink.
- All existing self-validation gates (`hasExposedSegment`, `MIN_TURNED_COVERAGE`) untouched — decline rather than slash. Accept ≤+5% stitch count.

## Phase 5 — Guided calibration loop + fabric profiles (for knits/fleece/sheer)

Woven already measures dead-on, so this is scoped to stretch fabrics. Parameterize `bench/distortion.ts` constants; new `src/lib/calibration.ts` with `predictSwatchMeasurements(θ)` (simulate the existing swatch, extract the same ~10 dimensions the user will measure) and `fitConstants` (regularized least squares: deterministic grid over PULL_STRAIN×BACKING then Nelder–Mead; Tikhonov term handles identifiability; report residual honestly). Guided wizard: export swatch (`samples/swatch.ts`) → sew → enter measurements → fit → save `FabricCalibration` in localStorage. Wire `applyPrecompensation` into the `designFor` path only for calibrated profiles with residual >0.15mm; preview and export share the same compensated stream.

## Phase 6 — Native PES v6 writer (true thread colors, no Pyodide)

`export/native/pes.ts`: `#PES0060` header + length-prefixed description strings (name from Phase 0 label), **thread list with real `ThreadColor` catalog codes/RGB/brand** (extend `PlanBlock` with optional `thread?: ThreadColor` in `planFromDesign`), reuse existing CSewSeg writers with indices into the v6 thread list, reuse `writePec` verbatim. Built the same way v1 was: section-by-section against the pyembroidery oracle (`scripts/oracle-pes.ts` extended to version 6) until decoded-equal; Pyodide path stays until the oracle gate is green. Extend Phase 0 decode-back verify to v6.

## Phase 7 — Fidelity-driven auto-tuning (beats Wilcom's one-shot UX)

"Auto" button in `AutoDigitizeDialog.tsx`: deterministic grid search — color count {suggested±1} × detail {smooth,balanced,detailed} (≤9 candidates) — scored at reduced raster scale by the Phase 1 metric, winner re-run at full quality, per-candidate scores shown so the user can override. Corpus assertion: auto-tune never scores below defaults. Later: per-region style search (satin vs tatami vs turning for ambiguous mid-width regions).

## Phase 8 — Parity leftovers (smaller PRs)

Small-lettering pass (min ~1.2mm satin width auto-widen, extra pull comp <5mm letter height, warn <4mm); programmable/stamp fills beyond motif+carve; raised/3D foam satin (reuses appliqué STOP machinery); branching sequencing polish; threshold consolidation.

---

## Shortcomings we will NOT fix (disclose in-app)

1. **DST carries no color info** — format-inherent; disclose at DST export (currently silent).
2. **PES v1/PEC snap to the Brother 64 palette** — even with v6, PEC-only machines show nearest-palette colors.
3. **Photo realism** — thread is a ~12-color, 0.3mm medium; photo mode stays approximate.
4. **Thread gamut ΔE is irreducible** — the fidelity score reports it rather than hiding it.
5. **Text below ~4mm cap height** can't sew cleanly at 40wt — warn, suggest 60wt.
6. **Fabric variability** — calibration fits one fabric+stabilizer+hooping combo; first-order model, residuals reported.
7. **Machine firmware variance** (jump tolerance, trim/STOP semantics) — we follow Tajima/pyembroidery conventions.
8. **Source quality floor** — subpixel snapping can't invent detail a 32px or JPEG-mangled logo never had.

---

## Verification strategy (cross-phase)

- Existing infrastructure carries the load: oracle-differential CI vs pyembroidery, reference fixtures, `npm run bench` baselines, corpus gate tests, machine-safety suite.
- Phase 1's fidelity score becomes a ratcheted CI gate — every later phase must not regress it, Phase 2 must improve chamfer on every corpus image.
- Physical loop: the calibration swatch (`gen-swatch-pes.ts`) is the sew-out artifact for Phases 0/5/6 (STOP handling, jump tolerance, precompensation) on a real machine.
- Run per phase: `npm test` (vitest), `npm run bench` vs `bench/baseline.json`, Playwright e2e smoke.

## Critical files

`src/lib/trace/index.ts`, new `src/lib/trace/boundary.ts` + `fitcurve.ts`, `src/lib/engine/index.ts`, `src/lib/engine/turning.ts`, `src/lib/engine/medial.ts`, `src/lib/engine/validate.ts`, `src/lib/export/index.ts`, `src/lib/export/native/dst.ts` + `pes.ts`, `src/lib/bench/fidelity.ts` (new) + `distortion.ts` + `metrics.ts`, `src/lib/calibration.ts` (new), `src/lib/objects.ts`, `src/components/AutoDigitizeDialog.tsx`.

## Execution note

Work lands on branch `claude/digitizer-wilcom-hatch-parity-fyxuqm` in PR-shaped increments per phase. First implementation step on approval: commit this roadmap to `docs/`, then Phase 0.
