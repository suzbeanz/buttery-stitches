import { test, expect } from "@playwright/test";

/**
 * Mobile-viewport sanity: the studio loads on a phone, and the side panels —
 * which collapse into slide-over drawers on narrow screens — can be opened from
 * the top bar. Runs on every project, but only really exercises the responsive
 * behavior on the mobile project's small viewport.
 */

test("studio loads and the layers drawer opens", async ({ page }) => {
  // The slide-over layers drawer only exists below the `sm` breakpoint; on a wide
  // desktop viewport the panel is shown inline (and the toggle hides it), so this
  // drawer-open flow is mobile-only.
  test.skip((page.viewportSize()?.width ?? 0) > 640, "layers drawer is mobile-only");
  await page.goto("/app");
  await expect(page.getByText(/Let's make something/i)).toBeVisible();

  // The drawing tools are always present.
  await expect(page.getByRole("button", { name: "Select" })).toBeVisible();

  // Open the layers panel from the top bar and confirm it appears.
  await page.getByRole("button", { name: /Show layers|Hide layers/ }).click();
  await expect(page.getByText(/Stitch Order/i)).toBeVisible();
});

test("phone layout: one-row top bar, unclipped quick-start, rail view toggle", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 640, "phone-only layout rules");
  await page.goto("/app");

  // Top bar keeps to a single unwrapped row — it wrapped to two on phones once,
  // halving the canvas. All nine controls must FIT (no sideways scroll), undo
  // through the properties toggle included.
  const header = page.locator("header");
  const box = await header.boundingBox();
  // One row ≈ 61px (44px coarse-pointer tap height + padding); a wrap ≈ 105px.
  expect(box!.height).toBeLessThan(70);
  const overflow = await header.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByRole("button", { name: /^Undo/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Show properties|Hide properties/ })).toBeVisible();

  // The quick-start card sits fully inside the viewport — title and the
  // calibration-swatch link were both clipped off-screen once.
  const card = page.getByText(/Let's make something/i);
  await expect(card).toBeInViewport();
  await expect(page.getByRole("button", { name: /calibration test swatch/i })).toBeInViewport();

  // The Edit/Stitch switch lives in the tool strip on phones (the SimulatorBar
  // row hides in edit view to give the canvas its height back).
  await expect(page.getByRole("button", { name: "Stitch view" })).toBeVisible();
  await page.getByRole("button", { name: "Stitch view" }).click();
  // Stitch view brings the playback row back.
  await expect(page.getByRole("button", { name: /Play|Pause/ })).toBeVisible();
});

test("slide-over drawers close from within: in-panel X and Escape", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 640, "drawers are narrow-screen-only");
  await page.goto("/app");
  await page.getByRole("button", { name: /^close$/i }).first().click();

  // The layers drawer carries its own close button — the top-bar toggle that
  // opened it is a thumb-stretch away on a phone.
  await page.getByRole("button", { name: "Show layers" }).click();
  const layers = page.getByLabel("Layers and stitch order");
  await expect(layers).toBeVisible();
  await page.getByRole("button", { name: "Close layers" }).click();
  await expect(layers).toBeHidden();

  // Escape is the keyboard twin of the scrim tap.
  await page.getByRole("button", { name: "Show properties" }).click();
  const props = page.getByLabel("Properties and threads");
  await expect(props).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(props).toBeHidden();
});

test("small phone (360px): the whole top bar fits — properties toggle included", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 640, "phone-only layout rules");
  // 360×740 — the small-Android floor. The Pixel 7 width (412) hid a real bug:
  // nine 40px controls + gaps = 384px, so at 360 the bar overflowed by 20px and
  // the properties toggle sat off-screen with no way to scroll to it.
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/app");
  await expect(page.getByText(/Let's make something/i)).toBeVisible();

  const header = page.locator("header");
  const box = (await header.boundingBox())!;
  expect(box.height).toBeLessThan(70); // one row, no wrap
  const overflow = await header.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0); // nothing hangs off the edge
  // Every end-of-row control is genuinely tappable — fully inside the viewport.
  for (const name of [/^Undo/, /^Redo/, /Show properties|Hide properties/]) {
    const b = (await page.getByRole("button", { name }).boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(360);
  }
});

