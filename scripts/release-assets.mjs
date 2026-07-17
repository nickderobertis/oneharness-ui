#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const product = "oneharness-ui";
const platformFormats = {
  "linux-aarch64": ["appimage", "deb"],
  "linux-x86_64": ["appimage", "deb"],
  "macos-aarch64": ["dmg"],
  "windows-x86_64": ["msi", "nsis"],
};
const primaryFormats = {
  "linux-aarch64": "appimage",
  "linux-x86_64": "appimage",
  "macos-aarch64": "dmg",
  "windows-x86_64": "msi",
};
const formatContracts = {
  appimage: { source: /\.AppImage$/, suffix: ".AppImage" },
  deb: { source: /\.deb$/, suffix: ".deb" },
  dmg: { source: /\.dmg$/, suffix: ".dmg" },
  msi: { source: /\.msi$/, suffix: ".msi" },
  nsis: { source: /-setup\.exe$/, suffix: "-setup.exe" },
};

function requireSemverTag(tag) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error("release tag must be a v-prefixed semantic version such as v0.2.0");
  }
}

function requirePlatform(platform) {
  if (!(platform in platformFormats)) {
    throw new Error(
      `unsupported release platform: ${platform}; use ${Object.keys(platformFormats).join(", ")}`,
    );
  }
}

export function releaseAssetName(tag, platform, format) {
  requireSemverTag(tag);
  requirePlatform(platform);
  const allowed = platformFormats[platform];
  if (!allowed.includes(format)) {
    throw new Error(`${format} is not a release format for ${platform}`);
  }
  return `${product}-${tag}-${platform}${formatContracts[format].suffix}`;
}

function checksum(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sourceArtifacts(bundleDirectory, format) {
  const contract = formatContracts[format];
  return [...new Bun.Glob("**/*").scanSync({ cwd: bundleDirectory, onlyFiles: true })]
    .filter((path) => contract.source.test(basename(path)))
    .sort();
}

export function prepareReleaseAssets({ assetDirectory, bundleDirectory, formats, platform, tag }) {
  requireSemverTag(tag);
  requirePlatform(platform);
  const allowed = platformFormats[platform];
  const uniqueFormats = [...new Set(formats)];
  if (uniqueFormats.length !== formats.length || formats.length === 0) {
    throw new Error("release asset formats must be a nonempty list without duplicates");
  }
  if (formats.some((format) => !allowed.includes(format))) {
    throw new Error(
      `release asset formats for ${platform} must be selected from ${allowed.join(",")}`,
    );
  }
  if (!formats.includes(primaryFormats[platform])) {
    throw new Error(`release assets for ${platform} must include ${primaryFormats[platform]}`);
  }
  if (!statSync(bundleDirectory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`bundle directory does not exist: ${bundleDirectory}; run just bundle first`);
  }

  rmSync(assetDirectory, { force: true, recursive: true });
  mkdirSync(assetDirectory, { recursive: true });
  const assets = [];
  for (const format of formats) {
    const sources = sourceArtifacts(bundleDirectory, format);
    if (sources.length !== 1) {
      throw new Error(
        `expected exactly one ${format} bundle for ${platform}, found ${sources.length}; rerun just bundle with the release matrix formats`,
      );
    }
    const name = releaseAssetName(tag, platform, format);
    const destination = resolve(assetDirectory, name);
    copyFileSync(resolve(bundleDirectory, sources[0]), destination);
    writeFileSync(resolve(assetDirectory, `${name}.sha256`), `${checksum(destination)}  ${name}\n`);
    assets.push(name);
  }
  return assets;
}

function verifyInstallerContract(tag, platform) {
  const result = Bun.spawnSync(["sh", "scripts/install.sh", "--version", tag, "--print-asset"], {
    cwd: root,
  });
  if (result.exitCode !== 0) {
    throw new Error(`installer platform detection failed: ${result.stderr.toString().trim()}`);
  }
  const detected = result.stdout.toString().trim();
  const expected = releaseAssetName(tag, platform, primaryFormats[platform]);
  if (detected !== expected) {
    throw new Error(
      `release runner does not match ${platform}: installer selected ${detected || "no asset"}; use the native runner declared by the release matrix`,
    );
  }
}

function main() {
  const [bundleArgument, assetArgument, platform, tag, formatArgument] = process.argv.slice(2);
  if (bundleArgument !== "target/release/bundle") {
    throw new Error(
      "bundle directory must be target/release/bundle; set the release input and retry",
    );
  }
  if (assetArgument !== "target/release-assets") {
    throw new Error(
      "asset directory must be target/release-assets; set the release input and retry",
    );
  }
  if (!platform || !tag || !formatArgument) {
    throw new Error(
      "bundle directory, asset directory, release platform, tag, and formats are required; run just prepare-release-assets with the release matrix environment",
    );
  }
  requirePlatform(platform);
  verifyInstallerContract(tag, platform);
  prepareReleaseAssets({
    assetDirectory: resolve(root, assetArgument),
    bundleDirectory: resolve(root, bundleArgument),
    formats: formatArgument.split(","),
    platform,
    tag,
  });
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`release assets: ${detail}`);
    process.exit(1);
  }
}
