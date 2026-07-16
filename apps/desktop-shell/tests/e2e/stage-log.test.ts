import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { recordDesktopStage, runDesktopStage } from "./stage-log.ts";

describe("native desktop stage diagnostics", () => {
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
