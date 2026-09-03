import { test, expect } from "@playwright/test";
import type { Page, CDPSession } from "@playwright/test";

/**
 * Touch transforms for MULTI-selections, and the transform defaults on devices
 * whose capability media queries lie.
 *
 * Group resize on touch was previously untested end-to-end: marquee is the
 * touch path to a multi-selection (there is no Shift key on a phone), and the
 * shared transformer must then resize every attached node from a corner drag.
 *
 * The "misreported pointer capability" block simulates the real-device failure
 * reported from DuckDuckGo on iPhone (WebKit + fingerprinting shields):
 * pointer/hover media queries answer FALSE on a touch device. Before
 * isCoarsePointer() learned its capability fallback + first-touch latch, that
 * condition shipped desktop transform defaults to a phone — aspect lock
 * defaulted OFF (corner resize didn't keep proportions) and anchors kept their
 * 9px un-padded hit areas, so a fat-finger grab at a group's corner fell
 * through to the stage, started a marquee, and destroyed the multi-selection
 * ("group resize doesn't work"). Both tests in that block fail against the old
 * detection. (A real WebKit engine run would be strictly better, but the
 * Playwright WebKit build cannot be downloaded in this sandbox; the condition
 * is engine-independent, so it is simulated in Chromium.)
 */

type Pt = { x: number; y: number };

/** One-finger touch drag via CDP (Playwright's touchscreen can only tap). */
async function touchDrag(page: Page, cdp: CDPSession, from: Pt, to: Pt, steps = 12) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from.x, y: from.y, id: 1 }],
  });
  await page.waitForTimeout(40);
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * i) / steps,
          y: from.y + ((to.y - from.y) * i) / steps,
          id: 1,
        },
      ],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(250);
}

/** Transformer probe via window.Konva: attached node count + absolute corner
 *  anchor positions (same pattern as resize.spec.ts / mobile.spec.ts). */
async function trState(page: Page) {
  return page.evaluate(() => {
    type AnchorNode = { getAbsolutePosition: () => { x: number; y: number } };
    type TrNode = AnchorNode & {
      nodes?: () => unknown[];
      findOne: (sel: string) => AnchorNode | undefined;
    };
    type StageNode = {
      findOne: (sel: string) => TrNode | undefined;
      container: () => HTMLElement;
    };
    const konva = (window as unknown as { Konva?: { stages: StageNode[] } }).Konva;
    if (!konva) return null;
    for (const stage of konva.stages) {
      const tr = stage.findOne("Transformer");
      if (!tr || !tr.nodes) continue;
      const n = tr.nodes().length;
      if (n === 0) return { n, tl: null, br: null };
      const r = stage.container().getBoundingClientRect();
      const abs = (name: string) => {
        const anchor = tr.findOne("." + name);
        if (!anchor) return null;
        const p = anchor.getAbsolutePosition();
        return { x: r.left + p.x, y: r.top + p.y };
      };
      return { n, tl: abs("top-left"), br: abs("bottom-right") };
    }
    return null;
  });
}

/** Open the app and place a touch-dragged rectangle for each corner pair. */
async function placeRects(page: Page, cdp: CDPSession, rects: [Pt, Pt][]) {
  await page.goto("/app");
  await page.getByRole("button", { name: /^close$/i }).first().click();
  const canvas = page.locator("canvas").first();
  const cbox = (await canvas.boundingBox())!;
  const at = (fx: number, fy: number) => ({
    x: cbox.x + cbox.width * fx,
    y: cbox.y + cbox.height * fy,
  });
  for (const [a, b] of rects) {
    await page.getByRole("button", { name: /Add a shape/i }).click();
    await page.getByRole("button", { name: "Rectangle" }).click();
    await touchDrag(page, cdp, at(a.x, a.y), at(b.x, b.y));
  }
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.waitForTimeout(200);
  return { at };
}

