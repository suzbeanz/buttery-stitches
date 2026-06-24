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
