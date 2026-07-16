#!/usr/bin/env bun
import { copyFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const rustc = Bun.spawnSync(["rustc", "-vV"], { cwd: root });
if (rustc.exitCode !== 0) {
  throw new Error(
    "rustc -vV failed; install the Rust version pinned in rust-toolchain.toml, then rerun just bootstrap",
  );
}
const host = rustc.stdout.toString().match(/^host: (.+)$/m)?.[1];
if (!host || !/^[A-Za-z0-9][A-Za-z0-9_.-]{2,199}$/.test(host)) {
  throw new Error(
    "rustc returned an invalid host target triple; reinstall the Rust version pinned in rust-toolchain.toml and rerun just bootstrap",
  );
}

const outputDirectory = resolve(root, "apps/desktop-shell/binaries");
mkdirSync(outputDirectory, { recursive: true });
const suffix = process.platform === "win32" ? ".exe" : "";
const output = resolve(outputDirectory, `oneharness-ui-bridge-${host}${suffix}`);
const build = Bun.spawnSync(
  ["bun", "build", "--compile", "packages/oneharness-bridge/src/cli.ts", "--outfile", output],
  { cwd: root, stderr: "inherit", stdout: "ignore" },
);
if (build.exitCode !== 0) {
  throw new Error(
    "could not compile the oneharness bridge sidecar; fix the emitted Bun diagnostic and rerun just bootstrap",
  );
}

const platformPackages = {
  "darwin-arm64": "@oneharness/cli-darwin-arm64",
  "darwin-x64": "@oneharness/cli-darwin-x64",
  "linux-arm64": "@oneharness/cli-linux-arm64",
  "linux-x64": "@oneharness/cli-linux-x64",
  "win32-x64": "@oneharness/cli-win32-x64",
};
const platformKey = `${process.platform}-${process.arch}`;
const platformPackage = platformPackages[platformKey];
if (!platformPackage) {
  throw new Error(
    `@oneharness/sdk 0.3.23 has no packaged CLI for ${platformKey}; use a supported release target`,
  );
}
let upstream;
try {
  const sdkRequire = createRequire(
    resolve(
      realpathSync(resolve(root, "packages/oneharness-bridge/node_modules/@oneharness/sdk")),
      "dist/index.js",
    ),
  );
  const cliRequire = createRequire(sdkRequire.resolve("oneharness-cli/bin/oneharness.js"));
  upstream = resolve(
    dirname(cliRequire.resolve(`${platformPackage}/package.json`)),
    "bin",
    `oneharness${suffix}`,
  );
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  throw new Error(
    `could not resolve @oneharness/sdk 0.3.23's packaged CLI: ${detail}; run bun install --frozen-lockfile with optional dependencies enabled, then rerun just bootstrap`,
  );
}
if (!existsSync(upstream)) {
  throw new Error(
    `@oneharness/sdk 0.3.23 packaged CLI is missing at ${upstream}; reinstall with optional dependencies enabled, then rerun just bootstrap`,
  );
}
copyFileSync(upstream, resolve(outputDirectory, `oneharness-${host}${suffix}`));
