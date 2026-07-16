import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { TauriCapabilities } from "@wdio/tauri-service";

type TauriOptions = Omit<NonNullable<TauriCapabilities["tauri:options"]>, "webviewOptions"> & {
  webviewOptions?: { userDataFolder: string };
};

type DesktopTauriCapabilities = Omit<TauriCapabilities, "tauri:options"> & {
  "tauri:options": TauriOptions;
};

const FIXTURE_ROOT_PREFIX = "oneharness-ui-desktop-e2e-";

function validateFixtureEntry(
  input: string | undefined,
  expectedName: string,
  kind: "directory" | "file",
): string {
  if (!input) throw new Error(`desktop fixture ${expectedName} path is required`);
  let temporaryRoot: string;
  let entry: string;
  try {
    temporaryRoot = realpathSync(tmpdir());
    entry = realpathSync(input);
    accessSync(entry, constants.R_OK | constants.W_OK);
  } catch {
    throw new Error(`desktop fixture ${expectedName} must be an existing writable ${kind}`);
  }
  const localRoot = relative(temporaryRoot, dirname(entry));
  const matchesKind =
    kind === "directory" ? statSync(entry).isDirectory() : statSync(entry).isFile();
  if (
    basename(entry) !== expectedName ||
    !matchesKind ||
    !localRoot.startsWith(FIXTURE_ROOT_PREFIX) ||
    localRoot.includes(sep) ||
    isAbsolute(localRoot)
  ) {
    throw new Error(`desktop fixture ${expectedName} must stay inside its isolated directory`);
  }
  return entry;
}

export function validateWebView2UserDataFolder(
  input: string | undefined,
  platform: NodeJS.Platform,
): string | undefined {
  return platform === "win32"
    ? validateFixtureEntry(input, "webview2-user-data", "directory")
    : undefined;
}

export function validateProviderArgvPath(input: string | undefined): string {
  return validateFixtureEntry(input, "provider-argv.txt", "file");
}

export function validateDesktopAppBinary(input: string | undefined, repository: string): string {
  const executable = process.platform === "win32" ? "oneharness-ui.exe" : "oneharness-ui";
  const expected = resolve(repository, "target", "release", executable);
  if (input !== expected || basename(input) !== executable) {
    throw new Error(
      "ONEHARNESS_UI_E2E_APP_BINARY must be the packaged application from target/release",
    );
  }
  try {
    accessSync(input, constants.X_OK);
    if (!statSync(input).isFile()) throw new Error("not a file");
  } catch {
    throw new Error("ONEHARNESS_UI_E2E_APP_BINARY must be an existing executable file");
  }
  return input;
}

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
