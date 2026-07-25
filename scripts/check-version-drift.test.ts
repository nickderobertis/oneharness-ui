import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

test("accepts reconciled versions and rejects workflow drift with a remedy", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "oneharness-version-drift-"));
  try {
    await Promise.all([
      mkdir(resolve(root, ".github/workflows"), { recursive: true }),
      mkdir(resolve(root, "apps/conversation-ui"), { recursive: true }),
      mkdir(resolve(root, "apps/desktop-shell"), { recursive: true }),
      mkdir(resolve(root, "packages/ipc-contract"), { recursive: true }),
      mkdir(resolve(root, "packages/oneharness-bridge"), { recursive: true }),
      mkdir(resolve(root, "packages/ui"), { recursive: true }),
      mkdir(resolve(root, "scripts"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        resolve(root, ".tool-versions"),
        "bun 1.2.3\nnodejs 22.1.0\njust 1.2.3\nuv 0.1.2\n",
      ),
      writeFile(
        resolve(root, "apps/desktop-shell/package.json"),
        JSON.stringify({
          devDependencies: { "@oneharness/sdk": "1.2.3", typescript: "6.0.3" },
        }),
      ),
      writeFile(
        resolve(root, "packages/oneharness-bridge/package.json"),
        JSON.stringify({
          dependencies: { "@oneharness/sdk": "1.2.3" },
          devDependencies: { typescript: "6.0.3" },
        }),
      ),
      writeFile(
        resolve(root, "package.json"),
        JSON.stringify({ devDependencies: { typescript: "6.0.3" } }),
      ),
      ...[
        "apps/conversation-ui/package.json",
        "packages/ipc-contract/package.json",
        "packages/ui/package.json",
      ].map((path) =>
        writeFile(
          resolve(root, path),
          JSON.stringify({ devDependencies: { typescript: "6.0.3" } }),
        ),
      ),
      writeFile(
        resolve(root, "scripts/build-compatible-cli.sh"),
        'readonly UPSTREAM_VERSION="1.2.3"\n',
      ),
      writeFile(
        resolve(root, ".github/workflows/check.yml"),
        [
          "uses: actions/setup-node@example",
          "node-version: 22.1.0",
          "uses: oven-sh/setup-bun@example",
          "bun-version: 1.2.3",
          "uses: astral-sh/setup-uv@example",
          "version: 0.1.2",
          "run: cargo install just --locked --version 1.2.3",
        ].join("\n"),
      ),
    ]);

    const valid = Bun.spawnSync(["node", "scripts/check-version-drift.mjs", root]);
    expect(valid.exitCode).toBe(0);
    await writeFile(
      resolve(root, "packages/ui/package.json"),
      JSON.stringify({ devDependencies: { typescript: "5.9.3" } }),
    );
    const typescriptDrift = Bun.spawnSync(["node", "scripts/check-version-drift.mjs", root]);
    expect(typescriptDrift.exitCode).toBe(1);
    expect(typescriptDrift.stderr.toString()).toContain("update both manifests together");
    await writeFile(
      resolve(root, "packages/ui/package.json"),
      JSON.stringify({ devDependencies: { typescript: "6.0.3" } }),
    );
    await writeFile(
      resolve(root, ".github/workflows/check.yml"),
      "uses: actions/setup-node@example\nnode-version: 20.0.0\n",
    );
    const invalid = Bun.spawnSync(["node", "scripts/check-version-drift.mjs", root]);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr.toString()).toContain("update both files together");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
