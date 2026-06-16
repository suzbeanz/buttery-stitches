# The Creative Workflow — Draw → Digitize → Edit

A roadmap for the next big arc: make Buttery Stitches a place where a non-technical
maker *draws* their idea, the engine *digitizes* it into the best possible
stitches, and they can *fine-tune* the result. "Open source is the best because
it's the projects people care about making with all their hearts" — so the bar is
a smooth, premium, forgiving creative tool, not a CAD program.

Units stay mm; American spelling; commit as `suzbeanz`; everything pure +
unit-tested where it's logic, verified by a visual sew-out where it's feel.

---

## Where we are
- **Digitize (the engine): strong.** Phases A–F shipped — fabric/thread profiles,
  format-safe split, satin push/short-stitch/auto-spacing, underlay overhaul,
  moiré-free fills, bean stitch, fabric-aware trims. The "convert drawing →
  stitches" step is genuinely good now and runs live.
- **Draw: thin.** Tools are Select, Points, Line (running), Satin, Fill (click a
  polygon outline), Pencil (freehand running), Curve (smooth toggle), Hand. There
  are **no basic shape tools** (rectangle/ellipse/polygon), **no paint-bucket**
  area fill, and freehand only makes a *line*, not a filled blob.
- **Edit: vector-only.** The Points tool edits the *outline* vertices; there's no
  way to tune the *stitches* (angle, per-region type) beyond the Properties panel.
- **Image upload: weak.** The trace is blocky/low-fidelity (see the poodle review):
  regions aren't smoothed, color reduction is coarse, no detail control.

## The gap, in the user's words
> "Think about the design phase as drawing, then converting to stitches. A better
> drawing interface — basic shapes, easy paint-bucket fill, natural drawing — then
> let the engine decide the best way to stitch it. And a way to fine-tune the
> stitches themselves."

So three pillars remain: **DRAW**, **IMAGE QUALITY**, **EDIT** — plus premium
safety (never lose work).

---

## Batches

### Batch 1 — Drawing foundation ("draw naturally")
Make creating shapes effortless; every shape is just a vector object the engine
digitizes live (so quality is automatic).
- **Shape tools**: Rectangle, Ellipse/Circle, Line, Polygon, plus a couple of
  craft favorites (Heart, Star). Drag-to-place; Shift = constrain (square/circle).
  Reuse `makeShapeObject`; add a Shapes group to the tool rail.
- **Paint-bucket / area fill**: click inside a closed region (or where outlines
  overlap) to create a filled object of that area, in the active color. For
  imported art, click a color region to fill just it.
- **Freehand fill**: the pencil, closed → a filled blob (not just a line);
  smoothed (Catmull-Rom) so it reads as a natural drawn shape.
- **Color-first flow**: pick a thread color, draw, it fills in that color — the
  "drawing" mental model, not "outline then assign".
- *Premium*: live snap to shapes/centers, nudge with arrows, duplicate, the
  motion/feel already in place.

### Batch 2 — Image digitizing quality (the #1 complaint)
Turn a photo/clip-art into clean, smooth stitches.
- **Smoother regions**: simplify + Catmull-Rom smooth each traced outline before
  digitizing, so fills follow curves instead of stair-stepping.
- **Better color reduction**: tune/!replace the quantizer; a "Detail" slider
  (few clean colors ↔ more detail), and merge tiny/!noise regions (extend the
  existing fringe filter).
- **Posterize/clean pre-pass**: optional blur + posterize so clip-art traces
  crisp and photos simplify gracefully.
- **Auto-borders**: optional thin satin outline around traced regions for the
  crisp "patch" look, and to hide registration gaps between colors.
- **Layered preview**: show the digitized result vs the source, per color, so the
  maker trusts it. Verified by a real sew-out review.

### Batch 3 — Stitch fine-tuning ("edit the stitches")
Give makers safe, visual control over how a region is sewn — without needing to
understand digitizing.
- **Per-region stitch angle**: a draggable angle handle in stitch view (the single
  most-wanted control); live re-stitch.
- **Per-region type override**: satin / tatami / contour with a tap (Properties
  has the data; make it visual + per-region for multi-region objects).
- **Density & underlay** visual feedback (heatmap of coverage; warnings inline).
- **Direction / start-point** handles to steer travel & entry.
- **Region lock / recalc**: pin a region you like, recompute the rest.
- (Advanced, later) nudging individual stitch points.

### Batch 4 — Premium safety & onboarding
- **Session autosave/restore** to `localStorage` (privacy-safe, stays on device):
  reload, crash, or a new deploy never loses work. This also makes the existing
  "your design is safe — reload" promise *true*.
- **Stale-deploy self-heal**: on a dynamic-import (chunk) failure, restore from
  autosave and reload to the fresh build automatically — no more "Something
  hiccuped" on a deploy.
- **Drawing onboarding**: an empty-state that invites "draw a shape, drop an
  image, or add words", with the brand's warmth.

---

## Sequencing & rationale
- **Batch 4's autosave is a cheap prerequisite** for everything (so iterative work
  and deploys never lose a design) — fold the autosave + chunk self-heal in early.
- **Batch 1 (drawing)** is the heart of the vision and the most empowering for the
  "made with all their hearts" maker; it's also where the engine's quality shows.
- **Batch 2 (image quality)** is the loudest current pain and fairly contained.
- **Batch 3 (stitch editing)** is the largest lift; do it last, in sub-steps,
  starting with the per-region angle handle (highest value, lowest risk).

## Verification
Logic (shape geometry, trace smoothing, fill regions, angle math) gets unit tests
and the existing metric probes. Feel (drawing UX, trace fidelity, stitch edits)
needs a **visual sew-out review in the simulator** each batch — the one thing the
tests can't certify. Keep `typecheck + lint + vitest + build` green every step;
keep CPython pyembroidery export valid across formats/fabrics.
