#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("a valid semver is required; run just set-version <major.minor.patch>");
}
const root = resolve(import.meta.dir, "..");

for (const relative of [
  "package.json",
  "apps/conversation-ui/package.json",
  "packages/ipc-contract/package.json",
  "packages/oneharness-bridge/package.json",
  "apps/desktop-shell/tauri.conf.json",
]) {
  const path = resolve(root, relative);
  const document = JSON.parse(readFileSync(path, "utf8"));
  document.version = version;
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}

for (const relative of ["Cargo.toml", "apps/desktop-shell/Cargo.toml"]) {
  const path = resolve(root, relative);
  const content = readFileSync(path, "utf8");
  const next =
    relative === "Cargo.toml"
      ? content.replace(/(\[workspace\.package\][\s\S]*?\nversion = ")[^"]+/, `$1${version}`)
      : content;
  writeFileSync(path, next);
}

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
  stderr: "inherit",
  stdout: "ignore",
});
if (lock.exitCode !== 0) {
  throw new Error(
    "cargo failed to refresh Cargo.lock after versioning; resolve the dependency error and rerun just set-version",
  );
}
