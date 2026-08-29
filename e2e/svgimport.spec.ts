import { test, expect } from "@playwright/test";

/**
 * SVG import regression: a gradient-filled logo (the icon-pack export style)
 * must import with its gradients FLATTENED to real colors, and stroke-only
 * paths (a flag's pole) must show in the traced preview. Both broke on real
 * art: `url(#gradient)` fills fell back to CSS's inherited color and painted
 * the whole logo as one black slab, and satin (rail-pair) objects rendered as
 * invisible slivers in the flat preview.
 */

const GRADIENT_FLAG_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1200 1200">
  <defs>
    <linearGradient id="red" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e0304e"/>
      <stop offset="0.5" stop-color="#c8102e"/>
      <stop offset="1" stop-color="#8e0a20"/>
    </linearGradient>
    <linearGradient id="whiteBase">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#cfd4de"/>
    </linearGradient>
    <linearGradient id="white" xlink:href="#whiteBase" x1="0" y1="0" x2="1" y2="0"/>
  </defs>
  <path d="M430 330 L590 1010" stroke="#3d1f0e" stroke-width="40" stroke-linecap="round" fill="none"/>
  <path d="M440 320 C 650 230 800 330 960 240 L 1000 560 C 820 660 640 560 470 650 Z" fill="url(#red)"/>
  <path d="M480 470 L 985 385 L 995 475 L 492 562 Z" fill="url(#white)"/>
</svg>`;

test("gradient SVG imports with flattened colors and a visible stroked pole", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: "Close" }).first().click();

  await page
    .locator('input[type="file"][accept="image/*"]')
    .first()
    .setInputFiles({
      name: "flag.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(GRADIENT_FLAG_SVG),
    });
  await page.waitForSelector("[data-wizard-step]", { timeout: 30000 });
  // Wait for the trace to land: kept objects > 0 AND the preview canvas mounted.
  await expect
    .poll(
      async () =>
        Number(await page.locator("[data-preview]").getAttribute("data-preview-objects")),
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);
  await page.waitForSelector("[data-preview] canvas", { timeout: 30000 });
  await page.waitForTimeout(500); // let the draw effect paint

  // Read the traced-preview canvas pixels. The gradient shapes must land as
  // REAL reds/whites — not the black slab of an unresolved url(#...) paint —
  // and the brown stroked pole must be visible.
  const counts = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-preview] canvas");
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    let brown = 0;
    let black = 0;
    let painted = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      painted++;
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      if (r > 150 && g < 90 && b < 100) red++;
      else if (r > 40 && r < 110 && g > 15 && g < 70 && b < 40) brown++;
      else if (r < 40 && g < 40 && b < 40) black++;
    }
    return { red, brown, black, painted };
  });
  expect(counts).not.toBeNull();
  expect(counts!.red, "gradient red field flattened to a real red").toBeGreaterThan(200);
  expect(counts!.brown, "stroked pole visible as a satin band").toBeGreaterThan(50);
  // No black slab: black may only be a sliver of the painted area.
  expect(counts!.black / Math.max(1, counts!.painted)).toBeLessThan(0.1);
});
