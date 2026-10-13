import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  findDriverExecutable,
  nativeDriverResult,
  prepareNativeDriver,
  validateDriverExecutable,
} from "../src/native-driver.ts";

test("PowerShell result fields and version pattern stay aligned with the validated consumer", async () => {
  const producer = await readFile(
    new URL("../src/prepare-edge-driver.ps1", import.meta.url),
    "utf8",
  );
  const results = [...producer.matchAll(/@\{([^}]+)\}\s*\|\s*ConvertTo-Json/g)];
  expect(results).toHaveLength(2);
  for (const result of results) {
    const keys = [...(result[1] ?? "").matchAll(/\b(\w+)\s*=/g)].map((key) => key[1]);
    expect(keys.sort()).toEqual(nativeDriverResult.keyof().options.toSorted());
  }
  const version = z.toJSONSchema(nativeDriverResult.shape.version).pattern;
  if (typeof version !== "string")
    throw new Error("native driver version must have a shared pattern");
  const capture = `MSEdgeDriver (${version.replace(/^\^|\$$/g, "")})`;
  expect(producer.split(capture)).toHaveLength(3);
});

test("native executable validation rejects relative paths and directories", () => {
  expect(() => validateDriverExecutable("relative-driver", "msedgedriver")).toThrow(
    "absolute executable path",
  );
  expect(() => validateDriverExecutable(tmpdir(), "msedgedriver")).toThrow(
    "absent or not executable",
  );
  expect(validateDriverExecutable(process.execPath, "test driver")).toBe(process.execPath);
});

describe("Linux native WebDriver discovery", () => {
  test.skipIf(process.platform !== "linux")(
    "selects an executable absolute path before launch and reports an absent driver",
    async () => {
      const root = await mkdtemp(resolve(tmpdir(), "desktop-native-driver-"));
      const previousPath = process.env.PATH;
      const executable = resolve(root, "WebKitWebDriver");
      try {
        process.env.PATH = root;
        await expect(prepareNativeDriver()).rejects.toThrow(/WebKitWebDriver is absent from PATH/);
        await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
        expect(await prepareNativeDriver()).toBe(executable);
      } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

const powershell = process.platform === "win32" ? "powershell.exe" : "pwsh";
let hasPowerShell = true;
try {
  findDriverExecutable(powershell);
} catch {
  hasPowerShell = false;
}

describe("msedgedriver download architecture", () => {
  test.skipIf(!hasPowerShell)(
    "is resolved without the processor variables the journey's allowlisted environment omits",
    () => {
      // Mirrors deterministicDesktopEnvironment: PATH and SystemRoot reach the
      // driver preparation, PROCESSOR_ARCHITECTURE does not.
      const environment: Record<string, string> = { PATH: process.env.PATH ?? "" };
      if (process.env.SystemRoot) environment.SystemRoot = process.env.SystemRoot;
      const architecture = execFileSync(
        powershell,
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          fileURLToPath(new URL("../src/edge-driver-architecture.ps1", import.meta.url)),
        ],
        { encoding: "utf8", env: environment, timeout: 60_000 },
      ).trim();
      const expected = { arm64: "arm64", ia32: "win32", x64: "win64" }[process.arch as string];
      expect(architecture).toBe(expected ?? "unsupported");
    },
    70_000,
  );
});
