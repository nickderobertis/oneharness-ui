import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function executable(path: string, contents: string) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function installerEnvironment(os: string, arch: string, extra: Record<string, string> = {}) {
  const testRoot = temporaryDirectory("oneharness-ui-installer-test-");
  const bin = join(testRoot, "bin");
  mkdirSync(bin);
  executable(
    join(bin, "uname"),
    `#!/bin/sh\ncase "$1" in\n  -s) printf '%s\\n' "$TEST_UNAME_OS" ;;\n  -m) printf '%s\\n' "$TEST_UNAME_ARCH" ;;\n  *) exit 2 ;;\nesac\n`,
  );
  return {
    ...process.env,
    HOME: join(testRoot, "home"),
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    TEST_UNAME_ARCH: arch,
    TEST_UNAME_OS: os,
    ...extra,
  };
}

function runInstaller(args: string[], environment: Record<string, string | undefined>) {
  return Bun.spawnSync(["sh", "scripts/install.sh", ...args], {
    cwd: root,
    env: environment,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("release platform selection", () => {
  for (const [os, arch, asset] of [
    ["Linux", "x86_64", "oneharness-ui-v1.2.3-linux-x86_64.AppImage"],
    ["Linux", "aarch64", "oneharness-ui-v1.2.3-linux-aarch64.AppImage"],
    ["Darwin", "arm64", "oneharness-ui-v1.2.3-macos-aarch64.dmg"],
    ["MINGW64_NT-10.0", "amd64", "oneharness-ui-v1.2.3-windows-x86_64.msi"],
  ]) {
    test(`selects ${asset}`, () => {
      const result = runInstaller(
        ["--version", "v1.2.3", "--print-asset"],
        installerEnvironment(os, arch),
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString().trim()).toBe(asset);
      expect(result.stderr.toString()).toBe("");
    });
  }

  test("honors the explicit version environment", () => {
    const result = runInstaller(
      ["--print-asset"],
      installerEnvironment("Linux", "aarch64", { ONEHARNESS_UI_VERSION: "v2.0.1" }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("oneharness-ui-v2.0.1-linux-aarch64.AppImage");
  });

  for (const [os, arch, message] of [
    ["FreeBSD", "x86_64", "unsupported operating system: FreeBSD"],
    ["Linux", "riscv64", "unsupported architecture: riscv64"],
    ["Darwin", "x86_64", "no prebuilt installer for macos-x86_64"],
    ["MINGW64_NT-10.0", "arm64", "no prebuilt installer for windows-aarch64"],
  ]) {
    test(`rejects ${os} ${arch} with a remedy`, () => {
      const result = runInstaller(
        ["--version", "v1.2.3", "--print-asset"],
        installerEnvironment(os, arch),
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(message);
      expect(result.stderr.toString()).toContain(
        "https://github.com/nickderobertis/oneharness-ui/releases",
      );
    });
  }

  test("rejects unsafe version input before constructing a download URL", () => {
    const result = runInstaller(
      ["--version", "latest/../../main", "--print-asset"],
      installerEnvironment("Linux", "aarch64"),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("invalid release version");
  });
});

function writeReleaseFixture(directory: string, asset: string, validChecksum = true) {
  const contents = "#!/bin/sh\nprintf 'oneharness UI fixture\\n'\n";
  const assetPath = join(directory, asset);
  writeFileSync(assetPath, contents);
  const digest = validChecksum
    ? createHash("sha256").update(contents).digest("hex")
    : "0".repeat(64);
  writeFileSync(`${assetPath}.sha256`, `${digest}  ${asset}\n`);
  return contents;
}

function addOfflineCurl(environment: Record<string, string | undefined>, fixture: string) {
  const bin = environment.PATH?.split(":")[0];
  if (!bin) {
    throw new Error("test PATH did not contain its mock directory");
  }
  executable(
    join(bin, "curl"),
    `#!/bin/sh
output=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -H | --retry | --retry-delay | --connect-timeout) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  https://api.github.com/*) printf '%s\\n' '{"tag_name":"v1.2.3"}' ;;
  *) cp "$TEST_RELEASE_FIXTURE/\${url##*/}" "$output" ;;
esac
`,
  );
  environment.TEST_RELEASE_FIXTURE = fixture;
}

describe.skipIf(process.platform === "win32")("offline installation journey", () => {
  test("resolves latest, verifies the checksum, and installs the ARM64 AppImage", () => {
    const fixture = temporaryDirectory("oneharness-ui-release-fixture-");
    const asset = "oneharness-ui-v1.2.3-linux-aarch64.AppImage";
    const contents = writeReleaseFixture(fixture, asset);
    const environment = installerEnvironment("Linux", "aarch64", {
      ONEHARNESS_UI_RELEASE_BASE_URL: "https://release.invalid/v1.2.3",
    });
    addOfflineCurl(environment, fixture);
    const installDirectory = temporaryDirectory("oneharness-ui-install-destination-");

    const result = runInstaller(["--to", installDirectory], environment);

    expect(result.exitCode).toBe(0);
    const installed = join(installDirectory, "oneharness-ui");
    expect(readFileSync(installed, "utf8")).toBe(contents);
    expect(statSync(installed).mode & 0o111).not.toBe(0);
    expect(result.stderr.toString()).toContain("resolving the latest oneharness UI release");
    expect(result.stderr.toString()).toContain("verifying the SHA-256 checksum");
    expect(result.stderr.toString()).toContain(`installed oneharness UI v1.2.3 to ${installed}`);
  });

  test("refuses a corrupted release without replacing the destination", () => {
    const fixture = temporaryDirectory("oneharness-ui-release-fixture-");
    const asset = "oneharness-ui-v1.2.3-linux-aarch64.AppImage";
    writeReleaseFixture(fixture, asset, false);
    const environment = installerEnvironment("Linux", "aarch64", {
      ONEHARNESS_UI_RELEASE_BASE_URL: "https://release.invalid/v1.2.3",
    });
    addOfflineCurl(environment, fixture);
    const installDirectory = temporaryDirectory("oneharness-ui-install-destination-");

    const result = runInstaller(["--version", "v1.2.3", "--to", installDirectory], environment);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("checksum mismatch");
    expect(result.stderr.toString()).toContain("refusing to install");
    expect(
      statSync(join(installDirectory, "oneharness-ui"), { throwIfNoEntry: false }),
    ).toBeUndefined();
  });
});
