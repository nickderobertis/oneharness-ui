import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { z } from "zod";
import { e2eWebOrigin } from "../../packages/oneharness-bridge/test/e2e-configuration";

const webAccessToken = z
  .string()
  .min(32)
  .max(256)
  .parse(process.env.ONEHARNESS_UI_TEST_WEB_ACCESS_TOKEN ?? randomBytes(24).toString("base64url"));
process.env.ONEHARNESS_UI_TEST_WEB_ACCESS_TOKEN = webAccessToken;

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
    baseURL: e2eWebOrigin,
    extraHTTPHeaders: {
      Authorization: `Basic ${Buffer.from(`oneharness:${webAccessToken}`).toString("base64")}`,
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "bun packages/oneharness-bridge/test/e2e-server.ts",
      cwd: "../..",
      env: { ONEHARNESS_UI_TEST_WEB_ACCESS_TOKEN: webAccessToken },
      url: `${e2eWebOrigin}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  workers: 1,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
