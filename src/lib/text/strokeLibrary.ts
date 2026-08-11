/**
 * FONT-LEVEL stroke library: hand-authored glyph strokes saved per
 * (font, character), so a correction made once applies to every future use
 * of that glyph — the full "embroidery font" loop. Strokes are stored
 * NORMALIZED to the glyph bbox ([nx,ny] in 0..1), the same frame as the
 * built-in authored alphabet, so layout maps them identically.
 *
 * Persistence is IndexedDB (like custom fonts); a synchronous in-memory
 * mirror serves the sync layout path — `primeStrokeLibrary()` loads it and
 * every save updates both.
 */
import type { Path } from "../../types/project";

export type NormStrokes = [number, number][][];

const DB_NAME = "bs-strokes";
const STORE = "glyphs";

/** Sync mirror: fontId -> char -> normalized strokes. */
const mirror = new Map<string, Map<string, NormStrokes>>();
let primed = false;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Couldn't open the stroke library."));
  });
}

/** Load every saved glyph into the sync mirror. Safe to call repeatedly;
 *  no-ops outside a browser (tests seed the mirror directly). */
export async function primeStrokeLibrary(): Promise<void> {
  if (primed || typeof indexedDB === "undefined") return;
  primed = true;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        for (const rec of req.result as { key: string; strokes: NormStrokes }[]) {
          const i = rec.key.indexOf(":");
          if (i <= 0) continue;
          seedMirror(rec.key.slice(0, i), rec.key.slice(i + 1), rec.strokes);
        }
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    // No library yet (or blocked storage) — layout falls back to auto strokes.
  }
}

function seedMirror(fontId: string, ch: string, strokes: NormStrokes): void {
  let perFont = mirror.get(fontId);
  if (!perFont) {
    perFont = new Map();
    mirror.set(fontId, perFont);
  }
  perFont.set(ch, strokes);
}

/** Sync lookup for the layout path. */
export function libraryGlyphStrokes(fontId: string | undefined, ch: string | undefined): NormStrokes | null {
  if (!fontId || !ch) return null;
  return mirror.get(fontId)?.get(ch) ?? null;
}

/** Persist strokes for one glyph (and update the sync mirror). */
export async function saveGlyphStrokes(fontId: string, ch: string, strokes: NormStrokes): Promise<void> {
  seedMirror(fontId, ch, strokes);
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ key: `${fontId}:${ch}`, strokes });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Characters with saved strokes for a font (from the mirror). */
export function listAuthoredGlyphs(fontId: string): string[] {
  return [...(mirror.get(fontId)?.keys() ?? [])];
}

export async function removeGlyphStrokes(fontId: string, ch: string): Promise<void> {
  mirror.get(fontId)?.delete(ch);
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(`${fontId}:${ch}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Normalize absolute-mm strokes to a glyph bbox (the storage frame). */
export function normalizeStrokes(
  strokes: Path[],
  b: { minX: number; minY: number; maxX: number; maxY: number },
): NormStrokes {
  const w = Math.max(1e-6, b.maxX - b.minX);
  const h = Math.max(1e-6, b.maxY - b.minY);
  return strokes.map((st) => st.map((p): [number, number] => [(p.x - b.minX) / w, (p.y - b.minY) / h]));
}

/** TEST ONLY: seed the mirror directly. */
export function __seedForTests(fontId: string, ch: string, strokes: NormStrokes): void {
  seedMirror(fontId, ch, strokes);
}
