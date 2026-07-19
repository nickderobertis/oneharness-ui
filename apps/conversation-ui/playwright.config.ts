import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { z } from "zod";
import { e2eWebOrigin } from "../../packages/oneharness-bridge/test/e2e-configuration";

const webAccessToken = z
  .string()
  .min(32)
  .max(256)
  // llmlint: ignore[no_hardcoded_secrets] The fallback is freshly generated cryptographic test-server capability material, not an inline literal or reusable credential.
  .parse(process.env.ONEHARNESS_UI_TEST_WEB_ACCESS_TOKEN ?? randomBytes(24).toString("base64url"));
process.env.ONEHARNESS_UI_TEST_WEB_ACCESS_TOKEN = webAccessToken;

export default defineConfig({
  expect: {
    timeout: 5_000,
    toHaveScreenshot: { animations: "disabled", maxDiffPixelRatio: 0.01 },
  },
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
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}",
  projects: [
    {
      name: "desktop-chromium",
      testMatch: ["**/conversations.e2e.ts", "**/screenshots.e2e.ts"],
      use: { ...devices["Desktop Chrome"], viewport: { height: 800, width: 1280 } },
    },
    {
      name: "mobile-chromium",
      testMatch: ["**/mobile.e2e.ts", "**/screenshots.e2e.ts"],
      use: { ...devices["Pixel 5"], viewport: { height: 844, width: 390 } },
    },
  ],
});
