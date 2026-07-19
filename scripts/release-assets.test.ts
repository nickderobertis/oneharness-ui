import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareReleaseAssets, releaseAssetName } from "./release-assets.mjs";

const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("release asset contract", () => {
  test("names every installer-selected platform deterministically", () => {
    expect(releaseAssetName("v1.2.3", "linux-x86_64", "appimage")).toBe(
      "oneharness-ui-v1.2.3-linux-x86_64.AppImage",
    );
    expect(releaseAssetName("v1.2.3", "linux-aarch64", "appimage")).toBe(
      "oneharness-ui-v1.2.3-linux-aarch64.AppImage",
    );
    expect(releaseAssetName("v1.2.3", "macos-aarch64", "dmg")).toBe(
      "oneharness-ui-v1.2.3-macos-aarch64.dmg",
    );
    expect(releaseAssetName("v1.2.3", "windows-x86_64", "msi")).toBe(
      "oneharness-ui-v1.2.3-windows-x86_64.msi",
    );
  });

  test("stages native ARM64 Linux artifacts with mandatory companion checksums", () => {
    const bundleDirectory = temporaryDirectory("oneharness-ui-bundles-");
    const nested = join(bundleDirectory, "nested");
    mkdirSync(nested);
    writeFileSync(join(nested, "tauri-output_aarch64.AppImage"), "appimage contents");
    writeFileSync(join(nested, "tauri-output_arm64.deb"), "deb contents");
    const assetDirectory = temporaryDirectory("oneharness-ui-release-assets-");

    const assets = prepareReleaseAssets({
      assetDirectory,
      bundleDirectory,
      formats: ["appimage", "deb"],
      platform: "linux-aarch64",
      tag: "v1.2.3",
    });

    expect(assets).toEqual([
      "oneharness-ui-v1.2.3-linux-aarch64.AppImage",
      "oneharness-ui-v1.2.3-linux-aarch64.deb",
    ]);
    for (const asset of assets) {
      const contents = readFileSync(join(assetDirectory, asset));
      const checksum = readFileSync(join(assetDirectory, `${asset}.sha256`), "utf8");
      expect(checksum).toBe(`${createHash("sha256").update(contents).digest("hex")}  ${asset}\n`);
    }
  });

  test("fails closed when a requested release format is missing", () => {
    const bundleDirectory = temporaryDirectory("oneharness-ui-bundles-");
    writeFileSync(join(bundleDirectory, "tauri-output_aarch64.AppImage"), "appimage contents");
    const assetDirectory = temporaryDirectory("oneharness-ui-release-assets-");

    expect(() =>
      prepareReleaseAssets({
        assetDirectory,
        bundleDirectory,
        formats: ["appimage", "deb"],
        platform: "linux-aarch64",
        tag: "v1.2.3",
      }),
    ).toThrow("expected exactly one deb bundle for linux-aarch64, found 0");
  });

  test("rejects a matrix that omits the installer-selected asset", () => {
    const bundleDirectory = temporaryDirectory("oneharness-ui-bundles-");
    const assetDirectory = temporaryDirectory("oneharness-ui-release-assets-");
    expect(() =>
      prepareReleaseAssets({
        assetDirectory,
        bundleDirectory,
        formats: ["deb"],
        platform: "linux-aarch64",
        tag: "v1.2.3",
      }),
    ).toThrow(
      "must include appimage; add it to RELEASE_ASSET_FORMATS and rerun just prepare-release-assets",
    );
  });

  test("rejects invalid release formats with an actionable matrix remedy", () => {
    const bundleDirectory = temporaryDirectory("oneharness-ui-bundles-");
    const assetDirectory = temporaryDirectory("oneharness-ui-release-assets-");

    expect(() => releaseAssetName("v1.2.3", "macos-aarch64", "msi")).toThrow(
      "msi is not a release format for macos-aarch64; rerun with one of dmg",
    );
    expect(() =>
      prepareReleaseAssets({
        assetDirectory,
        bundleDirectory,
        formats: [],
        platform: "linux-aarch64",
        tag: "v1.2.3",
      }),
    ).toThrow(
      "release asset formats must be a nonempty list without duplicates; correct RELEASE_ASSET_FORMATS and rerun just prepare-release-assets",
    );
    expect(() =>
      prepareReleaseAssets({
        assetDirectory,
        bundleDirectory,
        formats: ["appimage", "appimage"],
        platform: "linux-aarch64",
        tag: "v1.2.3",
      }),
    ).toThrow(
      "release asset formats must be a nonempty list without duplicates; correct RELEASE_ASSET_FORMATS and rerun just prepare-release-assets",
    );
    expect(() =>
      prepareReleaseAssets({
        assetDirectory,
        bundleDirectory,
        formats: ["appimage", "msi"],
        platform: "linux-aarch64",
        tag: "v1.2.3",
      }),
    ).toThrow(
      "release asset formats for linux-aarch64 must be selected from appimage,deb; correct RELEASE_ASSET_FORMATS and rerun just prepare-release-assets",
    );
  });
});
