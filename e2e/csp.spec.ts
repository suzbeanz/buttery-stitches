import { test, expect } from "@playwright/test";

/**
 * Verifies the security/privacy posture in a real browser: the Content-Security-
 * Policy raises no violations on load, and nothing on the page reaches a
 * third-party origin (the "nothing leaves your machine" promise) — fonts are
 * self-hosted, so there must be zero requests to Google Fonts.
 */

for (const path of ["/", "/app"]) {
  test(`no CSP violations or third-party font requests on ${path}`, async ({ page }) => {
    const cspViolations: string[] = [];
    const thirdParty: string[] = [];

    page.on("console", (msg) => {
      const text = msg.text();
      if (/content security policy|refused to/i.test(text)) cspViolations.push(text);
    });
    page.on("requestfailed", (req) => {
      // A blocked-by-CSP request shows up here; record cross-origin ones.
      const url = req.url();
      if (!url.startsWith("http://localhost")) thirdParty.push(url);
    });
    page.on("request", (req) => {
      const url = req.url();
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url)) thirdParty.push(url);
    });

    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (e) => {
        // Surface to the console so the listener above captures it.
        console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI}`);
      });
    });

    await page.goto(path);
    await expect(page.getByText("Buttery Stitches")).toBeVisible();
    // Give late resources (fonts, lazy chunks) a moment to settle.
    await page.waitForTimeout(500);

    expect(cspViolations, cspViolations.join("\n")).toEqual([]);
    expect(thirdParty, thirdParty.join("\n")).toEqual([]);
  });
}
