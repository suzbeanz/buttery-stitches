# 🧈 Buttery Stitches

A free machine-embroidery digitizer that runs **entirely in your browser**. Drop
in a logo, turn it into stitches, tidy it up in a vector-style editor, and export
a file your machine can actually read — PES, DST, JEF, EXP, or VP3. Nothing ever
leaves your computer.

**Live:** [buttery-stitches.suzie.fun](https://buttery-stitches.suzie.fun)

I made this because I wanted to digitize my own designs without paying for heavy
desktop software or uploading my art to someone's server. It's named after my
dog, Butters — hence the butter-yellow-and-navy theme, the serif wordmark, and
rulers styled like the marks on a stick of butter.

![Buttery Stitches editor](docs/hero.svg)

It's happiest with **clean logos, lettering, and limited-color artwork**. It is
*not* a photo converter — feed it a photograph and you'll get a rough, heavily
posterized result (with a warning). That's on purpose.

## What you can do

- **Auto-digitize an image.** Import a logo and it traces, simplifies, and turns
  it into fill/running objects — adjustable color count and detail, background
  removal, despeckle, smart **centerline outlines**, automatic **color
  consolidation**, per-color stitch style, and one-click match to real threads.
- **Add text.** Type something, pick a font (Oswald — tuned for embroidery — plus
  Poppins, Playfair Display, Roboto Slab, Pacifico), set the size, drop it in.
  Curve it onto a **circle** or along a **path** for badges and arches.
- **Draw by hand.** Running, satin, and fill tools, with a **Curve** mode for
  smooth lines instead of stiff polygons.
- **See real thread.** A "TrueView" 3D mode renders each stitch as lit, fuzzy
  floss — soft fibers and a downy halo — so the preview reads like the real
  stitch-out, not flat vector color.
- **Edit like vectors.** Move, scale, rotate, drag individual nodes, reorder the
  stitch sequence, copy/paste (⌘/Ctrl + C/V), tweak density and angles.
- **Outline a fill** with a satin border in another color, one click.
- **Size it to your hoop.** Hoop presets or custom, fit-to-hoop, aspect lock.
  Measurements are in **inches** by default (switch to mm anytime).
- **Watch it sew.** A stitch simulator redraws the design needle-by-needle so you
  can catch problems before you hoop a single thing.
- **Export & print.** PES/DST/JEF/EXP/VP3, plus a printable thread worksheet with
  the color order, swatches, and stitch counts.

## Stitch quality

The whole point is files that actually sew well. It's **pure math and logic — no
AI** — so every result is deterministic, explainable, and reproducible: the same
input always gives the same stitches.

**The fundamentals** are all baked in: low-density underlay (inset so it never
peeks past the top), push/pull compensation, tie-in/tie-off lock stitches so
threads don't pull out, minimum-stitch filtering so the needle doesn't jam, and
split throws on wide satin.

**Intelligent auto-digitizing** is where it tries to beat the desktop tools. It
reads the *shape* of each region and picks the stitch a hand digitizer would:

- **Smart shape recognition** snaps a wobbly trace to a clean circle, ellipse,
  rectangle, or regular polygon when that's clearly what it is.
- **Automatic stitch-type assignment** from the region's geometry — hairlines run
  down their centerline, strokes and lettering become satin columns, broad areas
  become tatami, and round shapes / thin ring-bands fill as concentric **contour**
  rows. A broad blob with a hole punched in it (a bun around a sausage) fills as
  flat tatami, not topographic rings.
- **Line-art over fills.** Auto-digitize separates each colour's *thin* regions —
  bold outlines, fur/detail strokes, and whole connected **outline networks** (a
  cartoon's black linework, a picture frame, a ring) — from its solid blobs, sewing
  them as clean **running lines down their centerline** (the line follows the
  stroke's own direction) laid ON TOP of the fills, the way a digitizer outlines a
  shape, instead of filling them into fragmented slivers, a heavy satin zig-zag, or
  a tatami slab over the whole silhouette. It catches a network even when its outer
  boundary is the whole subject by measuring the *true* wall width (holes
  subtracted), not the silhouette. Solid features (an eye, a nose) fill solid rather
  than spiralling as tiny contour rings.
- **Clean palette.** Near-duplicate shades that quantization splits off a flat
  region — anti-alias fringe, a faint shadow tone (one red becoming two reds) — are
  perceptually **consolidated** back together (area-aware, in CIELAB) so a flat fill
  doesn't fragment and thread slots aren't wasted, while genuinely distinct colours
  stay put.
- **Turning (directional) fills.** A curved, elongated shape — a banner, a leaf, a
  crescent, a sausage — is filled with rows that *follow the curve* (laid
  perpendicular to the shape's medial spine) instead of one flat angle, the way a
  hand digitizer would. Round, straight, notched, or fragmented shapes keep the
  fixed-angle fill; turning fill bows out cleanly (never slashes) when it doesn't fit.
- **Fewest-fragments fill angle** (the method in Wilcom's auto-digitize patent):
  the tatami angle is the one whose rows break the least across concavities, so a
  U fills as unbroken columns and an E's rows run across its prongs — fewer starts,
  stops, and travels. Convex and gently-organic shapes keep their natural grain.
- **Clean edges.** Each broad fill gets a finishing **edge run** just inside the
  outline so the silhouette and end-caps read crisp.
- **Concavity-aware fills.** Wavy, notched, and crescent shapes are filled with a
  **boustrophedon decomposition** — the region is split into cells and the fill
  travels *inside* the shape between them (or trims when the detour is too far),
  so the serpentine never slashes a stray thread across an open notch.
- **Trim economy.** Like a hand digitizer, it travels *under* existing stitches
  instead of cutting. Before any same-color move would trim, it looks for a path
  that stays hidden beneath the design's coverage (an A* over a coverage grid) and
  buries the travel there; contour rings additionally sew as one outer→inner
  **spiral**. A test crest's hot-dog dropped from 27 trims to 3 (only the
  unavoidable colour changes) — matching the ~1 trim / 1000 stitches of pro files.
- **Mitered satin junctions, short-stitched curves, knockdown/trapping** where
  fills meet, and **travel-optimized** sewing order (2-opt) to cut jumps.

The reasoning is written up in
[`docs/embroidery-quality.md`](docs/embroidery-quality.md) and
[`docs/stitch-logic.md`](docs/stitch-logic.md), and it's all pure, unit-tested
code — the same engine drives both the on-screen simulator and the exported file,
so what you see is what you get.

## The math behind the stitches

Every stage is plain geometry and arithmetic — no model, no randomness. Here's the
whole pipeline, image → machine file, with the actual formulas and the files they
live in. (Numbers below are the shipped defaults.)

**1 · Units & coordinate space** — everything internal is in **millimetres**. An
imported image is scaled to the hoop by
`mmPerPx = min(hoopW / imgW, hoopH / imgH) × 0.92` (a 0.92 fit margin) and centred
with `offset = (hoop − img × mmPerPx) / 2`. At export, mm convert to integer
**1/10 mm** machine units (`×10`). Each format caps a single stitch/jump move:
**121 units = 12.1 mm** for DST/EXP, **127 = 12.7 mm** for PES/JEF/VP3
(`MAX_STITCH_TENTHS`, `src/lib/export/index.ts`); longer travels are split into
chained moves under the cap, and any non-finite coordinate is filtered out.

**2 · Colour — quantization & perceptual distance** — the palette comes from
**k-means++**: seed with the mean colour, then repeatedly add the sample farthest
from every chosen centre, and run **12 Lloyd iterations** minimising squared-RGB
distance over up to 20 000 sampled pixels (`src/lib/trace/quantize.ts`). Matching
and merging happen in perceptual **CIELAB** using CIE76
`ΔE = √(ΔL² + Δa² + Δb²)` after an sRGB→Lab transform (`src/lib/thread/match.ts`).
The new fringe **consolidation** merges the closest qualifying pair when
`ΔE < 10` (true duplicate, any size) **or** `ΔE < 30` **and** the smaller colour is
`< 6%` of the design's area — area measured by the shoelace formula over each
colour's regions (`src/lib/thread/reduce.ts`). A final optional snap maps each
colour to the nearest real thread in a chart (same ΔE metric).

**3 · Vectorize — simplify & smooth** — traced outlines are thinned with
**Douglas–Peucker** at a tolerance that tracks the Detail control (≈0.15 mm
detailed → 0.5 mm smoother), then rounded with **Catmull–Rom** /
corner-preserving smoothing so curves read clean without rounding off real corners
(`src/lib/trace/simplify.ts`, `src/lib/smooth.ts`).

**4 · Classify each region** — for every region: shoelace area
`A = ½|Σ(xᵢyᵢ₊₁ − xᵢ₊₁yᵢ)|`, perimeter `P`, mean width `w ≈ 2A / P`, and
`elongation = (P / 2) / w`. A region becomes **line art** when it's thin and truly
elongated (`w < 2.2 mm`, length `≥ 5 mm`, `elongation ≥ 3.5`) **or** it's a thin
**holey network**: subtract the holes to get `inkArea = A − ΣholeArea`, then
`wallWidth = 2·inkArea / (Pₒᵤₜₑᵣ + ΣPₕₒₗₑ)` and `inkFraction = inkArea / A`; it's a
network when `wallWidth < 3 mm` and `inkFraction < 0.5` (`src/lib/trace/index.ts`,
`src/lib/trace/classify.ts`). Otherwise it's a solid fill.

**5 · Centerlines — the medial axis** — line-art regions are skeletonised
(`src/lib/engine/medial.ts`): rasterize to a grid (cell `= clamp(span / 60, 0.12,
0.4) mm`, winding-number inside test), run a **Chamfer (3, 4) distance transform**,
**Zhang–Suen thin** to a one-pixel skeleton, and trace it into polylines that chain
intelligently through junctions. Each skeleton point ray-casts to the *true* drawn
edges to recover local width, and columns are mitred where branches meet.

**6 · Satin columns** — from a centerline, rails are offset `± width/2`
(`railsFromCenterline`, `src/lib/geometry.ts`); the zig-zag "throws" advance along
the rails until **whichever rail has moved one stitch spacing** (density
compensation keeps the outside of a curve from gapping). **Pull compensation**
widens the column by `pullComp` (default 0.2 mm, clamped 0–0.6) to counter thread
draw-in. Columns wider than **6 mm** split each throw so no stitch overshoots;
columns thinner than the run threshold (1.2 mm for line art, 0.6 mm otherwise)
collapse to a single **running line** down the centerline (`src/lib/engine/index.ts`).

**7 · Fills** — a **tatami** fill lays parallel rows spaced by `density` mm, each
row sampled at the stitch length (2.5 mm default, 4 mm for broad fill), at the
**fewest-fragments angle** — the grain whose rows break the least across the
shape's concavities — over a **boustrophedon** cell decomposition so the serpentine
travels *inside* the shape instead of slashing across a notch. A finishing **edge
run** is inset 0.4 mm inside the outline for a crisp silhouette. **Contour** fills
lay concentric offset rings at `density` spacing and sew outer→inner as one spiral.
**Running** = the path resampled at `stitchLength`; **bean** = N back-and-forth
repeats per segment (`src/lib/engine/*`).

**8 · Density, underlay & compensation** — `density` is the **gap in mm between
rows/stitches**, so stitches-per-mm `= 1 / density`; defaults are 0.35 mm (fill) and
0.4 mm (satin), clamped to a machine-safe **0.3–0.5 mm** (`src/lib/fix.ts`). A
low-density **underlay** pass is added (inset so it never peeks past the top), and a
**fabric preset** bends the numbers — knit packs rows `×0.9` and pulls `×1.5`, sheer
the opposite (`FABRICS`, `src/types/project.ts`). A **min-stitch filter** drops
sub-0.3 mm stitches so the needle doesn't jam, and **tie-in/tie-off** locks
(amplitude 0.8 mm, 3 stitches) anchor every thread end.

**9 · Order & trim economy** — within a colour, object order is optimised with
**2-opt** to cut jumps; before any same-colour move would cut the thread, an **A\***
search over a 1 mm coverage grid looks for a route buried *under* existing stitches
(up to a ~60 mm detour) and travels there instead of trimming — the way a hand
digitizer hides a jump (`src/lib/engine/index.ts`). A real file lands near
~1 trim / 1000 stitches.

**10 · Export** — the resolved plan becomes a list of 1/10 mm integer opcodes
(stitch / jump / trim / stop); a colour change emits a trim + stop, over-long moves
are split to the format cap, and [`pyembroidery`](https://github.com/EmbroideryHub/pyembroidery)
(run in-browser via Pyodide) encodes the binary PES/DST/JEF/EXP/VP3
(`src/lib/export/index.ts`, `src/lib/export/embroidery.py`).

The same numbers drive the on-screen simulator and the exported file, and every
formula above is covered by unit tests.

## How it works under the hood

- **No backend.** It's just static files. Your images and designs stay on your
  machine — and there's **no third-party request on load**: the web fonts are
  self-hosted (Latin subsets vendored by `scripts/fetch-fonts.mjs`), not pulled
  from Google Fonts. A strict **Content-Security-Policy** (a `<meta>` tag, since
  a static host can't set headers) locks origins down to `'self'` plus exactly
  what Pyodide needs on demand. The only network call the app ever makes is
  fetching the Pyodide runtime from a CDN the first time you export — and even
  that uploads nothing.
- **Real file formats, not my homegrown guesses.** Writing PES/DST/etc. is handled
  by [`pyembroidery`](https://github.com/EmbroideryHub/pyembroidery), run in the
  browser with [Pyodide](https://pyodide.org/) (WebAssembly).
- **Everything is in millimeters internally**; it only converts to the embroidery
  format's units at the moment of export. Keeps the math sane.
- **The `.embproj` file is the source of truth** — plain JSON with your colors,
  objects, and their order (which *is* the stitch sequence). It's lossless and
  re-editable. An exported `.pes` is lossy, so don't try to round-trip it back.

## Privacy, security & accessibility

- **Privacy by construction.** No server, no analytics, no telemetry. Images and
  designs never leave the browser; uncaught errors are kept in a small in-memory
  log you can optionally **download as a redacted report** (no design data) to
  attach to a bug — nothing is sent anywhere (`src/lib/log.ts`).
- **Hardened delivery.** Strict CSP, self-hosted fonts, no third-party requests
  on load (verified in CI by `e2e/csp.spec.ts`).
- **Accessible.** Labelled landmarks and controls, `aria-pressed`/`aria-selected`
  toggles, focus-trapped dialogs that restore focus, a global focus-visible ring,
  live-region announcements (incl. a text description of the canvas for screen
  readers), and assertive error toasts. Accessibility is enforced two ways:
  component-level axe checks in the unit suite (`src/test/a11y.dom.test.tsx`) and
  full-page axe scans across desktop + mobile viewports in the e2e suite
  (`e2e/a11y.spec.ts`).

## Run it locally

```bash
npm install
npm run dev        # dev server
npm test           # unit + component tests (incl. axe a11y checks)
npm run typecheck  # types
npm run lint       # lint
npm run build      # production build (tsc -b + vite)
npm run e2e        # Playwright end-to-end (needs `npx playwright install chromium`)
```

Needs Node 22. CI runs the unit gate, the Playwright e2e suite (desktop +
mobile, with axe and CSP checks), and a Lighthouse pass (`lighthouserc.json`,
warn-level budgets) on every pull request.

To refresh the self-hosted fonts after a design-system change:

```bash
node scripts/fetch-fonts.mjs   # re-vendors Latin woff2 + regenerates src/fonts.css
```

## Keyboard shortcuts

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `V` | Select | `⌘/Ctrl Z` / `⇧Z` | Undo / Redo |
| `N` | Node edit | `⌘/Ctrl C` / `V` | Copy / Paste |
| `R` `S` `F` | Running / Satin / Fill | `⌘/Ctrl D` | Duplicate |
| `Enter` / `Esc` | Finish / cancel a shape | `⌘/Ctrl S` | Save `.embproj` |
| `Del` | Delete selection | `P` | Toggle stitch view |
| `?` | Shortcut help | `Space` | Play / pause simulation |

## Hosting

It deploys itself to GitHub Pages on every push to `main` (see
`.github/workflows/deploy.yml`). The build uses a relative base path, so it'll
run from any static host or sub-path too.

## License

MIT — see [LICENSE](LICENSE). Built on some lovely open-source work:
`pyembroidery` (MIT), `imagetracerjs` (Unlicense), `opentype.js` (MIT), Konva
(MIT), Zustand + zundo (MIT), and the bundled fonts (SIL OFL 1.1). See
[CONTRIBUTING.md](CONTRIBUTING.md) if you'd like to poke at it.
