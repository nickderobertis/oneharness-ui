#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const version = process.argv[2];
if (!version || !semver.test(version)) {
  throw new Error(
    "a valid semver is required; run RELEASE_VERSION=<major.minor.patch> just set-version",
  );
}
const root = resolve(import.meta.dir, "..");

function versionedDocument(path) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `could not parse versioned manifest ${path}; fix its JSON and rerun just set-version`,
      {
        cause: error,
      },
    );
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof value.version !== "string" ||
    !semver.test(value.version)
  ) {
    throw new Error(
      `versioned manifest ${path} must be an object with a semver version; restore it and rerun just set-version`,
    );
  }
  return value;
}

const manifests = [
  "package.json",
  "apps/conversation-ui/package.json",
  "packages/ipc-contract/package.json",
  "packages/oneharness-bridge/package.json",
  "apps/desktop-shell/tauri.conf.json",
].map((relative) => {
  const path = resolve(root, relative);
  return { document: versionedDocument(path), path };
});

const cargoPath = resolve(root, "Cargo.toml");
const cargoContent = readFileSync(cargoPath, "utf8");
const cargoVersion = /(\[workspace\.package\][\s\S]*?\nversion = ")([^"]+)/;
const currentCargoVersion = cargoContent.match(cargoVersion)?.[2];
if (!currentCargoVersion || !semver.test(currentCargoVersion)) {
  throw new Error(
    "Cargo.toml must declare a semver workspace.package version; restore it and rerun just set-version",
  );
}

for (const { document, path } of manifests) {
  document.version = version;
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}
writeFileSync(cargoPath, cargoContent.replace(cargoVersion, `$1${version}`));

const format = Bun.spawnSync(["just", "format"], {
  cwd: root,
  stderr: "inherit",
  stdout: "inherit",
});
if (format.exitCode !== 0) {
  throw new Error(
    "manifest formatting failed; fix the reported formatter error and rerun just set-version",
  );
}

const lock = Bun.spawnSync(["cargo", "update", "--workspace"], {
  cwd: root,
});
if (lock.exitCode !== 0) {
  process.stderr.write(lock.stdout);
  process.stderr.write(lock.stderr);
  throw new Error(
    "cargo failed to refresh Cargo.lock after versioning; resolve the dependency error and rerun just set-version",
  );
}
