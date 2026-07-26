import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";

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

test("builds the public package before producing the publish manifest", () => {
  const workspaceRoot = resolve(root, "packages/ui");
  const distribution = resolve(workspaceRoot, "dist");
  const temporaryRoot = mkdtempSync(resolve(workspaceRoot, ".publish-test-"));
  const savedDistribution = resolve(temporaryRoot, "dist");
  const hadDistribution = existsSync(distribution);

  if (hadDistribution) renameSync(distribution, savedDistribution);
  try {
    const publish = Bun.spawnSync(["bun", "scripts/publish-ui.mjs", "--dry-run"], {
      cwd: root,
      env: { ...process.env, NPM_CONFIG_TOKEN: "dry-run-token" },
    });
    expect(publish.exitCode).toBe(0);
    expect(publish.stdout.toString()).toContain("dist/index.mjs");
    expect(publish.stdout.toString()).not.toContain("workspace:");
  } finally {
    rmSync(distribution, { force: true, recursive: true });
    if (hadDistribution) renameSync(savedDistribution, distribution);
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
