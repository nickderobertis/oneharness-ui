import { expect, test } from "bun:test";
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
