import { test, expect } from "@playwright/test";

/**
 * End-to-end smoke test of the manual-editing flow in the studio (route "/app").
 * Does not depend on Pyodide (export loads the runtime from a CDN and is
 * exercised separately). Drawing relies on the wide desktop layout (the top-bar
 * object counter is hidden on narrow viewports), so this file is desktop-only —
 * the mobile project ignores it (see playwright.config.ts).
 */

test("draw a fill object and manage it", async ({ page }) => {
  await page.goto("/app");

  // Studio loads with the wordmark and the empty-state start hint.
  await expect(page.getByText("Buttery Stitches")).toBeVisible();
  await expect(page.getByText(/Let's make something/i)).toBeVisible();
  // Dismiss the start hint so it doesn't intercept canvas clicks.
  await page.getByRole("button", { name: "Close" }).first().click();

  // Pick the Fill tool and draw a triangle on the canvas.
  await page.getByRole("button", { name: "Fill", exact: true }).click();
  const canvas = page.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  const at = (fx: number, fy: number) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });
  const a = at(0.4, 0.4);
  const b = at(0.6, 0.4);
  const c = at(0.5, 0.6);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await page.mouse.click(c.x, c.y);
  await page.keyboard.press("Enter"); // finish (Enter is the reliable commit path; a
  // synthetic dblclick doesn't always register as a Konva dblclick in headless)

  // One object now exists (top bar counter on the wide layout).
  await expect(page.getByText("1 object", { exact: true })).toBeVisible();

  // Toggle visibility off and on via the layer row.
  await page.getByTitle("Hide").first().click();
  await expect(page.getByTitle("Show").first()).toBeVisible();
});

test("draws a running stitch and switches its type to satin", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: "Close" }).first().click(); // dismiss start hint
  await page.getByRole("button", { name: "Run" }).click();
  const canvas = page.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.5);
  await page.keyboard.press("Enter"); // finish

  await expect(page.getByText("1 object", { exact: true })).toBeVisible();

  // Properties panel reflects the selection; change type to Satin.
  await page.getByRole("combobox").first().selectOption("satin");
  await expect(page.getByText(/Column width/i)).toBeVisible();
});
