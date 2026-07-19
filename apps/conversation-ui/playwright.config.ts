import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  outputDir: "test-results/playwright",
  reporter: [["list"]],
  retries: 0,
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "bun packages/oneharness-bridge/test/e2e-server.ts",
      cwd: "../..",
      url: "http://127.0.0.1:3000/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  workers: 1,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
