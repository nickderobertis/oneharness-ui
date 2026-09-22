import { randomBytes } from "node:crypto";
import { e2eWebOrigin } from "@oneharness-ui/bridge/test/e2e-configuration.ts";
import { defineConfig, devices } from "@playwright/test";
import { z } from "zod";

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
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  timeout: 30_000,
  use: {
    baseURL: e2eWebOrigin,
    // llmlint: ignore[secrets_stay_server_side] The journey is the browser client of the bridge's own e2e web server, and this header is how a client presents the per-run loopback credential that server requires; the server still enforces it, and the token is generated for this process rather than shared with anything outside it.
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