test("phone dialogs escape the top bar (iOS fixed-in-scroller regression)", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 640, "phone-only layout rules");
  await page.goto("/app");
  await page.getByRole("button", { name: /^close$/i }).first().click();

  // The header must NEVER be a scroll container: iOS Safari clips
  // position:fixed descendants of overflow scrollers, which once reduced
  // every top-bar dialog to a clipped sliver on a real iPhone.
  const overflowX = await page
    .locator("header")
    .evaluate((el) => getComputedStyle(el).overflowX);
  expect(["visible", "clip"]).toContain(overflowX);

  // And a top-bar-mounted dialog opens fully on screen (portaled to <body>).
  await page.getByRole("button", { name: /add words/i }).click();
  const dialog = page.getByRole("dialog", { name: /add text/i });
  await expect(dialog).toBeVisible();
  const inBody = await dialog.evaluate((el) => el.closest("header") === null);
  expect(inBody).toBe(true);
  const box = (await dialog.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
  expect(box.width).toBeGreaterThan(vp.width * 0.7); // a real sheet, not a sliver
});

// ---------------------------------------------------------------------------
// Touch transform mechanics — real CDP touch gestures against the Konva stage.
// The transformer's box is measured through window.Konva (same probe pattern as
// resize.spec.ts) so assertions are on actual object dimensions, not pixels.

import type { Page, CDPSession } from "@playwright/test";

type TrBox = {
  tl: { x: number; y: number };
  br: { x: number; y: number };
  mr: { x: number; y: number };
  width: number;
  height: number;
} | null;

/** Absolute screen-space transformer box via its anchors (null = no selection). */
async function trBox(page: Page): Promise<TrBox> {
  return page.evaluate(() => {
    type AnchorNode = { getAbsolutePosition: () => { x: number; y: number } };
    type StageNode = {
      findOne: (sel: string) => (AnchorNode & { nodes?: () => unknown[] }) | undefined;
      container: () => HTMLElement;
    };
    const konva = (window as unknown as { Konva?: { stages: StageNode[] } }).Konva;
    if (!konva) return null;
    for (const stage of konva.stages) {
      const tr = stage.findOne("Transformer");
      if (!tr || !tr.nodes || tr.nodes().length === 0) continue;
      const r = stage.container().getBoundingClientRect();
      const abs = (name: string) => {
        const anchor = (tr as unknown as StageNode).findOne("." + name);
        if (!anchor) return null;
        const p = anchor.getAbsolutePosition();
        return { x: r.left + p.x, y: r.top + p.y };
      };
      const tl = abs("top-left");
      const br = abs("bottom-right");
      const mr = abs("middle-right");
      if (!tl || !br || !mr) return null;
      return { tl, br, mr, width: br.x - tl.x, height: br.y - tl.y };
    }
    return null;
  });
}

/** One-finger touch drag via CDP (Playwright's touchscreen can only tap). */
async function touchDrag(
  page: Page,
  cdp: CDPSession,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12,
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from.x, y: from.y, id: 1 }],
  });
  await page.waitForTimeout(40);
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 },
      ],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(250);
}

/** Place a rectangle via the Shapes menu + a touch drag, then select it by tap.
 *  Returns the canvas box for coordinate math. */
async function placeAndSelectRect(page: Page, cdp: CDPSession) {
  await page.goto("/app");
  await page.getByRole("button", { name: /^close$/i }).first().click();
  const canvas = page.locator("canvas").first();
  const cbox = (await canvas.boundingBox())!;
  const at = (fx: number, fy: number) => ({
    x: cbox.x + cbox.width * fx,
    y: cbox.y + cbox.height * fy,
  });
  await page.getByRole("button", { name: /Add a shape/i }).click();
  await page.getByRole("button", { name: "Rectangle" }).click();
  await touchDrag(page, cdp, at(0.3, 0.35), at(0.75, 0.6));
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.touchscreen.tap(at(0.5, 0.47).x, at(0.5, 0.47).y);
  await page.waitForTimeout(300);
  return { at };
}

