import type { TauriCapabilities } from "@wdio/tauri-service";

type TauriOptions = Omit<NonNullable<TauriCapabilities["tauri:options"]>, "webviewOptions"> & {
  webviewOptions?: { userDataFolder: string };
};

type DesktopTauriCapabilities = Omit<TauriCapabilities, "tauri:options"> & {
  "tauri:options": TauriOptions;
};

export function createDesktopCapabilities(
  appBinary: string,
  platform: NodeJS.Platform,
  webview2UserDataFolder?: string,
): DesktopTauriCapabilities {
  const tauriOptions: TauriOptions = { application: appBinary };
  if (platform === "win32") {
    if (!webview2UserDataFolder) {
      throw new Error(
        "ONEHARNESS_UI_E2E_WEBVIEW2_USER_DATA_DIR is required on Windows; run just test-desktop-e2e",
      );
    }
    tauriOptions.webviewOptions = { userDataFolder: webview2UserDataFolder };
  }

  return {
    browserName: "tauri",
    "tauri:options": tauriOptions,
  };
}
