import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const execute = promisify(execFile);
const preparationTimeout = 240_000;
const driverResult = z.object({
  path: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
});

export function validateDriverExecutable(path: string, label: string): string {
  if (!isAbsolute(path)) throw new Error(`${label} requires an absolute executable path: ${path}`);
  try {
    accessSync(path, constants.R_OK | constants.X_OK);
    if (!statSync(path).isFile()) throw new Error("not a file");
  } catch {
    throw new Error(
      `${label} executable is absent or not executable: ${path}; install it before starting tauri-driver`,
    );
  }
  return path;
}

export function findDriverExecutable(name: string): string {
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    try {
      return validateDriverExecutable(resolve(directory, name), name);
    } catch {
      /* An invalid PATH candidate must not shadow a later executable. */
    }
  }
  throw new Error(
    `${name} is absent from PATH; install the documented driver before starting tauri-driver`,
  );
}

export async function prepareNativeDriver(): Promise<string> {
  if (process.platform !== "win32") {
    return findDriverExecutable("WebKitWebDriver");
  }
  const started = performance.now();
  try {
    const { stdout } = await execute(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        fileURLToPath(new URL("./prepare-edge-driver.ps1", import.meta.url)),
      ],
      { timeout: preparationTimeout, maxBuffer: 16_384 },
    );
    const result = driverResult.parse(JSON.parse(stdout.trim()));
    validateDriverExecutable(result.path, "msedgedriver");
    console.info(`Native WebDriver: msedgedriver ${result.version} at ${result.path}`);
    return result.path;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `msedgedriver preparation failed before tauri-driver startup after ${Math.round(performance.now() - started)}ms (limit ${preparationTimeout}ms): ${detail}; install the WebView2-matched driver or restore access to msedgedriver.microsoft.com and retry`,
    );
  }
}
