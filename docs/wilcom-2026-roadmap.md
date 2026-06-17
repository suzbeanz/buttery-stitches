# QC/QA verification + roadmap to compete with Wilcom EmbroideryStudio 2026

## Part 1 — QC/QA verification (this pass)

Wilcom is, as the brief says, a **CAD/CAM compiler**: design intent (`.EMB`) is
kept separate from machine output (`.DST`/`.PES`), and a stitch engine compiles
the former into the latter. We verified our pipeline the same way a compiler is
verified — gates + end-to-end "programs" + real output inspection.

**Gates:** `tsc` ✅ · ESLint ✅ · **437 unit tests / 59 files** ✅ · production build ✅.

**Synthetic user testing** (`src/test/synthetic-users.test.ts`, 7 flows): logo
digitizer, monogrammer (arched + multiline lettering), appliqué maker, decorative
artist (gradient/motif/carve), resizer, color manager, production check. Every
flow asserts the premium invariants: **no stitch > 9 mm**, sane trims+jumps/1000,
real stitches produced, hoop fit, and — critically — that **resizing recalculates
stitches** (4× area ⇒ >2.5× stitches at the same density), Wilcom's "dynamic
parameterization." All pass.

**Real machine-file validation** (CPython `pyembroidery`): 3 personas ×
5 formats = **15 files**, all valid — non-empty, readable, sane stitch counts,
longest stitch ≤ 4.2 mm (well under every format's 12.1/12.7 mm cap), and appliqué
**STOP**s preserved (PES 2, JEF 1). The compile→emit→re-read loop is sound.

**Verdict:** the core "compiler" is correct and safe across formats. Gaps below
are about *breadth of design intent*, not output integrity.

## Part 2 — Wilcom 2026 architecture → where we stand

| Wilcom pillar (from the brief) | Buttery Stitches today | Status |
|---|---|---|
| Object data model, intent vs output (`.EMB` ≠ `.DST`) | `.embproj` (objects, vectors, editable nodes, params) ≠ exported files | ✅ |
| Stitch-generation engine ("compiler") | `generateDesign` → plan → pyembroidery | ✅ |
| Dynamic parameterization (resize recalculates) | vector objects regenerate at fixed density; nodes carry through resize | ✅ verified |
| Physical fabric simulation (pull **and** push comp) | pull + push compensation, fabric profiles | ✅ |
| Advanced pathfinding / **auto-branching** | intra-object travel + nearest-neighbor + fabric-aware trims (234→~3 /1000) | ✅ (greedy, not full TSP) |
| Lettering (ESA-style, resize-safe) | live OFL fonts + arch/multiline/spacing | ✅ |
| Auto-digitizing | k-means saliency trace + auto stitch-type | ✅ |
| Decorative "design elements" | gradient, motif fill, motif runs, carve | ✅ (subset) |
| **Multi Blend** (2026 — blend thread *colors* across layers) | gradient *density* only; no color blending | ❌ gap |
| **Laydown stitches** (2026 — foundation grid for high-nap) | pile fabric profile + heavier underlay; no explicit laydown grid | ⚠️ partial |
| CorelDRAW-grade vector suite + live handshake | shapes, node edit, trace; no full vector editor | ⚠️ partial |
| Node editing depth (bezier tangent handles) | corner↔curve nodes; no draggable tangents | ⚠️ partial |
| Multi-hoop, templates, design library/organizer | single hoop (8 presets); none of these | ❌ gap |
| Color/thread brand charts (Madeira/Isacord codes) | brand-agnostic matcher + honest starter chart | ⚠️ partial (licensed data) |

## Part 3 — Roadmap to truly compete

### Phase A — the 2026 differentiators (highest signal)
1. **Multi-Blend color gradients** — blend two thread colors across a fill by
   interleaving rows of each color with a position-dependent ratio (an extension
   of our gradient-density machinery). *Verify: per-row color ratio + coverage.*
2. **Laydown stitches** — an explicit low-density foundation grid pass for napped
   fabrics (pile/fleece/towel) so top stitches don't sink. *Verify: grid present
   under the top layer on pile; longest-stitch safe.*
3. **Auto-branch upgrade** — move from greedy nearest-neighbor toward a true
   travel-optimizing pass (2-opt over runs) + hidden travel-run routing under
   coverage. *Verify: trims+jumps/1000 drops further on multi-region designs.*

### Phase B — CAD depth (matching the "design intent" richness)
4. **Bezier tangent handles** — draggable per-node tangents (we have corner↔curve
   tagging; this adds the "ears").
5. **Boolean shape ops** (union/subtract/intersect) + true **relief carving** via
   a fill router that parts rows around channels.
6. **More fill/where-light-catches craft** — contour/spiral fills, satin corner
   mitering, split-satin tuning, smart tatami angle per region.

### Phase C — production & ecosystem
7. **Multi-hoop** splitting for oversized designs.
8. **Templates + design organizer/library** (browse, reuse, batch — batch export
   already shipped).
9. **Performance at scale** — virtualize edit-view rendering + playback for
   10k–100k-stitch designs.
10. **Licensed thread charts** (Madeira/Isacord) once data is available — the
    matcher is already brand-agnostic.

## Out of scope (by the user's standing direction)
- **Sending designs to machines** (Wi-Fi/network) — we export files only.
- Multi-decoration (screen print, cutting, chenille) and 3D puff/foam.

## How we keep verifying
Headless: pure unit tests, the synthetic-user suite, and CPython `pyembroidery`
export validation across all five formats. Inherently visual work (TrueView,
blends, lettering, carving) is flagged for sew-out confirmation by eye — we tune
those by sample-out, not by guess.
