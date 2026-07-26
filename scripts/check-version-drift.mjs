#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const requestedRoot = process.argv[2];
if (requestedRoot !== undefined && !isAbsolute(requestedRoot)) {
  throw new Error("version drift root must be absolute; pass an absolute fixture path");
}
const root = requestedRoot ?? resolve(import.meta.dirname, "..");
const read = (path) => {
  try {
    return readFileSync(resolve(root, path), "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `could not read ${path}: ${detail}; restore the required file and rerun just check`,
    );
  }
};
const readJson = (path) => {
  try {
    return JSON.parse(read(path));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("could not read ")) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${path} must contain valid JSON: ${detail}; fix the manifest and rerun just check`,
    );
  }
};
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
  if (!/^\d+\.\d+\.\d+$/.test(versions[tool])) {
    throw new Error(
      `.tool-versions ${tool} must be an exact stable version; replace it with an X.Y.Z pin`,
    );
  }
}

const workflowDirectory = resolve(root, ".github/workflows");
let workflowEntries;
try {
  workflowEntries = readdirSync(workflowDirectory, { withFileTypes: true });
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  throw new Error(
    `could not read .github/workflows: ${detail}; restore the workflow directory and rerun just check`,
  );
}
for (const entry of workflowEntries) {
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

const bridgeManifest = readJson("packages/oneharness-bridge/package.json");
const desktopManifest = readJson("apps/desktop-shell/package.json");
const rootManifest = readJson("package.json");
const typescriptVersion = rootManifest.devDependencies?.typescript;
const typescriptManifests = [
  ["apps/conversation-ui/package.json", readJson("apps/conversation-ui/package.json")],
  ["apps/desktop-shell/package.json", desktopManifest],
  ["packages/ipc-contract/package.json", readJson("packages/ipc-contract/package.json")],
  ["packages/oneharness-bridge/package.json", bridgeManifest],
  ["packages/ui/package.json", readJson("packages/ui/package.json")],
];
if (typeof typescriptVersion !== "string") {
  throw new Error("root package.json must pin TypeScript; add its stable pinned version");
}
for (const [path, manifest] of typescriptManifests) {
  if (manifest.devDependencies?.typescript !== typescriptVersion) {
    throw new Error(
      `${path} TypeScript pin must match root package.json; update both manifests together`,
    );
  }
}
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
const sdkDocumentation = [
  ["README.md", `oneharness ${sdkVersion} CLI`, `@oneharness/sdk\` package to \`${sdkVersion}`],
  ["docs/native-desktop-e2e.md", `oneharness ${sdkVersion} CLI`],
];
for (const [path, ...expectedValues] of sdkDocumentation) {
  const documentation = read(path);
  for (const expected of expectedValues) {
    if (!documentation.includes(expected)) {
      throw new Error(
        `${path} must document @oneharness/sdk ${sdkVersion}; update the package pins and documentation together`,
      );
    }
  }
}
