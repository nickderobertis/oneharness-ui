import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDesktopCapabilities,
  validateDesktopAppBinary,
  validateWebView2UserDataFolder,
} from "./tests/e2e/capabilities.ts";
import { desktopE2eStageLog, recordDesktopStage } from "./tests/e2e/stage-log.ts";

const repository = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const artifacts = resolve(repository, "test-results/desktop-e2e");
const tauriLauncherService = fileURLToPath(
  new URL("./tests/e2e/tauri-launcher-service.ts", import.meta.url),
);
const appBinary = validateDesktopAppBinary(process.env.ONEHARNESS_UI_E2E_APP_BINARY, repository);
const webview2UserDataFolder = validateWebView2UserDataFolder(
  process.env.ONEHARNESS_UI_E2E_WEBVIEW2_USER_DATA_DIR,
  process.platform,
  process.env.LOCALAPPDATA,
);
const capabilities = createDesktopCapabilities(appBinary, process.platform, webview2UserDataFolder);
const startupOnly = process.env.ONEHARNESS_UI_E2E_STARTUP_ONLY;
if (startupOnly !== undefined && startupOnly !== "1") {
  throw new Error("ONEHARNESS_UI_E2E_STARTUP_ONLY must be 1 when set");
}

export const config: WebdriverIO.Config = {
  afterTest: async (_test, _context, result) => {
    if (result.passed) return;
    await mkdir(artifacts, { recursive: true });
    try {
      await browser.saveScreenshot(resolve(artifacts, "failure.png"));
      await recordDesktopStage(desktopE2eStageLog, "failure screenshot", "pass");
    } catch {
      await recordDesktopStage(desktopE2eStageLog, "failure screenshot", "fail");
    }
  },
  afterSession: async () => {
    await recordDesktopStage(desktopE2eStageLog, "webdriver session cleanup", "pass");
  },
  bail: 0,
  before: async () => {
    await recordDesktopStage(desktopE2eStageLog, "webdriver session creation", "pass");
    await recordDesktopStage(desktopE2eStageLog, "wdio plugin bridge bypass", "pass");
  },
  beforeSession: async () => {
    await recordDesktopStage(desktopE2eStageLog, "webdriver launcher setup", "pass");
    await recordDesktopStage(desktopE2eStageLog, "webdriver session creation", "start");
  },
  capabilities: [capabilities],
  connectionRetryCount: 0,
  connectionRetryTimeout: 70_000,
  framework: "mocha",
  logLevel: "info",
  maxInstances: 1,
  mochaOpts: { timeout: 240_000, ui: "bdd" },
  onComplete: async (exitCode) => {
    await recordDesktopStage(
      desktopE2eStageLog,
      "webdriver runner completion",
      exitCode === 0 ? "pass" : "fail",
    );
  },
  onPrepare: async () => {
    await recordDesktopStage(desktopE2eStageLog, "webdriver profile configuration", "pass");
    await recordDesktopStage(desktopE2eStageLog, "webdriver launcher setup", "start");
  },
  outputDir: artifacts,
  reporters: [["spec", { addConsoleLogs: true }]],
  runner: "local",
  services: [
    [
      tauriLauncherService,
      {
        appBinaryPath: appBinary,
        autoDownloadEdgeDriver: true,
        autoInstallTauriDriver: false,
        captureBackendLogs: true,
        captureFrontendLogs: false,
        driverProvider: "external",
        logDir: artifacts,
        logLevel: "info",
      },
    ],
  ],
  specs: [startupOnly ? "./tests/e2e/native-startup.e2e.ts" : "./tests/e2e/native.e2e.ts"],
  tsConfigPath: "./tsconfig.json",
  waitforTimeout: 20_000,
};
