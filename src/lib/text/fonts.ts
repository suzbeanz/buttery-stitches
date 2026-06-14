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
import robotoSlabUrl from "./fonts/RobotoSlab-Bold.ttf?url";

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
 * The bundled font set: a clean sans, a serif that echoes the wordmark, a
 * friendly script, and a sturdy slab. All OFL 1.1.
 */
export const FONTS: FontEntry[] = [
  {
    id: "poppins",
    name: "Poppins (sans)",
    url: poppinsUrl,
    license: "OFL-1.1",
  },
  {
    id: "playfair",
    name: "Playfair Display (serif)",
    url: playfairUrl,
    license: "OFL-1.1",
  },
  {
    id: "pacifico",
    name: "Pacifico (script)",
    url: pacificoUrl,
    license: "OFL-1.1",
  },
  {
    id: "roboto-slab",
    name: "Roboto Slab (slab)",
    url: robotoSlabUrl,
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
