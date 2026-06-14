/**
 * Registry of the fonts bundled with Buttery Stitches, plus helpers to parse a
 * font with opentype.js. Everything here is fully offline: the .ttf files live
 * in src/lib/text/fonts and are imported with Vite's `?url` so they are bundled
 * into the app and fetched relatively at runtime — no network, no CDN.
 *
 * Every bundled face is licensed under the SIL Open Font License 1.1 (OFL),
 * which permits bundling and redistribution. License text travels with each
 * font's npm package (the LICENSE_FONT file in @expo-google-fonts/*).
 */
import { parse as parseOpentype } from "opentype.js";
import type { Font } from "opentype.js";

// `?url` makes Vite emit the file as an asset and hand back its final URL.
import poppinsUrl from "./fonts/Poppins-SemiBold.ttf?url";
import playfairUrl from "./fonts/PlayfairDisplay-Bold.ttf?url";
import pacificoUrl from "./fonts/Pacifico-Regular.ttf?url";
import montserratUrl from "./fonts/Montserrat-SemiBold.ttf?url";
import lobsterUrl from "./fonts/Lobster-Regular.ttf?url";
import dancingScriptUrl from "./fonts/DancingScript-Bold.ttf?url";
import bebasNeueUrl from "./fonts/BebasNeue-Regular.ttf?url";
import caveatUrl from "./fonts/Caveat-Bold.ttf?url";

export interface FontEntry {
  /** stable id stored nowhere persistent — used only by the dialog UI. */
  id: string;
  /** human-readable name shown in the picker. */
  name: string;
  /** runtime URL of the bundled .ttf (relative, offline). */
  url: string;
  /** license identifier for the bundled face. */
  license: string;
}

/**
 * The bundled font set: clean sans faces, serifs that echo the wordmark,
 * friendly scripts, a sturdy slab, and a tall condensed display face. Every
 * face ships under the SIL Open Font License 1.1 (OFL-1.1).
 */
export const FONTS: FontEntry[] = [
  {
    id: "poppins",
    name: "Poppins (sans)",
    url: poppinsUrl,
    license: "OFL-1.1",
  },
  {
    id: "montserrat",
    name: "Montserrat (sans)",
    url: montserratUrl,
    license: "OFL-1.1",
  },
  {
    id: "playfair",
    name: "Playfair Display (serif)",
    url: playfairUrl,
    license: "OFL-1.1",
  },
  {
    id: "bebas-neue",
    name: "Bebas Neue (display)",
    url: bebasNeueUrl,
    license: "OFL-1.1",
  },
  {
    id: "pacifico",
    name: "Pacifico (script)",
    url: pacificoUrl,
    license: "OFL-1.1",
  },
  {
    id: "lobster",
    name: "Lobster (script)",
    url: lobsterUrl,
    license: "OFL-1.1",
  },
  {
    id: "dancing-script",
    name: "Dancing Script (script)",
    url: dancingScriptUrl,
    license: "OFL-1.1",
  },
  {
    id: "caveat",
    name: "Caveat (handwriting)",
    url: caveatUrl,
    license: "OFL-1.1",
  },
];

export const DEFAULT_FONT_ID = "poppins";

/**
 * Parse a font from an ArrayBuffer. Kept separate from any fetching so it is
 * pure and node-testable (a test can read a .ttf with fs and feed the buffer).
 */
export function parseFont(buffer: ArrayBuffer): Font {
  return parseOpentype(buffer);
}

const cache = new Map<string, Promise<Font>>();

/**
 * Load and parse a bundled font by id, caching the parsed result so repeated
 * use (live preview, multiple text objects) never re-fetches or re-parses.
 * Browser-only (uses fetch against the bundled asset URL).
 */
export function loadFont(id: string): Promise<Font> {
  const entry = FONTS.find((f) => f.id === id);
  if (!entry) {
    return Promise.reject(new Error(`Unknown font id: ${id}`));
  }
  const cached = cache.get(id);
  if (cached) return cached;

  const promise = fetch(entry.url)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load font ${id}: ${res.status}`);
      return res.arrayBuffer();
    })
    .then((buf) => parseFont(buf))
    .catch((err) => {
      // Drop the rejected promise so a later attempt can retry.
      cache.delete(id);
      throw err;
    });

  cache.set(id, promise);
  return promise;
}
