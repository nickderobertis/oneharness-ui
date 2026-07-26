import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

test("fails closed before publishing when the npm token is absent or malformed", () => {
  for (const token of ["", "token with spaces"]) {
    const publish = Bun.spawnSync(["bun", "scripts/publish-ui.mjs", "--dry-run"], {
      cwd: root,
      env: { ...process.env, NPM_CONFIG_TOKEN: token },
    });
    expect(publish.exitCode).toBe(1);
    expect(publish.stderr.toString()).toContain("UI publish requires a non-empty npm token");
    expect(publish.stderr.toString().trim().split("\n")).toHaveLength(1);
    expect(publish.stdout.toString()).not.toContain("@oneharness/ui");
  }
});

test("builds the public package before producing the publish manifest", () => {
  const workspaceRoot = resolve(root, "packages/ui");
  const packageManifest: unknown = JSON.parse(
    readFileSync(resolve(workspaceRoot, "package.json"), "utf8"),
  );
  if (
    !isRecord(packageManifest) ||
    !isRecord(packageManifest.exports) ||
    !isRecord(packageManifest.exports["."]) ||
    typeof packageManifest.exports["."].import !== "string"
  ) {
    throw new Error("UI test requires a package manifest with a string import export");
  }
  const expectedArtifact = packageManifest.exports["."].import.slice(2);
  const distribution = resolve(workspaceRoot, "dist");
  const staleArtifact = resolve(distribution, "publish-test-stale.txt");

  writeFileSync(staleArtifact, "must be removed by the package build");
  try {
    const publish = Bun.spawnSync(["bun", "scripts/publish-ui.mjs", "--dry-run"], {
      cwd: root,
      env: { ...process.env, NPM_CONFIG_TOKEN: "dry-run-token" },
    });
    expect(publish.exitCode).toBe(0);
    expect(publish.stdout.toString()).toContain(expectedArtifact);
    expect(publish.stdout.toString()).not.toContain("workspace:");
    expect(publish.stdout.toString().trim().split("\n")).toHaveLength(1);
    expect(existsSync(staleArtifact)).toBe(false);
  } finally {
    rmSync(staleArtifact, { force: true });
  }
}, 15_000);
