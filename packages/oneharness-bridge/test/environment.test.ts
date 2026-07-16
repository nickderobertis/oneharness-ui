import { describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnvironment } from "../src/environment.ts";

describe("readEnvironment", () => {
  test("accepts canonical local paths and ignores unrelated variables", () => {
    const root = mkdtempSync(join(tmpdir(), "oneharness-ui-environment-"));
    const executable = join(root, process.platform === "win32" ? "oneharness.exe" : "oneharness");
    const provider = join(root, process.platform === "win32" ? "provider.exe" : "provider");
    const history = join(root, "history");
    try {
      copyFileSync(process.execPath, executable);
      copyFileSync(process.execPath, provider);
      chmodSync(executable, 0o755);
      chmodSync(provider, 0o755);
      mkdirSync(history);
      expect(
        readEnvironment({
          ONEHARNESS_BIN: executable,
          ONEHARNESS_UI_HISTORY_DIR: history,
          ONEHARNESS_UI_HTTP_TOKEN: "oneharness-ui-environment-authorization",
          ONEHARNESS_UI_PROVIDER_BIN: provider,
          UNRELATED: "secret",
        }),
      ).toEqual({
        executable: realpathSync(executable),
        historyDir: realpathSync(history),
        httpAuthorization: "oneharness-ui-environment-authorization",
        providerBin: realpathSync(provider),
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("rejects empty configured paths", () => {
    expect(() => readEnvironment({ ONEHARNESS_BIN: "" })).toThrow();
    expect(() => readEnvironment({ ONEHARNESS_BIN: "relative/oneharness" })).toThrow(
      "must be an absolute path",
    );
    expect(() => readEnvironment({ ONEHARNESS_UI_HISTORY_DIR: join(tmpdir(), "missing") })).toThrow(
      "must be an existing writable directory",
    );
    expect(() => readEnvironment({ ONEHARNESS_UI_HTTP_TOKEN: "too-short" })).toThrow();
  });

  test("falls through cleanly when no bundled executable is adjacent", () => {
    expect(readEnvironment({})).toEqual({});
  });
});
