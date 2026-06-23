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
  // Dismiss the start hint so its full-canvas overlay can't intercept clicks, and
  // confirm it's actually gone before drawing.
  await page.getByRole("button", { name: "Close" }).first().click();
  await expect(page.getByText(/Let's make something/i)).toBeHidden();

  // Pick the Fill tool and confirm it's active (a fill needs >= 3 placed points;
  // if the tool didn't engage, canvas clicks would just clear the selection).
  const fillBtn = page.getByRole("button", { name: "Fill", exact: true });
  await fillBtn.click();
  await expect(fillBtn).toHaveAttribute("aria-pressed", "true");

  // Draw a triangle in the central band of the canvas (the same safe zone the
  // running-stitch test uses — clicks near the top/edges can land on the ruler or
  // floating toolbars that overlap the canvas box). Pace each click so every
  // mousedown registers as its own Konva point.
  const canvas = page.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  const clickAt = async (fx: number, fy: number) => {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(80);
  };
  await clickAt(0.35, 0.45);
  await clickAt(0.65, 0.45);
  await clickAt(0.5, 0.6);
  await page.keyboard.press("Enter"); // commit the draft (same path as the running test)

  // One object now exists (top bar counter on the wide layout).
  // TEMP DIAGNOSTIC: surface the real page state in the CI log so we can tell
  // "object never created" (counter reads 0) from "created but locator/visibility"
  // (counter reads 1 but hidden). Remove once the root cause is fixed.
  console.log("DIAG object-texts:", JSON.stringify(await page.getByText(/object/i).allInnerTexts().catch(() => "ERR")));
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
