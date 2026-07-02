# Third-party notices

Buttery Stitches is MIT-licensed (see `LICENSE`). It builds on the following
third-party work. Bundled npm dependencies (React, Konva, zustand, and friends)
are MIT-licensed; the notable or non-MIT components are listed explicitly:

## Runtime components

- **Pyodide** — the CPython-on-WebAssembly runtime, fetched on demand from the
  jsDelivr CDN (never bundled). Licensed under the **Mozilla Public License
  2.0** (https://github.com/pyodide/pyodide/blob/main/LICENSE). Pyodide is used
  unmodified; MPL-2.0's file-level copyleft applies to Pyodide's own files, not
  to this application.
- **pyembroidery** — embroidery file reading/writing, installed inside Pyodide
  from the wheel bundled at `public/wheels/` (pinned 1.5.1). Licensed under the
  **MIT License** (https://github.com/EmbroidePy/pyembroidery).
- **tesseract.js** (and its WASM core + language data, fetched on demand from
  jsDelivr) — OCR for the auto-digitizer's text recognition. Licensed under the
  **Apache License 2.0**.

## Bundled fonts (`src/lib/text/fonts/`)

Each face ships under an open font license permitting bundling and
redistribution; the license texts are included alongside the font files:

- **SIL Open Font License 1.1** (`src/lib/text/fonts/LICENSE-OFL.txt`):
  Oswald, Poppins, Montserrat, Playfair Display, Bebas Neue, Titan One,
  Pacifico, Lobster, Dancing Script, Great Vibes, Caveat.
- **Apache License 2.0** (`src/lib/text/fonts/LICENSE-Apache-2.0.txt`):
  Roboto Slab, Permanent Marker.

The per-face license is also recorded in code (`src/lib/text/fonts.ts`) and
enforced by a unit test that rejects any bundled face without an accepted
open license.

## Notable MIT-licensed dependencies

React, react-dom, Konva, react-konva, zustand, zundo, lucide-react,
imagetracerjs, opentype.js — see each package's `LICENSE` in `node_modules/`
or its repository.
