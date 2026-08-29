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
  <rect x="900" y="900" width="200" height="200" fill="url(#missing) #00a651"/>
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
    let green = 0;
    let black = 0;
    let painted = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      painted++;
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      if (r > 150 && g < 90 && b < 100) red++;
      else if (r > 40 && r < 110 && g > 15 && g < 70 && b < 40) brown++;
      else if (r < 90 && g > 120 && b < 130) green++;
      else if (r < 40 && g < 40 && b < 40) black++;
    }
    return { red, brown, green, black, painted };
  });
  expect(counts).not.toBeNull();
  expect(counts!.red, "gradient red field flattened to a real red").toBeGreaterThan(200);
  expect(counts!.brown, "stroked pole visible as a satin band").toBeGreaterThan(50);
  // SVG paint fallback: url(#missing) with an explicit fallback color paints it.
  expect(counts!.green, "unresolvable url() honours the author's fallback color").toBeGreaterThan(50);
  // No black slab: black may only be a sliver of the painted area.
  expect(counts!.black / Math.max(1, counts!.painted)).toBeLessThan(0.1);
});

/**
 * Real-world export compatibility: <use>/<symbol> instances, polyline strokes,
 * radialGradient fills, group opacity (blended toward white — flat art over
 * fabric), clip-path (group-level, the Figma export wrapper), pattern fills
 * (flattened to their dominant color), hidden elements (display:none /
 * visibility:hidden must NOT import), and <text> (not traced — the dialog
 * points at the studio's Text tool instead).
 */
const EXPORT_COMPAT_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
  <defs>
    <radialGradient id="rg">
      <stop offset="0" stop-color="#4040ff"/>
      <stop offset="1" stop-color="#000080"/>
    </radialGradient>
    <clipPath id="clipLeft"><rect x="0" y="580" width="500" height="420"/></clipPath>
    <pattern id="dots" width="12" height="12" patternUnits="userSpaceOnUse">
      <rect width="12" height="12" fill="#ff8800"/>
      <circle cx="6" cy="6" r="2" fill="#ffb066"/>
    </pattern>
    <symbol id="leaf" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="#00a651"/></symbol>
  </defs>
  <circle cx="250" cy="250" r="190" fill="url(#rg)"/>
  <use href="#leaf" x="620" y="60" width="300" height="300"/>
  <polyline points="600,520 750,430 900,520" fill="none" stroke="#008080" stroke-width="44"/>
  <rect x="60" y="620" width="880" height="320" fill="#7a00cc" clip-path="url(#clipLeft)"/>
  <rect x="560" y="640" width="320" height="280" fill="url(#dots)"/>
  <rect x="620" y="380" width="200" height="90" fill="#000000" opacity="0.5"/>
  <rect x="0" y="0" width="1000" height="1000" fill="#ff2222" display="none"/>
  <rect x="20" y="450" width="400" height="120" fill="#ff00ff" visibility="hidden"/>
  <text x="380" y="995" font-size="70" fill="#111111">Brand</text>
</svg>`;

test("use/symbol, polyline, radialGradient, opacity, clip, pattern and hidden elements import correctly", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: "Close" }).first().click();

  await page
    .locator('input[type="file"][accept="image/*"]')
    .first()
    .setInputFiles({
      name: "compat.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(EXPORT_COMPAT_SVG),
    });
  await page.waitForSelector("[data-wizard-step]", { timeout: 30000 });
  // The art has 6 distinct colors — raise the thread budget above the auto
  // suggestion so the palette reducer can't fold two of them together.
  const more = page.getByRole("button", { name: "More colors" });
  for (let i = 0; i < 4; i++) {
    if (await more.isEnabled()) await more.click();
  }
  await expect
    .poll(
      async () =>
        Number(await page.locator("[data-preview]").getAttribute("data-preview-objects")),
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);
  await page.waitForSelector("[data-preview] canvas", { timeout: 30000 });
  await expect(page.getByText("Updating…")).toBeHidden({ timeout: 30000 });
  await page.waitForTimeout(600); // let the draw effect paint

  const counts = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-preview] canvas");
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const c = { green: 0, midblue: 0, teal: 0, purple: 0, purpleRight: 0, orange: 0, gray: 0, magenta: 0, brightRed: 0, painted: 0 };
    const W = canvas.width;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      c.painted++;
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      const x = (i / 4) % W;
      if (r < 90 && g > 140 && b < 110) c.green++; // symbol/use instance
      else if (r < 90 && g < 90 && b > 150) c.midblue++; // radial gradient midpoint
      else if (r < 60 && g > 100 && g < 160 && b > 100 && b < 160 && Math.abs(g - b) < 30) c.teal++; // polyline stroke
      else if (r > 90 && r < 160 && g < 60 && b > 150) {
        c.purple++; // clipped rect
        if (x > 0.62 * W) c.purpleRight++;
      } else if (r > 200 && g > 100 && g < 180 && b < 60) c.orange++; // pattern dominant color
      else if (r > 100 && r < 160 && g > 100 && g < 160 && b > 100 && b < 160 && Math.max(r, g, b) - Math.min(r, g, b) < 14) c.gray++; // 50% black over white
      else if (r > 200 && g < 80 && b > 200) c.magenta++; // visibility:hidden
      else if (r > 200 && g < 80 && b < 80) c.brightRed++; // display:none
    }
    return c;
  });
  expect(counts).not.toBeNull();
  expect(counts!.green, "a <use> of a <symbol> imports at its instanced position/scale").toBeGreaterThan(200);
  expect(counts!.midblue, "radialGradient flattens to its midpoint color").toBeGreaterThan(300);
  expect(counts!.teal, "a stroked <polyline> imports as a satin band").toBeGreaterThan(80);
  expect(counts!.purple, "a clipped rect keeps its visible (left) part").toBeGreaterThan(300);
  expect(counts!.orange, "a pattern fill flattens to its dominant color").toBeGreaterThan(300);
  expect(counts!.gray, "opacity 0.5 black blends toward white, not full black").toBeGreaterThan(80);
  // The clip cut away the right side of the purple rect.
  expect(counts!.purpleRight / Math.max(1, counts!.purple), "clip-path removes the clipped-away region").toBeLessThan(0.03);
  // Hidden elements never import.
  expect(counts!.magenta, "visibility:hidden is skipped").toBeLessThan(20);
  expect(counts!.brightRed, "display:none is skipped").toBeLessThan(20);
  // The <text> element is NOT traced; the dialog points at the native tool.
  await expect(page.getByText(/Text tool/)).toBeVisible();
});
