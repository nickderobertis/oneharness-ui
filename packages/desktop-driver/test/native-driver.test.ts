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
  const parser = await readFile(new URL("../src/edge-driver-version.ps1", import.meta.url), "utf8");
  const capture = `(?:Microsoft Edge WebDriver|MSEdgeDriver) (${version.replace(/^\^|\$$/g, "")})`;
  expect(parser.split(capture)).toHaveLength(2);
  expect(producer.split("& $readVersion ")).toHaveLength(3);
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
      const downloads = new Map([
        ["arm64", "arm64"],
        ["ia32", "win32"],
        ["x64", "win64"],
      ]);
      expect(architecture).toBe(downloads.get(process.arch) ?? "unsupported");
    },
    70_000,
  );
});

async function readDriverVersion(stdout: string, exitCode = 0) {
  const root = await mkdtemp(resolve(tmpdir(), "desktop-edge-version-"));
  const lines = stdout.split("\n");
  const driver = resolve(root, process.platform === "win32" ? "msedgedriver.cmd" : "msedgedriver");
  await writeFile(
    driver,
    process.platform === "win32"
      ? `@echo off\r\n${lines.map((line) => `echo ${line}`).join("\r\n")}\r\nexit /b ${exitCode}\r\n`
      : `#!/bin/sh\n${lines.map((line) => `echo '${line}'`).join("\n")}\nexit ${exitCode}\n`,
    { mode: 0o700 },
  );
  try {
    // Invoke the parser as prepare-edge-driver.ps1 does, and surface its
    // exception message the way that script's catch blocks receive it.
    const parser = fileURLToPath(new URL("../src/edge-driver-version.ps1", import.meta.url));
    return execFileSync(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "try { & $env:EDGE_VERSION_PARSER $env:EDGE_DRIVER } catch { [Console]::Error.Write($_.Exception.Message); exit 1 }",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, EDGE_DRIVER: driver, EDGE_VERSION_PARSER: parser },
        stdio: "pipe",
        timeout: 60_000,
      },
    ).trim();
  } catch (error) {
    throw new Error(String((error as { stderr?: unknown }).stderr ?? error));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("msedgedriver version report", () => {
  test.skipIf(!hasPowerShell)(
    "accepts the current and legacy banners, including multi-line output",
    async () => {
      expect(
        await readDriverVersion(
          "Microsoft Edge WebDriver 153.0.4234.48 (cf31d6623d8718e7a3c3e181e55e59c1aae57a73)",
        ),
      ).toBe("153.0.4234.48");
      expect(await readDriverVersion("MSEdgeDriver 120.0.2210.91 (abc)")).toBe("120.0.2210.91");
      expect(
        await readDriverVersion(
          "Starting msedgedriver\nMicrosoft Edge WebDriver 153.0.4234.48 (x)",
        ),
      ).toBe("153.0.4234.48");
    },
    70_000,
  );

  test.skipIf(!hasPowerShell)(
    "names the driver and what it printed when no version is reported",
    async () => {
      const failure = readDriverVersion("unexpected banner 1.2");
      await expect(failure).rejects.toThrow(/msedgedriver at .*msedgedriver/);
      await expect(failure).rejects.toThrow(/did not report its version \(exit 0\)/);
      await expect(failure).rejects.toThrow(/it printed 'unexpected banner 1\.2'/);
      await expect(
        readDriverVersion("Microsoft Edge WebDriver 153.0.4234.48 (x)", 3),
      ).rejects.toThrow(/\(exit 3\); it printed 'Microsoft Edge WebDriver 153\.0\.4234\.48 \(x\)'/);
    },
    70_000,
  );
});
