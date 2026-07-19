import { describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { recordDesktopStage, runDesktopStage } from "./stage-log.ts";

describe("native desktop stage diagnostics", () => {
  test("loads through the Node TypeScript runtime used by WebdriverIO", async () => {
    const stageModule = new URL("./stage-log.ts", import.meta.url).href;
    const wdioCliPackage = realpathSync(
      new URL("../../node_modules/@wdio/cli/package.json", import.meta.url),
    );
    // Node's ESM loader rejects native Windows paths such as `D:\...` because it
    // reads the drive letter as a URL scheme, so `--import` needs a file URL.
    const tsxLoader = pathToFileURL(createRequire(wdioCliPackage).resolve("tsx")).href;
    const environment = { ...process.env };
    delete environment.FORCE_COLOR;
    const subprocess = Bun.spawn({
      cmd: [
        "node",
        "--import",
        tsxLoader,
        "--input-type=module",
        "--eval",
        `const stageLog = await import(${JSON.stringify(stageModule)}); process.stdout.write(stageLog.desktopE2eStageLog);`,
      ],
      env: environment,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stderr, stdout] = await Promise.all([
      subprocess.exited,
      new Response(subprocess.stderr).text(),
      new Response(subprocess.stdout).text(),
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      resolve(
        fileURLToPath(new URL(".", import.meta.url)),
        "../../../../test-results/desktop-e2e/stages.log",
      ),
    );
  }, 15_000);

  test("records bounded operation progress and identifies the failing stage", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "oneharness-ui-stage-log-"));
    const log = resolve(root, "stages.log");
    try {
      await recordDesktopStage(log, "webdriver session creation", "start");
      await recordDesktopStage(log, "webdriver session creation", "pass");
      await expect(
        runDesktopStage(log, "recover stopped session", async () => {
          throw new Error("operation failed");
        }),
      ).rejects.toThrow('native desktop E2E failed at stage "recover stopped session"');
      expect(await readFile(log, "utf8")).toBe(
        [
          "START\twebdriver session creation",
          "PASS\twebdriver session creation",
          "START\trecover stopped session",
          "FAIL\trecover stopped session",
          "",
        ].join("\n"),
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("rejects stage names that could forge diagnostic records", async () => {
    const log = resolve(tmpdir(), "oneharness-ui-invalid-stage.log");
    await expect(recordDesktopStage(log, "invalid\nstage", "start")).rejects.toThrow(
      "native desktop E2E stage name is invalid",
    );
  });
});
