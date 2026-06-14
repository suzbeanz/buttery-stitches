# Embroidery Quality Playbook

How Buttery Stitches digitizes machine embroidery for clean, low-risk output, and
exactly where the engine implements each rule. Every number is in millimeters
(mm); only the exporter converts to the 1/10 mm units embroidery files use.

The whole stitch engine is pure and unit-tested. The relevant files:

- `src/lib/engine/index.ts` — assembles objects into one ordered needle stream
  (`generateDesign`), per-object generation (`generateObjectStitches`), travel,
  trims, and automatic lock/tie stitches.
- `src/lib/engine/running.ts` — running stitch.
- `src/lib/engine/satin.ts` — satin columns.
- `src/lib/engine/fill.ts` — tatami fill.
- `src/lib/engine/underlay.ts` — underlay passes.
- `src/lib/engine/resample.ts` — spacing helpers, including minimum stitch length.
- `src/lib/engine/validate.ts` — non-blocking quality warnings.
- `src/types/project.ts` — `DEFAULT_PARAMS` and `resolveParams`.

---

## 1. Underlay

Underlay is the low-density first pass stitched before the top layer. It tacks
the fabric and stabilizer together, stops the top stitches from dragging the
fabric, and gives the top thread a base to sit on. Skipping underlay is the most
common cause of puckered, sloppy output.

Underlay runs at a long stitch length — ~2.5 mm — because it never needs to be
dense; it only needs to hold (`UNDERLAY_STITCH = 2.5` in `underlay.ts`).

Types and when each is used:

- **Edge run** — a single running stitch ~1–2 mm inside the outline. Holds the
  perimeter so the top layer cannot pull the edge inward. Used on fills and on
  the border of any closed shape.
- **Zigzag underlay** — a wide, low-density zigzag down a column, used under
  satin columns roughly 2–4 mm wide. (Buttery Stitches uses a center run plus
  rail edge runs for the same effect; see below.)
- **Center run** — a single running stitch down the centerline of a satin
  column. The minimum underlay for any satin; enough on narrow columns.
- **Parallel / tatami underlay** — a low-density fill pass (rows ~2–4 mm apart),
  run roughly perpendicular to the top fill angle. Stops the top fill rows from
  sliding along their own direction and gives them something to bite into. Used
  under tatami fills, usually together with an edge run.

How the engine implements it (`underlay.ts`):

- `fillUnderlay(rings, topAngle)` produces **two** passes: an edge run around the
  outline at 2.5 mm, plus a low-density parallel tatami pass at 2.5 mm row
  spacing (`FILL_UNDERLAY_ROW`) laid at `topAngle + 90` so it crosses the top
  rows. The wide row spacing keeps it buried under the top layer.
- `satinUnderlay(left, right)` always lays a center run at 2.5 mm. Columns whose
  mean width is at least 3 mm (`SATIN_EDGE_RUN_WIDTH`) also get an edge run up
  one rail and back down the other, so a broad column's edges are held too.
- Underlay is enabled per object via `params.underlay` (default `true` for
  fill/satin; forced off for running stitch in `resolveParams`).

---

## 2. Push / pull compensation

As stitches go in, the thread pulls the fabric inward across the stitch and
pushes it outward at the ends. A satin column therefore finishes narrower than
drawn. Compensation widens the column slightly so the *stitched* result matches
the *drawn* shape. A typical value is ~0.2 mm of added width (more on stretchy
fabric, less on stable).

- Default: `pullComp = 0.2` mm (`DEFAULT_PARAMS` in `project.ts`).
- Applied in `satin.ts` (`widen`): each throw's two rail points are pushed apart
  by `pullComp / 2` along the rail direction before the stitch is emitted.

---

## 3. Satin

Satin lays parallel "throws" of thread across a column, the needle alternating
between the two rails. It gives a smooth, raised, glossy line — ideal for
borders, lettering, and thin shapes.

Rules:

- **Density** ~0.35–0.4 mm between throws. Denser packs more sheen but risks
  thread build-up and puckering; looser shows fabric through. Default `density`
  is 0.4 mm (`DEFAULT_PARAMS`).
- **Width limits.** Below ~1 mm a satin column is too thin to hold and should be
  a running stitch instead. Above ~7 mm a single throw is so long it snags,
  loosens, and catches on anything; such columns should be split or converted to
  a fill. The engine caps throw length at `SATIN_MAX_WIDTH = 7` mm in `satin.ts`
  (`capSegmentLength`), turning over-wide throws into shorter split-satin
  segments so no single stitch is dangerously long.
- **Short stitches on inner curves.** On a curve the inner rail travels less
  distance than the outer, so inner penetrations crowd together. Real digitizers
  shorten the inner stitches to avoid a dense lump on the inside of the curve.
  The minimum-stitch-length filter (Section 6) removes the crowded inner
  penetrations that fall below ~0.5 mm, which is the safety-net version of this
  rule.

How: `satinColumn(left, right, { density, pullComp, maxWidth })` resamples both
rails to a matching point count by arc length (`resampleByCount`), zig-zags
across, applies pull compensation, and caps throw length.

---

## 4. Fill (tatami)

Tatami fills a region with parallel rows of running stitch, offsetting the needle
holes row to row so they never line up — the brick pattern that keeps a large
filled area looking smooth instead of ribbed.

Rules:

