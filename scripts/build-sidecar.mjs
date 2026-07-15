#!/usr/bin/env bun
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const rustc = Bun.spawnSync(["rustc", "-vV"], { cwd: root });
if (rustc.exitCode !== 0) throw new Error("rustc -vV failed; install the pinned Rust toolchain");
const host = rustc.stdout.toString().match(/^host: (.+)$/m)?.[1];
if (!host) throw new Error("could not determine the Rust host target triple");

const outputDirectory = resolve(root, "apps/desktop-shell/binaries");
mkdirSync(outputDirectory, { recursive: true });
const suffix = process.platform === "win32" ? ".exe" : "";
const output = resolve(outputDirectory, `oneharness-ui-bridge-${host}${suffix}`);
const build = Bun.spawnSync(
  ["bun", "build", "--compile", "packages/oneharness-bridge/src/cli.ts", "--outfile", output],
  { cwd: root, stderr: "inherit", stdout: "ignore" },
);
if (build.exitCode !== 0) throw new Error("could not compile the oneharness bridge sidecar");

const upstream = resolve(
  root,
  ".cache/upstream-target/debug",
  `oneharness${process.platform === "win32" ? ".exe" : ""}`,
);
copyFileSync(upstream, resolve(outputDirectory, `oneharness-${host}${suffix}`));
