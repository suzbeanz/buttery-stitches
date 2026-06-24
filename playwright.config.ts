import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end smoke test config. Runs the Vite dev server and drives a real
 * browser. The browser binary is fetched with `npx playwright install chromium`
 * (needs network); CI installs it before running `npm run e2e`.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      // Phone viewport. The smoke (drawing) spec depends on the wide layout's
      // object counter, so it's ignored here; a11y/csp/mobile specs still run.
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testIgnore: /smoke\.spec\.ts/,
    },
  ],
  webServer: {
    command: "npm run dev -- --port 5173",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
