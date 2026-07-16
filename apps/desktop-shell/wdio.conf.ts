import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TauriCapabilities } from "@wdio/tauri-service";

const repository = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const artifacts = resolve(repository, "test-results/desktop-e2e");
const appBinary = process.env.ONEHARNESS_UI_E2E_APP_BINARY;
if (!appBinary) {
  throw new Error("ONEHARNESS_UI_E2E_APP_BINARY is required; run just test-desktop-e2e");
}
const capabilities: TauriCapabilities = {
  browserName: "tauri",
  "tauri:options": { application: appBinary },
};

export const config: WebdriverIO.Config = {
  afterTest: async (_test, _context, result) => {
    if (result.passed) return;
    await mkdir(artifacts, { recursive: true });
    await browser.saveScreenshot(resolve(artifacts, "failure.png"));
  },
  bail: 0,
  capabilities: [capabilities],
  connectionRetryCount: 1,
  connectionRetryTimeout: 120_000,
  framework: "mocha",
  logLevel: "info",
  maxInstances: 1,
  mochaOpts: { timeout: 120_000, ui: "bdd" },
  outputDir: artifacts,
  reporters: [["spec", { addConsoleLogs: true }]],
  runner: "local",
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath: appBinary,
        autoDownloadEdgeDriver: true,
        autoInstallTauriDriver: false,
        captureBackendLogs: true,
        captureFrontendLogs: true,
        driverProvider: "external",
        logDir: artifacts,
        logLevel: "info",
        startTimeout: 120_000,
      },
    ],
  ],
  specs: ["./tests/e2e/native.e2e.ts"],
  tsConfigPath: "./tsconfig.json",
  waitforTimeout: 20_000,
};
