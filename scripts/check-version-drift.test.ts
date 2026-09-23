import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

function bootstrapWith(engines: string, windowsEngines: string): string {
  return [
    'case "$(uname -s)" in',
    `  Linux) install_playwright_browsers --with-deps ${engines} ;;`,
    `  MINGW* | MSYS* | CYGWIN*) install_playwright_browsers ${windowsEngines} ;;`,
    `  *) install_playwright_browsers ${engines} ;;`,
    "esac",
    "",
  ].join("\n");
}

test("accepts a reconciled tree and rejects version, workflow, and browser drift with a remedy", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "oneharness-version-drift-"));
  try {
    await Promise.all([
      mkdir(resolve(root, ".github/workflows"), { recursive: true }),
      mkdir(resolve(root, "apps/conversation-ui"), { recursive: true }),
      mkdir(resolve(root, "apps/conversation-ui-e2e"), { recursive: true }),
      mkdir(resolve(root, "apps/desktop-shell"), { recursive: true }),
      mkdir(resolve(root, "apps/desktop-shell-e2e"), { recursive: true }),
      mkdir(resolve(root, "packages/browser-test-env"), { recursive: true }),
      mkdir(resolve(root, "packages/ipc-contract"), { recursive: true }),
      mkdir(resolve(root, "packages/oneharness-bridge"), { recursive: true }),
      mkdir(resolve(root, "packages/ui"), { recursive: true }),
      mkdir(resolve(root, "docs"), { recursive: true }),
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
        "apps/conversation-ui-e2e/package.json",
        "apps/desktop-shell-e2e/package.json",
        "packages/browser-test-env/package.json",
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
        resolve(root, "README.md"),
        "oneharness 1.2.3 CLI\n`@oneharness/sdk` package to `1.2.3`\nChromium and WebKit, and in Chromium alone\non Windows\n",
      ),
      writeFile(resolve(root, "docs/native-desktop-e2e.md"), "oneharness 1.2.3 CLI\n"),
      writeFile(
        resolve(root, "docs/architecture.md"),
        "run in Chromium and WebKit (Chromium alone on Windows).\n",
      ),
      writeFile(
        resolve(root, "apps/conversation-ui-e2e/playwright.config.ts"),
        [
          "export default defineConfig({",
          "  projects: [",
          '    { name: "chromium", use: { ...devices["Desktop Chrome"] } },',
          '    ...(process.platform === "win32"',
          "      ? []",
          '      : [{ name: "webkit", use: { ...devices["Desktop Safari"] } }]),',
          "  ],",
          "});",
          "",
        ].join("\n"),
      ),
      writeFile(
        resolve(root, "scripts/bootstrap.sh"),
        bootstrapWith("chromium webkit", "chromium"),
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
    await writeFile(resolve(root, "docs/native-desktop-e2e.md"), "oneharness 1.2.2 CLI\n");
    const documentationDrift = Bun.spawnSync(["node", "scripts/check-version-drift.mjs", root]);
    expect(documentationDrift.exitCode).toBe(1);
    expect(documentationDrift.stderr.toString()).toContain("documentation together");
    await writeFile(resolve(root, "docs/native-desktop-e2e.md"), "oneharness 1.2.3 CLI\n");
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
    await writeFile(
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
    );
    // A browser project the journeys run but bootstrap never provisions would
    // leave the second engine missing on a clean clone.
    await writeFile(resolve(root, "scripts/bootstrap.sh"), bootstrapWith("chromium", "chromium"));
    const browserDrift = Bun.spawnSync(["node", "scripts/check-version-drift.mjs", root]);
    expect(browserDrift.exitCode).toBe(1);
    expect(browserDrift.stderr.toString()).toContain(
      'engines on Linux with "Linux) install_playwright_browsers --with-deps chromium webkit ;;"',
    );
    // Windows runs only the projects before the guard, so provisioning WebKit
    // there is drift too.
    await writeFile(
      resolve(root, "scripts/bootstrap.sh"),
      bootstrapWith("chromium webkit", "chromium webkit"),
    );
    const windowsBrowserDrift = Bun.spawnSync(["node", "scripts/check-version-drift.mjs", root]);
    expect(windowsBrowserDrift.exitCode).toBe(1);
    expect(windowsBrowserDrift.stderr.toString()).toContain(
      'engines on Windows with "MINGW* | MSYS* | CYGWIN*) install_playwright_browsers chromium ;;"',
    );
    await writeFile(
      resolve(root, "scripts/bootstrap.sh"),
      bootstrapWith("chromium webkit", "chromium"),
    );
    await writeFile(resolve(root, "docs/architecture.md"), "run in Chromium.\n");
    const documentedBrowserDrift = Bun.spawnSync(["node", "scripts/check-version-drift.mjs", root]);
    expect(documentedBrowserDrift.exitCode).toBe(1);
    expect(documentedBrowserDrift.stderr.toString()).toContain(
      "docs/architecture.md must document the Chromium and WebKit browser journeys",
    );
    // The Windows exception is part of the documented matrix, so dropping it
    // from the documents, or keeping it once the projects drop it, is drift.
    await writeFile(resolve(root, "docs/architecture.md"), "run in Chromium and WebKit.\n");
    const windowsDocumentationDrift = Bun.spawnSync([
      "node",
      "scripts/check-version-drift.mjs",
      root,
    ]);
    expect(windowsDocumentationDrift.exitCode).toBe(1);
    expect(windowsDocumentationDrift.stderr.toString()).toContain(
      "docs/architecture.md must document the browser journeys running in Chromium alone on Windows",
    );
    await writeFile(
      resolve(root, "docs/architecture.md"),
      "run in Chromium and WebKit (Chromium alone on Windows).\n",
    );
    await writeFile(
      resolve(root, "apps/conversation-ui-e2e/playwright.config.ts"),
      [
        "export default defineConfig({",
        "  projects: [",
        '    { name: "chromium", use: { ...devices["Desktop Chrome"] } },',
        '    { name: "webkit", use: { ...devices["Desktop Safari"] } },',
        "  ],",
        "});",
        "",
      ].join("\n"),
    );
    await writeFile(
      resolve(root, "scripts/bootstrap.sh"),
      bootstrapWith("chromium webkit", "chromium webkit"),
    );
    const staleWindowsDocumentation = Bun.spawnSync([
      "node",
      "scripts/check-version-drift.mjs",
      root,
    ]);
    expect(staleWindowsDocumentation.exitCode).toBe(1);
    expect(staleWindowsDocumentation.stderr.toString()).toContain(
      "README.md documents a Windows browser exception",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
