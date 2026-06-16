/**
 * Small id helper. Uses crypto.randomUUID when available (all modern
 * browsers and Node 19+), with a cheap fallback for odd environments.
 */
let fallbackSeq = 0;
export function newId(prefix = "id"): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  // A monotonic counter in the fallback guarantees uniqueness even when many ids
  // are minted in the same millisecond (e.g. auto-digitize spawning shapes).
  const uuid =
    g.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${(fallbackSeq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${uuid}`;
}
