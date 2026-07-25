#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const requestedRoot = process.argv[2];
if (requestedRoot !== undefined && !isAbsolute(requestedRoot)) {
  throw new Error("version drift root must be absolute; pass an absolute fixture path");
}
const root = requestedRoot ?? resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const versions = Object.fromEntries(
  read(".tool-versions")
    .trim()
    .split("\n")
    .map((line) => line.split(/\s+/, 2)),
);
const requiredTools = ["bun", "nodejs", "just", "uv"];
for (const tool of requiredTools) {
  if (!versions[tool]) {
    throw new Error(`.tool-versions is missing ${tool}; add its stable pinned version`);
  }
}

const workflowDirectory = resolve(root, ".github/workflows");
for (const entry of readdirSync(workflowDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".yml")) continue;
  const workflow = read(`.github/workflows/${entry.name}`);
  const expectations = [
    ["actions/setup-node@", `node-version: ${versions.nodejs}`],
    ["oven-sh/setup-bun@", `bun-version: ${versions.bun}`],
    ["astral-sh/setup-uv@", `version: ${versions.uv}`],
    ["cargo install just", `cargo install just --locked --version ${versions.just}`],
  ];
  for (const [marker, expected] of expectations) {
    if (workflow.includes(marker) && !workflow.includes(expected)) {
      throw new Error(
        `${entry.name} must use ${expected} from .tool-versions; update both files together`,
      );
    }
  }
}

const bridgeManifest = JSON.parse(read("packages/oneharness-bridge/package.json"));
const desktopManifest = JSON.parse(read("apps/desktop-shell/package.json"));
const sdkVersion = bridgeManifest.dependencies?.["@oneharness/sdk"];
if (
  typeof sdkVersion !== "string" ||
  desktopManifest.devDependencies?.["@oneharness/sdk"] !== sdkVersion
) {
  throw new Error(
    "desktop and bridge @oneharness/sdk pins must match; update both manifests together",
  );
}
const compatibleBuild = read("scripts/build-compatible-cli.sh");
if (!compatibleBuild.includes(`readonly UPSTREAM_VERSION="${sdkVersion}"`)) {
  throw new Error(
    "build-compatible-cli.sh UPSTREAM_VERSION must match @oneharness/sdk; update its pinned revision and version",
  );
}
