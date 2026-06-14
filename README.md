# 🧈 Buttery Stitches

> A free, open-source, **fully client-side** machine-embroidery digitizer that
> runs entirely in your browser. Upload a logo, auto-convert it to stitches,
> clean it up in a vector-style editor, and export to PES, DST, JEF, EXP, and
> VP3 — all without anything ever leaving your machine.

> _Smooth as butter._ The app wears a butter theme: butter-yellow + navy, a
> classic serif wordmark, and rulers styled after the measurement guides printed
> on a stick of butter.

![Buttery Stitches editor](docs/hero.svg)

Buttery Stitches is built for **clean logos, line art, text, and limited-colour
designs** (≤ ~8 colours). Photo-realistic auto-digitizing is an explicit
non-goal — drop in a photo and you'll get a rough, aggressively quantized
result with a warning, not a miracle.

## Using it

1. **Start a design** — draw with the Running / Satin / Fill tools, or click
   **Import image** to auto-digitize a logo (adjust colours, remove background).
2. **Refine** — Select to move / scale / rotate, Node to drag vertices, edit
   stitch params on the right, drag layers to reorder the stitch sequence.
3. **Size it** — pick a hoop and **Fit to hoop**; resizing re-densifies.
4. **Watch it sew** — switch to **Stitch view** and press Play to redraw the
   design stitch-by-stitch.
5. **Export** — PES (primary) plus DST/JEF/EXP/VP3, and print a **thread
   worksheet**.

## Why it's built this way

- **No backend.** The whole app is static files; host it on GitHub Pages or any
  static host. Your uploaded images never touch a server.
- **Don't reinvent the embroidery file formats.** Writing PES/DST/etc. is done
  by [`pyembroidery`](https://github.com/EmbroideryHub/pyembroidery) — a mature,
  pure-Python library — run in the browser via [Pyodide](https://pyodide.org/)
  (WebAssembly). Its internal unit is 1/10 mm.
- **Millimetres everywhere in the app.** We only convert to pyembroidery's
  1/10 mm units at export. This keeps the stitch-math readable and testable.

## Project status

Built in phases (see the spec). Current progress:

- [x] **Phase 0 — Scaffold.** Vite + React + TS + Tailwind + Zustand. Three-region
      editor shell (layers / canvas / properties), project data model, undo/redo,
      and lossless `.embproj` save/load.
- [x] **Phase 1 — File I/O proven.** Pyodide loads from CDN, micropip installs
      pyembroidery, and the app exports a sample square to PES/DST/JEF/EXP/VP3.
      The WASM path is de-risked by a reproducible script — `npm run derisk` —
      that installs pyembroidery under Pyodide and writes all five formats. **No
      backend fallback is needed.**
- [x] **Phase 2 — Manual editor.** Draw running/satin/fill objects; **Select**
      tool to move + scale/rotate (transforms baked back to mm); **Node** tool to
      drag vertices; reorder the stitch sequence; visibility/delete; editable
      satin column width; thread-colour management; butter rulers (mm/inch).
      QA via synthetic user testing — see [`docs/QA-phase2.md`](docs/QA-phase2.md).
- [x] **Phase 3 — Stitch engine.** Pure, unit-tested stitch generation —
      running (exact endpoint landing), satin (zig-zag, pull comp, throw
      splitting), tatami fill (angled scan-line clipping with holes + brick
      stagger), and underlay. A sequencer assembles objects into one event stream
      with jumps/trims/colour-changes that drives **both** the live stitch
      simulator (play / scrub / speed) **and** the exporter — so preview and file
      always agree. Real designs now export (the Phase 1 sample square is gone),
      with live stitch counts and validation warnings.
- [x] **Phase 4 — Auto-digitize.** Import an image → quantize + trace
      (imagetracerjs) → simplify (Douglas–Peucker) → classify (blob ⇒ fill,
      sliver ⇒ running, holes via even-odd) → stitch objects, grouped by colour,
      sized & centred in the hoop. Adjustable colour count (2–12), background
      removal, despeckle, and a photo-complexity warning. The dialog lazy-loads
      the tracer so it doesn't weigh down first paint. Everything stays on your
      machine.
- [x] **Phase 5 — Sizing, hoops, validation, worksheet.** Hoop presets + custom
      sizes; design resize with aspect-lock and fit-to-hoop that **re-densifies**
      (scales geometry, not stitch points — verified by test). Live design-wide
      validation warnings in the Design panel. Thread brand/code editing and a
      printable **thread worksheet** (colour order, swatches, brand/code, stitch
      counts, estimated run time) opened as a self-contained print/PDF page.
- [x] **Phase 6 — Polish & deploy.** Keyboard shortcuts + in-app help (`?`),
      empty-state guidance, a CI workflow, and a GitHub Pages deploy workflow
      (the build is base-path-relative, so it serves from any sub-path).

## Tech stack

| Concern              | Choice |
| -------------------- | ------ |
| Framework            | React + TypeScript + Vite |
| Styling              | Tailwind CSS |
| State / undo-redo    | Zustand + zundo |
| Canvas / geometry    | Konva (react-konva); path math in plain TS |
| Raster → vector + quantize | imagetracerjs (per-colour layers) |
| Embroidery file I/O  | pyembroidery via Pyodide (WASM) _(Phase 1)_ |
| Tests                | Vitest (stitch math) + Playwright (e2e smoke) |

## The project file (`.embproj`)

A `.embproj` is plain JSON describing the whole design in millimetres — colours,
objects, and the object **order, which is the stitch sequence**. It is lossless
and re-editable, and it is the **source of truth**. An exported `.pes` is lossy;
never edit the PES and expect to round-trip it back.

See [`src/types/project.ts`](src/types/project.ts) for the full model.

## Develop

```bash
npm install
npm run dev        # start the dev server
npm test           # unit + component tests (Vitest)
npm run build      # type-check + production build
npm run typecheck  # type-check only
npm run e2e        # Playwright smoke (needs: npx playwright install chromium)
npm run derisk     # prove pyembroidery works under Pyodide
```

Requires Node 18+.

## Keyboard shortcuts

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `V` | Select | `⌘/Ctrl Z` | Undo |
| `N` | Node edit | `⌘/Ctrl ⇧ Z` | Redo |
| `R` `S` `F` | Running / Satin / Fill | `⌘/Ctrl S` | Save `.embproj` |
| `Enter` / `Esc` | Finish / cancel a shape | `P` | Toggle stitch view |
| `Del` | Delete selection | `Space` | Play / pause simulation |
| `?` | Shortcut help | | |

## Deploy (GitHub Pages)

Push to `main` and the included workflow builds and publishes to Pages
automatically — just enable **Settings → Pages → Source: GitHub Actions** once.
The Vite build uses a relative base path, so it also works from any static host
or sub-path. Nothing talks to a server at runtime (Pyodide loads from a CDN on
first export; self-host those files for a fully offline deployment).

## Licensing

StitchForge is MIT-licensed (see [LICENSE](LICENSE)). Key dependencies are
MIT/compatible: `pyembroidery` (MIT), `imagetracerjs` (Public Domain/Unlicense),
RgbQuant.js (MIT), Konva (MIT), Zustand (MIT). Licences are re-verified as each
dependency is actually added.

See [CONTRIBUTING.md](CONTRIBUTING.md) to get involved.
