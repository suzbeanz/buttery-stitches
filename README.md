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
  it into fill/running objects — adjustable color count, background removal,
  despeckle.
- **Add text.** Type something, pick a font (Poppins, Playfair Display, Pacifico,
  Roboto Slab), set the size, drop it in.
- **Draw by hand.** Running, satin, and fill tools, with a **Curve** mode for
  smooth lines instead of stiff polygons.
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

The whole point is files that actually sew well, so the engine bakes in the
fundamentals: low-density underlay, push/pull compensation, tie-in/tie-off lock
stitches so threads don't pull out, minimum-stitch filtering so the needle
doesn't jam, and split throws on wide satin. The reasoning is written up in
[`docs/embroidery-quality.md`](docs/embroidery-quality.md), and it's all pure,
unit-tested code — the same engine drives both the on-screen simulator and the
exported file, so what you see is what you get.

## How it works under the hood

- **No backend.** It's just static files. Your images and designs stay on your
  machine.
- **Real file formats, not my homegrown guesses.** Writing PES/DST/etc. is handled
  by [`pyembroidery`](https://github.com/EmbroideryHub/pyembroidery), run in the
  browser with [Pyodide](https://pyodide.org/) (WebAssembly).
- **Everything is in millimeters internally**; it only converts to the embroidery
  format's units at the moment of export. Keeps the math sane.
- **The `.embproj` file is the source of truth** — plain JSON with your colors,
  objects, and their order (which *is* the stitch sequence). It's lossless and
  re-editable. An exported `.pes` is lossy, so don't try to round-trip it back.

## Run it locally

```bash
npm install
npm run dev        # dev server
npm test           # unit + component tests
npm run typecheck  # types
npm run lint       # lint
npm run build      # production build
```

Needs Node 22.

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
