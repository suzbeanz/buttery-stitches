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
