#!/usr/bin/env bun
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const tauriConfig = "apps/desktop-shell/tauri.conf.json";
const supportedFormats = new Set(["app", "appimage", "deb", "dmg", "msi", "nsis"]);

class CommandFailure extends Error {
  constructor(exitCode) {
    super(`native bundle command exited with status ${exitCode}`);
    this.exitCode = exitCode;
  }
}

function run(command) {
  const result = Bun.spawnSync(command, {
    cwd: root,
    stderr: "pipe",
    stdin: "inherit",
    stdout: "pipe",
  });
  if (result.exitCode !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new CommandFailure(result.exitCode);
  }
}

function hostTarget() {
  const rustc = Bun.spawnSync(["rustc", "-vV"], { cwd: root });
  if (rustc.exitCode !== 0) {
    throw new Error(
      "rustc -vV failed; install the Rust version pinned in rust-toolchain.toml and rerun just bundle",
    );
  }
  const host = rustc.stdout.toString().match(/^host: (.+)$/m)?.[1];
  if (!host || !/^[A-Za-z0-9][A-Za-z0-9_.-]{2,199}$/.test(host)) {
    throw new Error(
      "rustc returned an invalid host target triple; reinstall the pinned Rust toolchain and rerun just bundle",
    );
  }
  return host;
}

export function stageAppImageSidecar(source, layoutRoot) {
  const binDirectory = join(layoutRoot, "usr/bin");
  const shareDirectory = join(layoutRoot, "usr/share/oneharness");
  const payload = join(shareDirectory, "oneharness-ui-bridge");
  const link = join(binDirectory, "oneharness-ui-bridge");

  mkdirSync(binDirectory, { recursive: true });
  mkdirSync(shareDirectory, { recursive: true });
  copyFileSync(source, payload);
  chmodSync(payload, statSync(source).mode & 0o777);
  symlinkSync("../share/oneharness/oneharness-ui-bridge", link);

  if (readlinkSync(link) !== "../share/oneharness/oneharness-ui-bridge") {
    throw new Error("could not stage the AppImage bridge symlink");
  }
  return { link, payload };
}

export function appImageOverride(layoutRoot) {
  return JSON.stringify({
    bundle: {
      externalBin: ["binaries/oneharness"],
      linux: { appimage: { files: { "/": layoutRoot } } },
    },
  });
}

export function requiresSourceBuiltCli(platform, architecture) {
  return platform === "linux" && architecture === "arm64";
}

function tauriBuild(formats, extraConfig) {
  const command = ["bunx", "tauri", "build", "--verbose", "--config", tauriConfig];
  if (extraConfig) {
    command.push("--config", extraConfig);
  }
  command.push("--bundles", formats.join(","));
  run(command);
}

function main() {
  const formats = (process.argv[2] ?? "").split(",").filter(Boolean);
  if (formats.length === 0 || formats.some((format) => !supportedFormats.has(format))) {
    throw new Error("provide a comma-separated list of supported platform bundle formats");
  }

  if (requiresSourceBuiltCli(process.platform, process.arch)) {
    run(["bash", "scripts/build-compatible-cli.sh"]);
  }

  const standardFormats = formats.filter((format) => format !== "appimage");
  if (standardFormats.length > 0) {
    tauriBuild(standardFormats);
  }
  if (!formats.includes("appimage")) {
    return;
  }
  if (process.platform !== "linux") {
    throw new Error("the appimage format requires a Linux build host");
  }

  run(["bun", "scripts/build-sidecar.mjs"]);
  const source = resolve(
    root,
    "apps/desktop-shell/binaries",
    `oneharness-ui-bridge-${hostTarget()}`,
  );
  const layoutRoot = mkdtempSync(join(tmpdir(), "oneharness-ui-appimage-"));
  try {
    stageAppImageSidecar(source, layoutRoot);
    tauriBuild(["appimage"], appImageOverride(layoutRoot));
  } finally {
    rmSync(layoutRoot, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    if (error instanceof CommandFailure) {
      console.error(
        `native bundle orchestration: child command exited with status ${error.exitCode}; inspect the diagnostic above and rerun just bundle`,
      );
      process.exit(error.exitCode);
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      `native bundle orchestration: ${detail}; correct the packaging input and rerun just bundle`,
    );
    process.exit(1);
  }
}
