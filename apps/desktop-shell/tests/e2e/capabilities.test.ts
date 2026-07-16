import { describe, expect, test } from "bun:test";
import { createDesktopCapabilities } from "./capabilities.ts";

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
});
