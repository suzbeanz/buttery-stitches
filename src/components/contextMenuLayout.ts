/** Menu width (px) — matches the `w-52` Tailwind class on the context menu. */
export const MENU_W = 208;

/**
 * Clamp the context menu's top-left so the whole menu stays on-screen near every
 * edge. On touch the rows are finger-sized, so a 20-action menu is tall — we
 * estimate its height from the row count (coarse pointer ⇒ taller rows) and pin
 * it inside the viewport. Pure so the on-screen guarantee is unit-tested without
 * a browser.
 */
export function clampMenu(
  x: number,
  y: number,
  itemCount: number,
  vw: number,
  vh: number,
  coarse: boolean,
  margin = 8,
): { left: number; top: number; maxHeight: number } {
  const rowH = coarse ? 46 : 30;
  const maxHeight = vh - margin * 2;
  const estH = Math.min(maxHeight, itemCount * rowH + margin * 2);
  const left = Math.max(margin, Math.min(x, vw - MENU_W - margin));
  const top = Math.max(margin, Math.min(y, vh - estH - margin));
  return { left, top, maxHeight };
}
