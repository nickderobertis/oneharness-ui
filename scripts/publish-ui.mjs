#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.on("uncaughtException", (error) => {
  console.error(error instanceof Error ? error.message : "UI publish failed unexpectedly");
  process.exit(1);
});

const packageName = "@oneharness/ui";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const token = process.env.NPM_CONFIG_TOKEN;
const hasInvalidTokenCharacter =
  typeof token === "string" &&
  Array.from(token).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      character.trim() === "" || codePoint === undefined || codePoint < 32 || codePoint === 127
    );
  });

if (
  typeof token !== "string" ||
  token.length === 0 ||
  token.length > 1024 ||
  hasInvalidTokenCharacter
) {
  throw new Error(
    "UI publish requires a non-empty npm token without whitespace or control characters; set NPM_CONFIG_TOKEN from the NPM_TOKEN secret and rerun just publish-release",
  );
}

const arguments_ = process.argv.slice(2);
if (arguments_.some((argument) => argument !== "--dry-run")) {
  throw new Error("UI publish only accepts --dry-run; remove unsupported arguments and retry");
}
const isDryRun = arguments_.includes("--dry-run");

const rootManifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
if (!Array.isArray(rootManifest.workspaces)) {
  throw new Error(
    "root package.json must declare workspaces; restore it and rerun just publish-release",
  );
}

const manifestPaths = [];
for (const workspace of rootManifest.workspaces) {
  if (typeof workspace !== "string" || !/^[A-Za-z0-9*._/-]+$/.test(workspace)) {
    throw new Error(
      "root package.json contains an invalid workspace pattern; correct it and rerun just publish-release",
    );
  }
  const glob = new Bun.Glob(`${workspace}/package.json`);
  for await (const relativePath of glob.scan({ cwd: root, onlyFiles: true })) {
    const path = resolve(root, relativePath);
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    if (manifest.name === packageName) manifestPaths.push(path);
  }
}

if (manifestPaths.length !== 1) {
  throw new Error(
    `expected exactly one ${packageName} workspace, found ${manifestPaths.length}; restore the package manifest and rerun just publish-release`,
  );
}

const workspaceRoot = dirname(manifestPaths[0]);
const build = Bun.spawnSync(["just", "build-ui"], {
  cwd: root,
  env: process.env,
  stderr: "inherit",
  stdout: "pipe",
});
if (build.exitCode !== 0) {
  throw new Error(
    `UI build failed with exit code ${build.exitCode}; correct the build failure and rerun just publish-release`,
  );
}

const publish = Bun.spawnSync(
  ["bun", "publish", "--cwd", workspaceRoot, "--access", "public", ...arguments_],
  {
    cwd: root,
    env: process.env,
    stderr: "inherit",
    stdout: isDryRun ? "inherit" : "pipe",
  },
);
if (publish.exitCode !== 0) {
  throw new Error(
    `UI publish failed with exit code ${publish.exitCode}; inspect the registry diagnostic and rerun just publish-release`,
  );
}
if (!isDryRun) console.log(`${packageName} published`);
