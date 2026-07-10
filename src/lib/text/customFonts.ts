import type { Font } from "opentype.js";
import { parseFont } from "./fonts";

/**
 * User-imported fonts (TTF/OTF). The bundled set is deliberately small and
 * license-clean; anyone can bring their OWN faces — a purchased embroidery
 * font, a brand's corporate face — and they run through the exact same
 * opentype.js → layout → digitize pipeline as the bundled ones.
 *
 * Font files are megabyte-scale, so they persist in IndexedDB (not
 * localStorage). Projects store only the font ID; opening a project on a
 * machine without that font falls back with a clear warning rather than
 * breaking the document.
 */

export interface CustomFontMeta {
  /** always `user-…` so it can never collide with a bundled id. */
  id: string;
  /** display name from the font's own name table (fallback: file name). */
  name: string;
  /** rough digitizing suitability note computed at import ("" = looks good). */
  note: string;
}

const DB_NAME = "bs-fonts";
const STORE = "fonts";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Couldn't open the font store."));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("Font store error."));
      }),
  );
}

/** Stable id from the display name (collisions just overwrite — same font). */
function fontId(name: string): string {
  return (
    "user-" +
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

/**
 * Parse + sanity-check an imported font buffer. Pure (node-testable). Throws a
 * friendly Error for non-font files; returns the parsed font, its meta, and a
 * one-line digitizing-suitability note when the face may stitch poorly.
 */
export function parseImportedFont(
  buffer: ArrayBuffer,
  filename: string,
): { font: Font; meta: CustomFontMeta } {
  let font: Font;
  try {
    font = parseFont(buffer);
  } catch {
    throw new Error("That file couldn't be read as a font — use a .ttf or .otf.");
  }
  // opentype.js v2 namespaces the name table (windows/macintosh/unicode).
  const names = font.names as unknown as Record<string, { fullName?: Record<string, string> } | undefined>;
  const fullName =
    names?.windows?.fullName ?? names?.unicode?.fullName ?? names?.macintosh?.fullName;
  const displayName: string =
    fullName?.en ?? Object.values(fullName ?? {})[0] ?? filename.replace(/\.(ttf|otf)$/i, "");

  // Must actually cover basic Latin, or lettering silently comes out blank.
  const probe = "AaBb0";
  const missing = [...probe].filter((ch) => {
    const g = font.charToGlyph(ch);
    return !g || g.index === 0;
  });
  if (missing.length > 0) {
    throw new Error(
      `"${displayName}" is missing basic Latin letters — it can't be used for lettering.`,
    );
  }

  // Digitizing-suitability heuristic: compare lower-case 'l' stem width to the
  // cap height. Hairline faces (stem below ~4% of cap) can't hold a satin
  // column at typical lettering sizes — the engine will fall back to running
  // stitch, which reads thin. Warn, don't block: the user may want exactly that.
  let note = "";
  try {
    const upm = font.unitsPerEm || 1000;
    const l = font.charToGlyph("l");
    const bb = l.getBoundingBox();
    const stemFrac = (bb.x2 - bb.x1) / upm;
    if (stemFrac > 0 && stemFrac < 0.04) {
      note = "Very thin strokes — may stitch as running lines instead of satin. Bold faces embroider best.";
    }
  } catch {
    // metrics probe is best-effort
  }

  return { font, meta: { id: fontId(displayName), name: displayName, note } };
}

/** Save an imported font's bytes + meta. Returns the meta. */
export async function saveCustomFont(meta: CustomFontMeta, bytes: ArrayBuffer): Promise<CustomFontMeta> {
  await tx("readwrite", (s) => s.put({ id: meta.id, name: meta.name, note: meta.note, bytes }));
  return meta;
}

/** List imported fonts (meta only — no byte payloads). */
export async function listCustomFonts(): Promise<CustomFontMeta[]> {
  try {
    const all = await tx<{ id: string; name: string; note?: string }[]>("readonly", (s) => s.getAll() as IDBRequest<{ id: string; name: string; note?: string }[]>);
    return all.map((f) => ({ id: f.id, name: f.name, note: f.note ?? "" }));
  } catch {
    return []; // private mode / IDB unavailable — imports just don't persist
  }
}

/** Fetch an imported font's bytes (null when absent on this machine). */
export async function getCustomFontBytes(id: string): Promise<ArrayBuffer | null> {
  try {
    const rec = await tx<{ bytes: ArrayBuffer } | undefined>("readonly", (s) => s.get(id) as IDBRequest<{ bytes: ArrayBuffer } | undefined>);
    return rec?.bytes ?? null;
  } catch {
    return null;
  }
}

export async function removeCustomFont(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

/** Is this a user-imported font id? */
export function isCustomFontId(id: string): boolean {
  return id.startsWith("user-");
}
