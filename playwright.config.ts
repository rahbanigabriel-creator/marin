import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // The journeys share one stateful Next dev compiler. Serial execution keeps
  // viewport changes and route fixtures deterministic locally and in CI.
  workers: 1,
  // Product assertions retain their short expect timeouts. The larger journey
  // budget covers complete multi-screen acceptance paths, not slow locators.
  timeout: 180_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run server:e2e",
    url: "http://127.0.0.1:3100/app",
    // Never attach to an arbitrary local server: only the credential-isolated
    // launcher above is allowed to serve browser tests.
    reuseExistingServer: false,
    // A clean, credential-isolated Next production build can take several
    // minutes on a constrained local runner. Completed source-matched builds
    // are reused by the launcher, so this larger budget applies only when due.
    timeout: 900_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
