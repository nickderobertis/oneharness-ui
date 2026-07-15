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
      url: "http://127.0.0.1:4317/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        "NEXT_PUBLIC_ONEHARNESS_BRIDGE_URL=http://127.0.0.1:4317 NEXT_PUBLIC_ONEHARNESS_BRIDGE_CAPABILITY=oneharness-ui-e2e-authorization-token bun run --cwd apps/conversation-ui build && bun apps/conversation-ui/tests/e2e/static-server.ts",
      cwd: "../..",
      port: 3000,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
  workers: 1,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
