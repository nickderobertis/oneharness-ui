import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { verifyUiPackage } from "./verify-ui-package.mjs";

const root = resolve(import.meta.dir, "..");

test("fails closed before publishing when the npm token is absent or malformed", () => {
  for (const token of ["", "token with spaces"]) {
    const publish = Bun.spawnSync(["bun", "scripts/publish-ui.mjs", "--dry-run"], {
      cwd: root,
      env: { ...process.env, NPM_CONFIG_TOKEN: token },
    });
    expect(publish.exitCode).toBe(1);
    expect(publish.stderr.toString()).toContain("UI publish requires a non-empty npm token");
    expect(publish.stdout.toString()).not.toContain("@oneharness/ui");
  }
});

test("fails closed when a release build produces no declared export output", () => {
  const packageRoot = mkdtempSync(resolve(tmpdir(), "oneharness-ui-empty-package-"));
  try {
    writeFileSync(
      resolve(packageRoot, "package.json"),
      JSON.stringify({
        exports: {
          ".": { types: "./dist/index.d.mts", import: "./dist/index.mjs" },
          "./styles.css": "./dist/styles.css",
          "./package.json": "./package.json",
        },
      }),
    );

    expect(() => verifyUiPackage(packageRoot, ["package.json", "README.md"])).toThrow(
      "UI publish artifact is missing built export output: dist/index.d.mts, dist/index.mjs, dist/styles.css",
    );
  } finally {
    rmSync(packageRoot, { recursive: true, force: true });
  }
});

test("rejects malformed export configuration at the manifest boundary", () => {
  const packageRoot = mkdtempSync(resolve(tmpdir(), "oneharness-ui-invalid-package-"));
  try {
    writeFileSync(resolve(packageRoot, "package.json"), JSON.stringify({ exports: ["dist"] }));
    expect(() => verifyUiPackage(packageRoot, [])).toThrow(
      "UI package manifest must declare an exports object",
    );
  } finally {
    rmSync(packageRoot, { recursive: true, force: true });
  }
});

test("accepts a packed artifact containing every declared export", () => {
  const packageRoot = mkdtempSync(resolve(tmpdir(), "oneharness-ui-built-package-"));
  try {
    mkdirSync(resolve(packageRoot, "dist"));
    writeFileSync(
      resolve(packageRoot, "package.json"),
      JSON.stringify({
        exports: {
          ".": { types: "./dist/index.d.mts", import: "./dist/index.mjs" },
          "./styles.css": "./dist/styles.css",
          "./package.json": "./package.json",
        },
      }),
    );
    for (const path of ["dist/index.d.mts", "dist/index.mjs", "dist/styles.css"]) {
      writeFileSync(resolve(packageRoot, path), "");
    }

    expect(() =>
      verifyUiPackage(packageRoot, [
        "dist/index.d.mts",
        "dist/index.mjs",
        "package.json",
        "README.md",
      ]),
    ).toThrow("UI publish tarball would omit declared exports: dist/styles.css");

    expect(
      verifyUiPackage(packageRoot, [
        "dist/index.d.mts",
        "dist/index.mjs",
        "dist/styles.css",
        "package.json",
      ]),
    ).toEqual(["dist/index.d.mts", "dist/index.mjs", "dist/styles.css", "package.json"]);
  } finally {
    rmSync(packageRoot, { recursive: true, force: true });
  }
});
