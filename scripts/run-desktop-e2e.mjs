#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  createDesktopFixture,
  deterministicDesktopEnvironment,
} from "../apps/desktop-shell/tests/e2e/fixture.ts";
import {
  desktopE2eStageLog,
  recordDesktopStage,
  runDesktopStage,
} from "../apps/desktop-shell/tests/e2e/stage-log.ts";

const root = resolve(import.meta.dir, "..");
const artifacts = resolve(root, "test-results/desktop-e2e");
const driverVersion = "tauri-driver v2.0.6:";

function enabledFlag(name) {
  const value = process.env[name];
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  throw new Error(`${name} must be 0 or 1; correct the native journey environment and retry`);
}

function run(command, environment, label, remedy) {
  const result = Bun.spawnSync(command, {
    cwd: root,
    env: environment,
  });
  if (result.exitCode === 0) return;
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
  throw new Error(`${label} exited with status ${result.exitCode}; ${remedy}`);
}

function appBinary() {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const path = resolve(root, `target/release/oneharness-ui${suffix}`);
  if (!existsSync(path)) {
    throw new Error(
      `built Tauri application is missing at ${path}; inspect the native package build and rerun just test-desktop-e2e`,
    );
  }
  return path;
}

function createStartupFixture() {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "oneharness-ui-desktop-startup-"));
  const historyDirectory = resolve(fixtureRoot, "history");
  mkdirSync(historyDirectory);
  return {
    cleanup: async () => rmSync(fixtureRoot, { force: true, recursive: true }),
    environment: {
      ONEHARNESS_NO_CONFIG: "1",
      ONEHARNESS_UI_HISTORY_DIR: historyDirectory,
      TAURI_WEBVIEW_AUTOMATION: "true",
    },
  };
}

async function main() {
  const extractAndRun = enabledFlag("APPIMAGE_EXTRACT_AND_RUN");
  const prebuiltApplication = enabledFlag("ONEHARNESS_UI_E2E_PREBUILT");
  const startupOnly = enabledFlag("ONEHARNESS_UI_E2E_STARTUP_ONLY");
  rmSync(artifacts, { force: true, recursive: true });
  await recordDesktopStage(desktopE2eStageLog, "artifact initialization", "pass");

  await runDesktopStage(desktopE2eStageLog, "platform prerequisites", () => {
    if (process.platform === "darwin") {
      throw new Error(
        "official tauri-driver cannot drive WKWebView on macOS; use the macOS native build/install smoke in CI",
      );
    }
    if (process.platform !== "linux" && process.platform !== "win32") {
      throw new Error(
        `official tauri-driver is unsupported on ${process.platform}; run the journey on Linux or Windows, or use the macOS native smoke in CI`,
      );
    }
    if (process.platform === "linux") {
      if (!Bun.which("pkg-config") || !Bun.which("WebKitWebDriver")) {
        throw new Error(
          "Linux requires pkg-config and WebKitWebDriver; install webkit2gtk-driver and the documented Tauri prerequisites",
        );
      }
      const environment = deterministicDesktopEnvironment({});
      const webkit = Bun.spawnSync(["pkg-config", "--exists", "webkit2gtk-4.1"], {
        cwd: root,
        env: environment,
      });
      if (webkit.exitCode !== 0) {
        throw new Error(
          "Linux requires the WebKitGTK 4.1 development package; install libwebkit2gtk-4.1-dev and rerun just test-desktop-e2e",
        );
      }
      if (!/^(?:[A-Za-z0-9_.-]+)?:\d+(?:\.\d+)?$/.test(environment.DISPLAY ?? "")) {
        throw new Error("Linux requires a display; rerun with xvfb-run -a just test-desktop-e2e");
      }
    }
  });

  await runDesktopStage(desktopE2eStageLog, "tauri driver verification", () => {
    const installed = Bun.spawnSync(["cargo", "install", "--list"], {
      cwd: root,
      env: deterministicDesktopEnvironment({}),
    });
    if (
      installed.exitCode !== 0 ||
      !installed.stdout.toString().split("\n").includes(driverVersion)
    ) {
      throw new Error("tauri-driver 2.0.6 is required; run just bootstrap");
    }
  });

  if (prebuiltApplication) {
    await runDesktopStage(desktopE2eStageLog, "prebuilt native application verification", () => {
      appBinary();
    });
  } else {
    const format = process.platform === "win32" ? "msi" : "deb";
    await runDesktopStage(desktopE2eStageLog, `native ${format} package build`, () =>
      run(
        ["just", "bundle"],
        deterministicDesktopEnvironment({ BUNDLE_FORMATS: format }),
        `native ${format} package build`,
        "install the reported Tauri prerequisite and rerun just test-desktop-e2e",
      ),
    );
  }

  const fixture = await runDesktopStage(
    desktopE2eStageLog,
    startupOnly ? "startup fixture creation" : "desktop fixture creation",
    async () => (startupOnly ? createStartupFixture() : createDesktopFixture()),
  );
  try {
    await runDesktopStage(desktopE2eStageLog, "webdriver native journey", () =>
      run(
        ["bun", "run", "--cwd", "apps/desktop-shell", "test:e2e"],
        deterministicDesktopEnvironment({
          ...fixture.environment,
          APPIMAGE_EXTRACT_AND_RUN: extractAndRun ? "1" : undefined,
          ONEHARNESS_UI_E2E_APP_BINARY: appBinary(),
          ONEHARNESS_UI_E2E_STARTUP_ONLY: startupOnly ? "1" : undefined,
          // Node 26 must provide the fetch primitives as one compatible set. The
          // mixed global/bundled Undici path fails before reaching tauri-driver.
          WDIO_USE_NATIVE_FETCH: "1",
        }),
        "WebdriverIO native journey",
        "inspect test-results/desktop-e2e and rerun just test-desktop-e2e",
      ),
    );
  } catch (error) {
    if (!startupOnly) {
      try {
        await runDesktopStage(desktopE2eStageLog, "webdriver profile diagnostics", () =>
          fixture.recordWebView2Diagnostics(resolve(artifacts, "webview2-profile.log")),
        );
      } catch (diagnosticError) {
        const detail = diagnosticError instanceof Error ? diagnosticError.message : "unknown error";
        console.error(
          `native desktop E2E profile diagnostics failed: ${detail}; inspect test-results/desktop-e2e and rerun just test-desktop-e2e`,
        );
      }
    }
    throw error;
  } finally {
    await runDesktopStage(desktopE2eStageLog, "desktop fixture cleanup", fixture.cleanup);
  }
  await recordDesktopStage(desktopE2eStageLog, "native desktop journey", "pass");
  rmSync(artifacts, { force: true, recursive: true });
}

try {
  process.exitCode = await main();
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(
    `native desktop E2E: ${detail}; apply the reported remedy and rerun just test-desktop-e2e`,
  );
  process.exitCode = 1;
}
