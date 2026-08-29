import { test, expect } from "@playwright/test";

/**
 * Regression: resizing with the selection transformer must STICK. The commit
 * handler once captured Konva's transform matrix by reference and the very next
 * node reset rewrote that array to the identity — every resize looked right
 * during the drag and snapped back on release (drag-move was immune because it
 * copies primitives). Black-box proof: stretch a satin column's right edge with
 * the middle-right anchor, then hit-test — a point beyond the original right
 * end must now select the object, while the left end must not have moved
 * (distinguishing a real scale from an accidental whole-object drag).
 *
 * The canvas content can shift a few px between drawing and selecting (layout
 * settle), so the test SELF-CALIBRATES: it probes for the object with real
 * clicks before measuring anything.
 */

const BEACON = "Column width (mm)"; // satin-only properties field = "object selected"

test("transformer resize sticks after release", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: "Close" }).first().click(); // start hint

  // Draw a horizontal running line across the middle band, convert to satin so
  // the beacon field exists while the object is selected.
  await page.getByRole("button", { name: "Run" }).click();
  const canvas = page.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  const at = (fx: number, fy: number) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });
  await page.mouse.click(at(0.3, 0.5).x, at(0.3, 0.5).y);
  await page.waitForTimeout(80);
  await page.mouse.click(at(0.7, 0.5).x, at(0.7, 0.5).y);
  await page.waitForTimeout(80);
  await page.keyboard.press("Enter");
  await expect(page.getByText("1 object", { exact: true })).toBeVisible();
  await page.getByRole("combobox").first().selectOption("satin");
  await expect(page.getByText(BEACON)).toBeVisible();

  await page.getByRole("button", { name: "Select", exact: true }).click();

  const beacon = page.getByText(BEACON);
  const deselect = async () => {
    await page.mouse.click(at(0.12, 0.12).x, at(0.12, 0.12).y);
    await page.waitForTimeout(200);
  };
  /** Click a point; report whether it selected the object (beacon visible).
   *  One retry absorbs a click that lands during a layout/rerender settle. */
  const hits = async (fx: number, fy: number): Promise<boolean> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.mouse.click(at(fx, fy).x, at(fx, fy).y);
      await page.waitForTimeout(300);
      if (await beacon.isVisible()) {
        await deselect();
        return true;
      }
    }
    return false;
  };

  // The object is still selected from the satin conversion — clear it first or
  // the first probe reads a stale beacon and mis-calibrates the whole scan.
  await deselect();
  await expect(beacon).toBeHidden();

  // SELF-CALIBRATE: find the bar's vertical hit band at mid-x (content can
  // settle a few px off the drawing coordinates) and use its MIDDLE — probing
  // the right end at the band's top edge misses the end cap. Then find the
  // right end at that y.
  const yHits: number[] = [];
  for (let fy = 0.46; fy <= 0.6; fy += 0.01) {
    if (await hits(0.5, fy)) yHits.push(fy);
    else if (yHits.length) break; // past the bottom edge
  }
  expect(yHits.length, "found the bar by probing").toBeGreaterThan(0);
  const barY = yHits[yHits.length >> 1];
  let xR = -1;
  for (let fx = 0.71; fx >= 0.55; fx -= 0.01) {
    if (await hits(fx, barY)) {
      xR = fx;
      break;
    }
  }
  expect(xR, "found the right end by probing").toBeGreaterThan(0);
  // Beyond the right end there is nothing (validates the negative probe).
  expect(await hits(xR + 0.07, barY)).toBe(false);

  // Select, then drag the MIDDLE-RIGHT transformer anchor outward to stretch X.
  // The anchor's EXACT screen position comes from Konva itself (probed guesses
  // sometimes grabbed the body — a move, not a resize — or empty canvas).
  await page.mouse.click(at(0.5, barY).x, at(0.5, barY).y);
  await expect(beacon).toBeVisible();
  const anchor = await page.evaluate(() => {
    type KonvaGlobal = {
      stages: Array<{
        findOne: (sel: string) => { getAbsolutePosition: () => { x: number; y: number } } | undefined;
        container: () => HTMLElement;
      }>;
    };
    const konva = (window as unknown as { Konva?: KonvaGlobal }).Konva;
    if (!konva) return null;
    for (const stage of konva.stages) {
      const a = stage.findOne(".middle-right");
      if (!a) continue;
      const p = a.getAbsolutePosition();
      const r = stage.container().getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    }
    return null;
  });
  expect(anchor, "found the transformer's middle-right anchor").not.toBeNull();
  await page.mouse.move(anchor!.x, anchor!.y);
  await page.mouse.down();
  const stretchPx = box.width * 0.12;
  for (let s = 1; s <= 6; s++) {
    await page.mouse.move(anchor!.x + (stretchPx * s) / 6, anchor!.y, { steps: 2 });
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
  await deselect();

  // PROOF: a point past the original right end now hits the object…
  expect(await hits(xR + 0.07, barY), "stretched right edge sticks").toBe(true);
  // …and the left end did NOT move (a whole-object drag would vacate it).
  expect(await hits(0.34, barY), "left end unmoved").toBe(true);
});
