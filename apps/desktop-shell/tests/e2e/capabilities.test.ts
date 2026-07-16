import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  createDesktopCapabilities,
  validateDesktopAppBinary,
  validateProviderArgvPath,
  validateWebView2UserDataFolder,
} from "./capabilities.ts";

describe("native desktop capabilities", () => {
  test("gives EdgeDriver and Tauri one isolated WebView2 profile on Windows", () => {
    expect(
      createDesktopCapabilities(
        "D:\\workspace\\target\\release\\oneharness-ui.exe",
        "win32",
        "D:\\temp\\oneharness-ui-webview2",
      ),
    ).toEqual({
      browserName: "tauri",
      "tauri:options": {
        application: "D:\\workspace\\target\\release\\oneharness-ui.exe",
        webviewOptions: { userDataFolder: "D:\\temp\\oneharness-ui-webview2" },
      },
    });
  });

  test("rejects a Windows session without the shared WebView2 profile", () => {
    expect(() => createDesktopCapabilities("oneharness-ui.exe", "win32")).toThrow(
      "ONEHARNESS_UI_E2E_WEBVIEW2_USER_DATA_DIR is required on Windows",
    );
  });

  test("does not send Edge-only options to the Linux driver", () => {
    expect(createDesktopCapabilities("/workspace/target/release/oneharness-ui", "linux")).toEqual({
      browserName: "tauri",
      "tauri:options": { application: "/workspace/target/release/oneharness-ui" },
    });
  });

  test("accepts only the real packaged executable at the release boundary", () => {
    const repository = mkdtempSync(resolve(tmpdir(), "oneharness-ui-app-binary-"));
    const executable = process.platform === "win32" ? "oneharness-ui.exe" : "oneharness-ui";
    const packaged = resolve(repository, "target", "release", executable);
    try {
      mkdirSync(dirname(packaged), { recursive: true });
      copyFileSync(process.execPath, packaged);
      chmodSync(packaged, 0o755);
      expect(validateDesktopAppBinary(packaged, repository)).toBe(packaged);
      expect(() => validateDesktopAppBinary(process.execPath, repository)).toThrow(
        "must be the packaged application from target/release",
      );
      rmSync(packaged);
      expect(() => validateDesktopAppBinary(packaged, repository)).toThrow(
        "must be an existing executable file",
      );
    } finally {
      rmSync(repository, { force: true, recursive: true });
    }
  });

  test("accepts only writable paths owned by the isolated desktop fixture", () => {
    const fixtureRoot = mkdtempSync(resolve(tmpdir(), "oneharness-ui-desktop-e2e-"));
    const localAppData = mkdtempSync(resolve(tmpdir(), "oneharness-ui-local-app-data-"));
    const providerArgv = resolve(fixtureRoot, "provider-argv.txt");
    const webview2Data = resolve(
      localAppData,
      "main",
      "oneharness-ui-desktop-e2e-profile",
      "webview2-user-data",
    );
    const misplacedWebview2Data = resolve(fixtureRoot, "webview2-user-data");
    try {
      writeFileSync(providerArgv, "");
      mkdirSync(webview2Data, { recursive: true });
      mkdirSync(misplacedWebview2Data);
      expect(validateProviderArgvPath(providerArgv)).toBe(realpathSync(providerArgv));
      expect(validateWebView2UserDataFolder(webview2Data, "win32", localAppData)).toBe(
        realpathSync(webview2Data),
      );
      expect(validateWebView2UserDataFolder(undefined, "linux")).toBeUndefined();
      expect(() =>
        validateWebView2UserDataFolder(misplacedWebview2Data, "win32", localAppData),
      ).toThrow("must match Tauri's isolated automation directory");
      expect(() => validateProviderArgvPath(process.execPath)).toThrow(
        "must stay inside its isolated directory",
      );
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
      rmSync(localAppData, { force: true, recursive: true });
    }
  });
});
