import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Full-page accessibility scan with axe-core in a real browser — this is where
 * the checks that need layout (color contrast) and a single-page landmark
 * structure run, complementing the jsdom component-level axe tests
 * (src/test/a11y.dom.test.tsx). Runs on every configured project (desktop +
 * mobile viewports).
 */

async function scan(page: import("@playwright/test").Page) {
  return new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
}

test("home page has no serious or critical a11y violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Buttery Stitches")).toBeVisible();
  const results = await scan(page);
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
});

test("studio has no serious or critical a11y violations", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByText(/Let's make something/i)).toBeVisible();
  const results = await scan(page);
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
});
