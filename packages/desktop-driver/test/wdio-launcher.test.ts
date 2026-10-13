import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Launcher } from "@wdio/cli";

test("a driver that cannot start stops the WDIO run with the driver's own error", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "desktop-wdio-launcher-"));
  const nodeOptions = process.env.NODE_OPTIONS;
  try {
    const spec = resolve(root, "journey.mjs");
    await writeFile(spec, "");
    const configuration = resolve(root, "wdio.conf.mjs");
    await writeFile(
      configuration,
      `export const config = ${JSON.stringify({
        capabilities: [{ browserName: "tauri" }],
        framework: "mocha",
        logLevel: "silent",
        outputDir: root,
        runner: "local",
        services: [
          [
            fileURLToPath(new URL("../src/tauri-launcher-service.ts", import.meta.url)),
            { logDir: root, nativeDriverPath: resolve(root, "missing-msedgedriver.exe") },
          ],
        ],
        specs: [spec],
      })};`,
    );
    // Without a SevereServiceError, WDIO logs "Continue...", starts a worker and
    // reports a session error that hides the driver failure.
    await expect(new Launcher(configuration).run()).rejects.toThrow(
      /onPrepare[\s\S]*native WebDriver executable is absent or not executable: .*missing-msedgedriver\.exe/,
    );
  } finally {
    if (nodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = nodeOptions;
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
