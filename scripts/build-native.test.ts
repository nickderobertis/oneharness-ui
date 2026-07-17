import { expect, test } from "bun:test";
import { lstatSync, mkdtempSync, readlinkSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { appImageOverride, requiresSourceBuiltCli, stageAppImageSidecar } from "./build-native.mjs";

test("builds the pinned CLI from source only for Linux ARM64 bundles", () => {
  expect(requiresSourceBuiltCli("linux", "arm64")).toBe(true);
  expect(requiresSourceBuiltCli("linux", "x64")).toBe(false);
  expect(requiresSourceBuiltCli("darwin", "arm64")).toBe(false);
  expect(requiresSourceBuiltCli("win32", "arm64")).toBe(false);
});

test("reports invalid bundle input with a concrete command-surface remedy", () => {
  const root = resolve(import.meta.dir, "..");
  const result = Bun.spawnSync(["bun", "scripts/build-native.mjs", "invalid"], { cwd: root });
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("provide a comma-separated list");
  expect(result.stderr.toString()).toContain("rerun just bundle");
});

test.skipIf(process.platform !== "linux")(
  "stages the real bridge outside linuxdeploy's mutable directories",
  () => {
    const root = resolve(import.meta.dir, "..");
    const rustc = Bun.spawnSync(["rustc", "-vV"], { cwd: root });
    expect(rustc.exitCode).toBe(0);
    const host = rustc.stdout.toString().match(/^host: (.+)$/m)?.[1];
    expect(host).toBeTruthy();

    const source = resolve(root, "apps/desktop-shell/binaries", `oneharness-ui-bridge-${host}`);
    const layoutRoot = mkdtempSync(join(tmpdir(), "oneharness-ui-layout-test-"));
    try {
      const { link, payload } = stageAppImageSidecar(source, layoutRoot);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readlinkSync(link)).toBe("../share/oneharness/oneharness-ui-bridge");
      expect(statSync(payload).size).toBe(statSync(source).size);
      expect(Bun.spawnSync(["ldd", link]).exitCode).toBe(0);

      const override = JSON.parse(appImageOverride(layoutRoot));
      expect(override.bundle.externalBin).toEqual(["binaries/oneharness"]);
      expect(override.bundle.linux.appimage.files).toEqual({
        "/": layoutRoot,
      });
    } finally {
      rmSync(layoutRoot, { force: true, recursive: true });
    }
  },
);
