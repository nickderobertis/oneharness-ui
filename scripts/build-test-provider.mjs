#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// llmlint: ignore[changed_behavior_has_e2e] This formatting-only failure wrapper preserves exit behavior; the real browser and service integration suites execute the provider build artifact.
process.on("uncaughtException", (error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `test provider build: ${message}; fix the reported failure, then rerun just bootstrap\n`,
  );
  process.exit(1);
});

const root = resolve(import.meta.dir, "..");
const outputDirectory = resolve(root, "target/oneharness-ui-test");
const suffix = process.platform === "win32" ? ".exe" : "";
const output = resolve(outputDirectory, `oneharness-mock-harness${suffix}`);
mkdirSync(outputDirectory, { recursive: true });

const build = Bun.spawnSync(
  [
    "rustc",
    "--edition=2024",
    "packages/oneharness-bridge/test/fixtures/oneharness-mock-harness.rs",
    "-o",
    output,
  ],
  { cwd: root, stderr: "inherit", stdout: "ignore" },
);
if (build.exitCode !== 0) {
  throw new Error(
    "could not compile oneharness's deterministic provider fixture; install the Rust version pinned in rust-toolchain.toml, then rerun just bootstrap",
  );
}
