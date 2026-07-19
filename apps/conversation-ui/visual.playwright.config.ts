import { defineConfig } from "@playwright/test";
import { e2eWebOrigin } from "../../packages/oneharness-bridge/test/e2e-configuration";

const webAccessToken = "screencomp-visual-docs-access-token";

export default defineConfig({
  fullyParallel: false,
  outputDir: "test-results/visual-docs",
  reporter: "line",
  retries: 0,
  testDir: "./tests/visual",
  testMatch: "**/*.visual.ts",
  timeout: 30_000,
  use: {
    baseURL: e2eWebOrigin,
    browserName: "chromium",
    deviceScaleFactor: 2,
    extraHTTPHeaders: {
      Authorization: `Basic ${Buffer.from(`oneharness:${webAccessToken}`).toString("base64")}`,
    },
    launchOptions: {
      args: [
        "--disable-skia-runtime-opts",
        "--headless=new",
        "--disable-gpu",
        "--disable-gpu-rasterization",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--force-color-profile=srgb",
        "--font-render-hinting=none",
        "--disable-lcd-text",
        "--hide-scrollbars",
        "--disable-dev-shm-usage",
      ],
    },
  },
  webServer: {
    command: "bun packages/oneharness-bridge/test/e2e-server.ts",
    cwd: "../..",
    env: {
      ONEHARNESS_UI_TEST_VISUAL: "true",
      ONEHARNESS_UI_TEST_WEB_ACCESS_TOKEN: webAccessToken,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: `${e2eWebOrigin}/health`,
  },
  workers: 1,
});
