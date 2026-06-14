/**
 * Small id helper. Uses crypto.randomUUID when available (all modern
 * browsers and Node 19+), with a cheap fallback for odd environments.
 */
export function newId(prefix = "id"): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const uuid =
    g.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${uuid}`;
}