test("touch corner resize keeps aspect ratio by default and sticks", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 640, "touch transform is phone-project-only");
  const cdp = await page.context().newCDPSession(page);
  const { at } = await placeAndSelectRect(page, cdp);

  const b0 = await trBox(page);
  expect(b0, "tap-select attached the transformer").not.toBeNull();
  const ratio0 = b0!.width / b0!.height;

  // Drag the bottom-right corner along a deliberately NON-proportional vector.
  await touchDrag(page, cdp, b0!.br, { x: b0!.br.x + 60, y: b0!.br.y + 15 });
  const b1 = await trBox(page);
  expect(b1).not.toBeNull();
  expect(b1!.width, "corner drag actually resized").toBeGreaterThan(b0!.width + 20);
  // Mobile/design-tool convention: corners scale proportionally by default.
  expect(Math.abs(b1!.width / b1!.height - ratio0), "aspect ratio kept").toBeLessThan(0.02);

  // And it STICKS: deselect, reselect, same dimensions (touch snap-back guard).
  await page.touchscreen.tap(at(0.08, 0.9).x, at(0.08, 0.9).y);
  await page.waitForTimeout(250);
  await page.touchscreen.tap((b1!.tl.x + b1!.br.x) / 2, (b1!.tl.y + b1!.br.y) / 2);
  await page.waitForTimeout(300);
  const b2 = await trBox(page);
  expect(b2).not.toBeNull();
  expect(Math.abs(b2!.width - b1!.width)).toBeLessThan(3);
  expect(Math.abs(b2!.height - b1!.height)).toBeLessThan(3);
});

test("aspect-lock toggle frees the corner, side anchor stretches one axis", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 640, "touch transform is phone-project-only");
  const cdp = await page.context().newCDPSession(page);
  await placeAndSelectRect(page, cdp);

  // The on-canvas selection bar carries the aspect toggle — locked by default on touch.
  const toggle = page.getByRole("button", { name: "Lock aspect ratio" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  // Unlocked: the same non-proportional corner drag now stretches freely.
  const b0 = await trBox(page);
  expect(b0).not.toBeNull();
  const ratio0 = b0!.width / b0!.height;
  await touchDrag(page, cdp, b0!.br, { x: b0!.br.x + 60, y: b0!.br.y + 10 });
  const b1 = await trBox(page);
  expect(b1).not.toBeNull();
  expect(b1!.width).toBeGreaterThan(b0!.width + 20);
  expect(Math.abs(b1!.width / b1!.height - ratio0), "free stretch changed the ratio").toBeGreaterThan(0.05);

  // Side (middle-right) anchor always stretches exactly one axis, locked or not.
  await toggle.click(); // re-lock: side handles must stretch regardless
  const s0 = await trBox(page);
  await touchDrag(page, cdp, s0!.mr, { x: s0!.mr.x + 50, y: s0!.mr.y });
  const s1 = await trBox(page);
  expect(s1!.width).toBeGreaterThan(s0!.width + 20);
  expect(Math.abs(s1!.height - s0!.height), "height untouched by side stretch").toBeLessThan(2);
});

test("fat-finger corner grab (12px off the anchor) still resizes, no deselect", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 640, "touch transform is phone-project-only");
  const cdp = await page.context().newCDPSession(page);
  await placeAndSelectRect(page, cdp);

  const b0 = await trBox(page);
  expect(b0).not.toBeNull();
  // A fingertip lands ~12px outside the 9px anchor — commercial mobile tools
  // give anchors 24-44px touch targets; the grab must catch, not fall through
  // to the stage (which would start a marquee and CLEAR the selection).
  await touchDrag(
    page,
    cdp,
    { x: b0!.br.x + 12, y: b0!.br.y + 12 },
    { x: b0!.br.x + 60, y: b0!.br.y + 60 },
  );
  const b1 = await trBox(page);
  expect(b1, "selection survived the grab").not.toBeNull();
  expect(b1!.width, "off-center grab still resized").toBeGreaterThan(b0!.width + 15);
});
