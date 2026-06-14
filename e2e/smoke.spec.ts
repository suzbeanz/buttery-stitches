import { test, expect } from "@playwright/test";

/**
 * End-to-end smoke test of the manual-editing flow. Does not depend on Pyodide
 * (export is exercised separately because it loads the runtime from a CDN).
 */

test("draw a fill object and manage it", async ({ page }) => {
  await page.goto("/");

  // App loads with the butter wordmark and an empty canvas.
  await expect(page.getByText("Buttery Stitches")).toBeVisible();
  await expect(page.getByText(/No objects yet/i)).toBeVisible();

  // Pick the Fill tool and draw a triangle on the canvas.
  await page.getByRole("button", { name: "Fill" }).click();
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
  await page.mouse.dblclick(c.x, c.y); // finish

  // One object now exists (top bar counter) and the empty state is gone.
  await expect(page.getByText("1 object")).toBeVisible();
  await expect(page.getByText(/No objects yet/i)).toHaveCount(0);

  // Toggle visibility off and on via the layer row.
  await page.getByTitle("Hide").first().click();
  await expect(page.getByTitle("Show").first()).toBeVisible();
});

test("draws a running stitch and switches its type to satin", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Running" }).click();
  const canvas = page.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.5);
  await page.keyboard.press("Enter"); // finish

  await expect(page.getByText("1 object")).toBeVisible();

  // Properties panel reflects the selection; change type to Satin.
  await page.getByRole("combobox").first().selectOption("satin");
  await expect(page.getByText(/Column width/i)).toBeVisible();
});