test("group resize on touch: marquee multi-select, corner drag, and it sticks", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 640, "touch transform is phone-project-only");
  const cdp = await page.context().newCDPSession(page);
  const { at } = await placeRects(page, cdp, [
    [{ x: 0.2, y: 0.35 }, { x: 0.42, y: 0.5 }],
    [{ x: 0.55, y: 0.35 }, { x: 0.78, y: 0.5 }],
  ]);

  // Marquee from empty canvas across both objects — the touch path to a
  // multi-selection (no Shift key on a phone).
  await touchDrag(page, cdp, at(0.1, 0.25), at(0.88, 0.62));
  const s0 = await trState(page);
  expect(s0, "transformer attached after marquee").not.toBeNull();
  expect(s0!.n, "marquee multi-selected both objects").toBe(2);
  const w0 = s0!.br!.x - s0!.tl!.x;

  // Touch-drag the shared bottom-right corner: the whole group resizes.
  await touchDrag(page, cdp, s0!.br!, { x: s0!.br!.x + 60, y: s0!.br!.y + 40 });
  const s1 = await trState(page);
  expect(s1, "selection survived the corner drag").not.toBeNull();
  expect(s1!.n, "both objects still attached").toBe(2);
  const w1 = s1!.br!.x - s1!.tl!.x;
  expect(w1, "group corner drag actually resized").toBeGreaterThan(w0 + 20);

  // And it STICKS: deselect, re-marquee, same dimensions (snap-back guard —
  // each member bakes its own matrix on transformend).
  await page.touchscreen.tap(at(0.06, 0.9).x, at(0.06, 0.9).y);
  await page.waitForTimeout(250);
  await touchDrag(page, cdp, at(0.06, 0.2), at(0.95, 0.75));
  const s2 = await trState(page);
  expect(s2!.n).toBe(2);
  expect(Math.abs(s2!.br!.x - s2!.tl!.x - w1), "group resize stuck").toBeLessThan(4);
});

test.describe("misreported pointer capability (privacy-browser condition)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // Lie about pointer/hover capability only (the fingerprinting surface);
      // layout (width) queries keep working like the real browser.
      const native = window.matchMedia.bind(window);
      window.matchMedia = ((q: string) => {
        if (/pointer|hover/i.test(q)) {
          return {
            matches: false,
            media: q,
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent: () => false,
          } as unknown as MediaQueryList;
        }
        return native(q);
      }) as typeof window.matchMedia;
    });
  });

  test("aspect lock still defaults ON and corner resize keeps the ratio", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) > 640, "touch transform is phone-project-only");
    const cdp = await page.context().newCDPSession(page);
    const { at } = await placeRects(page, cdp, [
      [{ x: 0.3, y: 0.35 }, { x: 0.75, y: 0.6 }],
    ]);
    await page.touchscreen.tap(at(0.5, 0.47).x, at(0.5, 0.47).y);
    await page.waitForTimeout(300);

    // The quick-bar Lock must default ON for a touch device even when the
    // media queries lie (this is exactly the shipped DDG/iPhone failure).
    const toggle = page.getByRole("button", { name: "Lock aspect ratio" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    const b0 = await trState(page);
    expect(b0).not.toBeNull();
    const w0 = b0!.br!.x - b0!.tl!.x;
    const h0 = b0!.br!.y - b0!.tl!.y;
    await touchDrag(page, cdp, b0!.br!, { x: b0!.br!.x + 60, y: b0!.br!.y + 15 });
    const b1 = await trState(page);
    const w1 = b1!.br!.x - b1!.tl!.x;
    const h1 = b1!.br!.y - b1!.tl!.y;
    expect(w1, "corner drag actually resized").toBeGreaterThan(w0 + 20);
    expect(Math.abs(w1 / h1 - w0 / h0), "aspect ratio kept").toBeLessThan(0.02);
  });

  test("fat-finger group corner grab still resizes (padded anchors survive)", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) > 640, "touch transform is phone-project-only");
    const cdp = await page.context().newCDPSession(page);
    const { at } = await placeRects(page, cdp, [
      [{ x: 0.2, y: 0.35 }, { x: 0.42, y: 0.5 }],
      [{ x: 0.55, y: 0.35 }, { x: 0.78, y: 0.5 }],
    ]);

    await touchDrag(page, cdp, at(0.1, 0.25), at(0.88, 0.62));
    const s0 = await trState(page);
    expect(s0, "transformer attached").not.toBeNull();
    expect(s0!.n, "marquee multi-selected both").toBe(2);
    const w0 = s0!.br!.x - s0!.tl!.x;

    // A fingertip lands ~12px off the corner anchor — with un-padded 9px
    // anchors this fell through to the stage, started a marquee, and cleared
    // the multi-selection; with the finger pads it must grab and resize.
    await touchDrag(
      page,
      cdp,
      { x: s0!.br!.x + 12, y: s0!.br!.y + 12 },
      { x: s0!.br!.x + 60, y: s0!.br!.y + 50 },
    );
    const s1 = await trState(page);
    expect(s1, "selection survived the grab").not.toBeNull();
    expect(s1!.n, "still a 2-object selection").toBe(2);
    expect(s1!.br!.x - s1!.tl!.x, "group resized").toBeGreaterThan(w0 + 15);
  });
});
