import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const toolVersions = Object.fromEntries(
  readFileSync(".tool-versions", "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split(/\s+/, 2)),
);

const workflows = [
  ".github/workflows/check.yml",
  ".github/workflows/desktop-e2e.yml",
  ".github/workflows/llmlint.yml",
  ".github/workflows/release.yml",
  ".github/workflows/version.yml",
];

function matchedVersions(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1] as string);
}

describe("workspace toolchain pins", () => {
  test("CI provisions the same tools as a local checkout", () => {
    for (const path of workflows) {
      const workflow = readFileSync(path, "utf8");
      expect(matchedVersions(workflow, /node-version: ([^\s]+)/g), path).toEqual(
        expect.arrayContaining([toolVersions.nodejs]),
      );
      expect(matchedVersions(workflow, /bun-version: ([^\s]+)/g), path).toEqual(
        expect.arrayContaining([toolVersions.bun]),
      );
      expect(matchedVersions(workflow, /^\s+version: ([^\s]+)$/gm), path).toEqual(
        expect.arrayContaining([toolVersions.uv]),
      );
      expect(
        matchedVersions(workflow, /cargo install just --locked --version ([^\s]+)/g),
        path,
      ).toEqual(expect.arrayContaining([toolVersions.just]));

      expect(new Set(matchedVersions(workflow, /node-version: ([^\s]+)/g)), path).toEqual(
        new Set([toolVersions.nodejs]),
      );
      expect(new Set(matchedVersions(workflow, /bun-version: ([^\s]+)/g)), path).toEqual(
        new Set([toolVersions.bun]),
      );
    }
  });

  test("language and package-manager pins stay aligned", () => {
    const rustToolchain = readFileSync("rust-toolchain.toml", "utf8");
    expect(rustToolchain).toContain(`channel = "${toolVersions.rust}"`);

    const rootManifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      packageManager: string;
    };
    expect(rootManifest.packageManager).toBe(`bun@${toolVersions.bun}`);

    for (const path of [
      "package.json",
      "apps/conversation-ui/package.json",
      "apps/desktop-shell/package.json",
      "packages/ipc-contract/package.json",
      "packages/oneharness-bridge/package.json",
      "packages/ui/package.json",
    ]) {
      const manifest = JSON.parse(readFileSync(path, "utf8")) as {
        devDependencies?: { typescript?: string };
      };
      expect(manifest.devDependencies?.typescript, path).toBe("5.9.3");
    }
  });
});
