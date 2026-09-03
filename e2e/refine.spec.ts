import { test, expect } from "@playwright/test";

/**
 * Interactive digitizing happy path, desktop AND phone: the wizard's up-front
 * questions (fabric + "what matters most") are present and skippable, the
 * one-click Add artwork still works, and the optional region-by-region REFINE
 * walk (ReviewBar) opens, restyles a single region live, and finishes with
 * Done. The chosen fabric must land in the project (Design panel shows it) so
 * the engine's fabric profile actually applies to the sew-out.
 */

const TWO_COLOR_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <rect x="10" y="10" width="180" height="80" fill="#c8102e"/>
  <circle cx="100" cy="150" r="42" fill="#16234a"/>
</svg>`;

test("wizard questions + region refine walk: restyle one region, accept, fabric lands", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: /^close$/i }).first().click();

  // Import a simple two-color artwork.
  await page
    .locator('input[type="file"][accept="image/*"]')
    .first()
    .setInputFiles({
      name: "two.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(TWO_COLOR_SVG),
    });
  await page.waitForSelector("[data-wizard-step]", { timeout: 30000 });

  // The up-front questions sit on the first step, prefilled and skippable.
  await expect(page.getByText("Your project")).toBeVisible();
  await expect(page.getByRole("button", { name: "Crisp lettering" })).toBeVisible();
  await expect(
    page.getByLabel("What matters most").getByRole("button", { name: "Balanced" }),
  ).toHaveAttribute("aria-pressed", "true");
  // Answer the fabric question; leave the priority at its default.
  await page.getByLabel("Fabric", { exact: true }).selectOption("knit");

  // Wait for the trace, then straight through the wizard (one-click path).
  await expect
    .poll(
      async () =>
        Number(await page.locator("[data-preview]").getAttribute("data-preview-objects")),
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Next" }).click();
  const add = page.getByRole("button", { name: /Add artwork/ });
  await expect(add).toBeEnabled({ timeout: 30000 });
  await add.click();

  // The guided region review opens over the fresh artwork.
  await expect(page.getByText(/Region 1 of \d+/)).toBeVisible({ timeout: 15000 });

  // REFINE the first region: open the collapsed row and switch it to Sketch.
  await page.getByRole("button", { name: "Refine stitches" }).click();
  const style = page.getByLabel("Region stitch style");
  await expect(style).toBeVisible();
  await style.selectOption("sketch");
  // The sketch style carries its open-row density — the live density readout
  // proves the region really restyled.
  await expect(page.getByText("0.80")).toBeVisible();
  // Nudge the density one step lighter, still region-local.
  await page.getByRole("button", { name: "Increase density", exact: true }).click();
  await expect(page.getByText("0.85")).toBeVisible();

  // Walk to the next region and accept everything.
  await page.getByRole("button", { name: "Next region" }).click();
  await expect(page.getByText(/Region 2 of \d+/)).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(/Region \d+ of \d+/)).toBeHidden();

  // The fabric answer reached the project: the Design panel shows it.
  const showProps = page.getByRole("button", { name: "Show properties" });
  if (await showProps.isVisible()) await showProps.click();
  await page.getByRole("tab", { name: "Design" }).click();
  await expect(page.getByLabel("Fabric type")).toHaveValue("knit");
});
