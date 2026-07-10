/**
 * Registry of the fonts bundled with Buttery Stitches, plus helpers to parse a
 * font with opentype.js. Everything here is fully offline: the .ttf files live
 * in src/lib/text/fonts and are imported with Vite's `?url` so they are bundled
 * into the app and fetched relatively at runtime — no network, no CDN.
 *
 * Every bundled face is open-source — SIL Open Font License 1.1 (OFL) or Apache
 * License 2.0 — both of which permit bundling and redistribution. The set leans
 * toward MEDIUM/BOLD weights with fairly even stroke widths, because those satin
 * and fill cleanly; hairline faces are avoided (a thin stroke can't hold a satin
 * column). Per-face license is recorded on each entry below.
 */
import { parse as parseOpentype } from "opentype.js";
import type { Font } from "opentype.js";

// `?url` makes Vite emit the file as an asset and hand back its final URL.
import poppinsUrl from "./fonts/Poppins-SemiBold.ttf?url";
import montserratUrl from "./fonts/Montserrat-SemiBold.ttf?url";
import oswaldUrl from "./fonts/Oswald-Medium.ttf?url";
import playfairUrl from "./fonts/PlayfairDisplay-Bold.ttf?url";
import robotoSlabUrl from "./fonts/RobotoSlab-Bold.ttf?url";
import bebasNeueUrl from "./fonts/BebasNeue-Regular.ttf?url";
import titanOneUrl from "./fonts/TitanOne-Regular.ttf?url";
import permanentMarkerUrl from "./fonts/PermanentMarker-Regular.ttf?url";
import pacificoUrl from "./fonts/Pacifico-Regular.ttf?url";
import lobsterUrl from "./fonts/Lobster-Regular.ttf?url";
import dancingScriptUrl from "./fonts/DancingScript-Bold.ttf?url";
import greatVibesUrl from "./fonts/GreatVibes-Regular.ttf?url";
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
  // — Flagship embroidery face —
  // Oswald leads the list and is the default: a condensed sans with very even,
  // medium-weight strokes and simple letterforms, so the engine lays clean satin
  // columns the full length of every stroke and cap. It is the face that digitizes
  // most crisply across the whole alphabet, so it is what we put first.
  { id: "oswald", name: "Oswald (flagship · embroidery)", url: oswaldUrl, license: "OFL-1.1" },
  // — Sans —
  { id: "poppins", name: "Poppins (sans)", url: poppinsUrl, license: "OFL-1.1" },
  { id: "montserrat", name: "Montserrat (sans)", url: montserratUrl, license: "OFL-1.1" },
  // — Serif / slab —
  { id: "playfair", name: "Playfair Display (serif)", url: playfairUrl, license: "OFL-1.1" },
  { id: "roboto-slab", name: "Roboto Slab (slab serif)", url: robotoSlabUrl, license: "Apache-2.0" },
  // — Display —
  { id: "bebas-neue", name: "Bebas Neue (display)", url: bebasNeueUrl, license: "OFL-1.1" },
  { id: "titan-one", name: "Titan One (bold round)", url: titanOneUrl, license: "OFL-1.1" },
  { id: "permanent-marker", name: "Permanent Marker", url: permanentMarkerUrl, license: "Apache-2.0" },
  // — Script / handwriting —
  { id: "pacifico", name: "Pacifico (script)", url: pacificoUrl, license: "OFL-1.1" },
  { id: "lobster", name: "Lobster (script)", url: lobsterUrl, license: "OFL-1.1" },
  { id: "dancing-script", name: "Dancing Script (script)", url: dancingScriptUrl, license: "OFL-1.1" },
  { id: "great-vibes", name: "Great Vibes (formal script)", url: greatVibesUrl, license: "OFL-1.1" },
  { id: "caveat", name: "Caveat (handwriting)", url: caveatUrl, license: "OFL-1.1" },
];

export const DEFAULT_FONT_ID = "oswald";

/**
 * Parse a font from an ArrayBuffer. Kept separate from any fetching so it is
 * pure and node-testable (a test can read a .ttf with fs and feed the buffer).
 */
export function parseFont(buffer: ArrayBuffer): Font {
  return parseOpentype(buffer);
}

const cache = new Map<string, Promise<Font>>();

/** Drop a cached parse (after re-importing or removing a custom font). */
export function invalidateFontCache(id: string): void {
  cache.delete(id);
}

/**
 * Load and parse a font by id, caching the parsed result so repeated use
 * (live preview, multiple text objects) never re-fetches or re-parses.
 * Bundled ids resolve from the shipped assets; `user-…` ids resolve from the
 * imported-fonts store (IndexedDB), so a project that names a custom font
 * keeps working as long as that font is present on this machine.
 * Browser-only (uses fetch / IndexedDB).
 */
export function loadFont(id: string): Promise<Font> {
  if (id.startsWith("user-")) {
    const cachedUser = cache.get(id);
    if (cachedUser) return cachedUser;
    const promise = import("./customFonts")
      .then((m) => m.getCustomFontBytes(id))
      .then((bytes) => {
        if (!bytes)
          throw new Error(
            "This text uses an imported font that isn't on this machine — re-import it in the Words dialog, or pick another font.",
          );
        return parseFont(bytes);
      })
      .catch((err) => {
        cache.delete(id);
        throw err;
      });
    cache.set(id, promise);
    return promise;
  }
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