- **Row spacing** ~0.4 mm between rows for a solid fill. Default `density` is
  0.4 mm (`DEFAULT_PARAMS`).
- **Stitch length** along a row ~3–4 mm. Long enough to lie flat, short enough to
  follow the shape. Default `FILL_STITCH_LENGTH = 4` mm in `fill.ts`.
- **Stagger.** Alternate rows are phase-shifted by half a stitch so holes brick
  rather than aligning into visible ribs/valleys.
- **Fill underlay.** Edge run + perpendicular parallel pass before the top fill
  (Section 1).

How: `tatamiFill(rings, { density, angle, stitchLength })` works in a frame
rotated by `-angle` so rows are horizontal, scans rows across the region using
the even-odd rule (so inner rings act as holes), staggers alternate rows by
`stitchLength / 2`, runs rows in a serpentine to minimize travel, then rotates
back.

---

## 5. Running stitch

A single line of needle penetrations. Used for fine detail, outlines, stems, and
travel runs.

- **Stitch length** ~2–2.5 mm. Short enough to follow curves smoothly, long
  enough to avoid needless penetrations. Default `stitchLength = 2.5` mm
  (`DEFAULT_PARAMS`).
- The walk always lands a penetration exactly on the final vertex so the line
  ends where it should.

How: `runningStitch(path, stitchLength)` → `resampleByDistance` in
`resample.ts`.

---

## 6. Minimum and maximum stitch length

- **Minimum ~0.5 mm.** Stitches shorter than this do not pull thread through
  cleanly: the needle can punch the same hole twice, nesting thread on the
  underside and stressing or snapping the needle. They also waste run time. The
  engine merges consecutive penetrations closer than 0.5 mm with
  `dropShortStitches` (`MIN_STITCH_LENGTH = 0.5` in `resample.ts`), applied to
  every object's underlay and main output in `generateObjectStitches`. The first
  and last points are never dropped, so objects still start and end exactly where
  they should.
- **Maximum length and splitting.** Very long single stitches are loose, snag,
  and can be flagged or rejected by the machine. Satin throws are capped at 7 mm
  (Section 3). The validator warns above 12 mm (`LIMITS.maxStitch` in
  `validate.ts`).

`validate.ts` also raises non-blocking warnings for too-dense fills (puckering),
stitches outside the hoop, and very high total stitch counts.

---

## 7. Lock / tie stitches

Thread that is not locked unravels: the first stitch of a run pulls out, and the
tail after a trim lifts and tangles. Quality digitizing fastens the thread with
a small cluster of tight stitches at two moments:

- **Tie-in** — ~3 tiny stitches at the very first penetration of each thread run
  (the first object, and the first object after a trim).
- **Tie-off** — ~3 tiny stitches before every trim, and at the end of the final
  thread run.

These are real penetrations, never jumps, so the machine actually knots the
thread into the fabric instead of relying on tension.

How (`generateDesign` in `index.ts`):

- `tieStitches(anchor, toward)` builds a cluster that zig-zags ~0.8 mm
  (`TIE_AMPLITUDE`) toward the run direction and back, `TIE_COUNT = 3` times, and
  always finishes exactly on the anchor.
- A tie-in cluster is inserted at the start of every new thread run; a tie-off
  cluster is inserted before each trim and at the very end.
- On by default; `DesignOptions.lockStitches` (default `true`) disables it for
  tests that assert raw stitch counts.

---

## 8. Travel and sequencing

Every trim and jump costs time and is a failure point (missed trims, thread tags,
long loose jumps). Good sequencing minimizes both.

- **Short travel becomes a stitch run; long travel becomes a jump.** Moves up to
  3 mm (`jumpThreshold`) are stitched through; longer moves are emitted as a jump
  (needle up). This avoids littering the design with avoidable jumps.
- **Trim only when worth it.** A jump longer than 8 mm (`trimThreshold`), or any
  color change, trims the thread; shorter jumps stay connected so the thread is
  not cut for a hop the operator would rather leave.
- **Serpentine fills and lock-step satin** keep within-object travel short by
  construction (Sections 3–4).
- **Stitch order = object order.** `project.objects` is the stitch sequence;
  ordering objects by color groups same-color work and minimizes color changes.
  `generateDesign` walks objects in order, carrying the needle position so each
  object's travel starts from where the last one ended.

The single `generateDesign` stream drives both the on-canvas simulator and the
exporter, so the preview and the exported file can never disagree.

---

## Default parameters (summary)

From `DEFAULT_PARAMS` in `src/types/project.ts`:

| Param         | Default | Playbook target                          |
| ------------- | ------- | ---------------------------------------- |
| `stitchLength`| 2.5 mm  | running 2–2.5 mm                         |
| `density`     | 0.4 mm  | fill rows ~0.4 mm; satin ~0.35–0.4 mm    |
| `angle`       | 0°      | fill direction                           |
| `underlay`    | true    | always for fill/satin                    |
| `pullComp`    | 0.2 mm  | ~0.2 mm satin width compensation         |

Engine constants: underlay stitch 2.5 mm and fill-underlay rows 2.5 mm
(`underlay.ts`); fill stitch length 4 mm (`fill.ts`); satin max width 7 mm
(`satin.ts`); minimum stitch length 0.5 mm (`resample.ts`); tie amplitude 0.8 mm,
3 stitches per cluster (`index.ts`); jump threshold 3 mm, trim threshold 8 mm
(`generateDesign`).
