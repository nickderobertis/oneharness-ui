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

  test("rejects an untrusted release origin before downloading", () => {
    const result = runInstaller(
      ["--version", "v1.2.3"],
      installerEnvironment("Linux", "aarch64", {
        ONEHARNESS_UI_RELEASE_BASE_URL: "https://release.invalid/v1.2.3",
      }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "release base URL must be https://github.com/nickderobertis/oneharness-ui/releases/download/v1.2.3",
    );
    expect(result.stderr.toString()).toContain("correct ONEHARNESS_UI_RELEASE_BASE_URL and retry");
  });
});

function writeReleaseFixture(
  directory: string,
  asset: string,
  validChecksum = true,
  validExtraction = true,
) {
  const extraction = validExtraction
    ? `mkdir -p squashfs-root
cat > squashfs-root/AppRun <<'APP_RUN'
#!/bin/sh
printf 'oneharness UI extracted fixture'
for argument in "$@"; do
  printf ' <%s>' "$argument"
done
printf '\\n'
APP_RUN
chmod 0755 squashfs-root/AppRun
`
    : `printf 'fixture extraction failed\\n' >&2
exit 17
`;
  const contents = `#!/bin/sh
if [ "\${1:-}" = "--appimage-extract" ]; then
  printf 'extract\\n' >> "$TEST_EXTRACTION_LOG"
  ${extraction}  exit 0
fi
printf 'oneharness UI AppImage fixture\\n'
`;
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
  test("installs a checksum-verified ARM64 command that reuses its no-FUSE extraction", () => {
    const fixture = temporaryDirectory("oneharness-ui-release-fixture-");
    const asset = "oneharness-ui-v1.2.3-linux-aarch64.AppImage";
    writeReleaseFixture(fixture, asset);
    const extractionLog = join(fixture, "extractions.log");
    const environment = installerEnvironment("Linux", "aarch64", {
      ONEHARNESS_UI_RELEASE_BASE_URL: `file://${fixture}`,
      TEST_EXTRACTION_LOG: extractionLog,
    });
    addOfflineCurl(environment, fixture);
    const installDirectory = temporaryDirectory("oneharness-ui-install-destination-");

    const result = runInstaller(["--to", installDirectory], environment);

    expect(result.exitCode).toBe(0);
    const installed = join(installDirectory, "oneharness-ui");
    expect(statSync(installed).mode & 0o111).not.toBe(0);
    expect(
      statSync(join(installDirectory, ".oneharness-ui", asset, "squashfs-root", "AppRun")).mode &
        0o111,
    ).not.toBe(0);

    for (const expectedArgument of ["first launch", "second launch"]) {
      const launched = Bun.spawnSync([installed, expectedArgument], {
        env: { ...environment, APPIMAGE_EXTRACT_AND_RUN: "1" },
      });
      expect(launched.exitCode).toBe(0);
      expect(launched.stdout.toString()).toBe(
        `oneharness UI extracted fixture <${expectedArgument}>\n`,
      );
      expect(launched.stderr.toString()).toBe("");
    }
    expect(readFileSync(extractionLog, "utf8")).toBe("extract\n");
    expect(result.stderr.toString()).toContain(`installed oneharness UI v1.2.3 to ${installed}`);
    expect(result.stderr.toString().trim().split("\n")).toHaveLength(1);
  });

  test("keeps the working no-FUSE command when replacement extraction fails", () => {
    const fixture = temporaryDirectory("oneharness-ui-release-fixture-");
    const asset = "oneharness-ui-v1.2.3-linux-aarch64.AppImage";
    const extractionLog = join(fixture, "extractions.log");
    writeReleaseFixture(fixture, asset);
    const environment = installerEnvironment("Linux", "aarch64", {
      ONEHARNESS_UI_RELEASE_BASE_URL: `file://${fixture}`,
      TEST_EXTRACTION_LOG: extractionLog,
    });
    addOfflineCurl(environment, fixture);
    const installDirectory = temporaryDirectory("oneharness-ui-install-destination-");
    const installed = join(installDirectory, "oneharness-ui");
    expect(
      runInstaller(["--version", "v1.2.3", "--to", installDirectory], environment).exitCode,
    ).toBe(0);

    writeReleaseFixture(fixture, asset, true, false);
    const replacement = runInstaller(
      ["--version", "v1.2.3", "--to", installDirectory],
      environment,
    );

    expect(replacement.exitCode).toBe(1);
    expect(replacement.stderr.toString()).toContain("could not extract the AppImage");
    const recovered = Bun.spawnSync([installed, "after failed update"], {
      env: { ...environment, APPIMAGE_EXTRACT_AND_RUN: "1" },
    });
    expect(recovered.exitCode).toBe(0);
    expect(recovered.stdout.toString()).toBe(
      "oneharness UI extracted fixture <after failed update>\n",
    );
  });

  test("refuses a corrupted release without replacing the destination", () => {
    const fixture = temporaryDirectory("oneharness-ui-release-fixture-");
    const asset = "oneharness-ui-v1.2.3-linux-aarch64.AppImage";
    writeReleaseFixture(fixture, asset, false);
    const environment = installerEnvironment("Linux", "aarch64", {
      ONEHARNESS_UI_RELEASE_BASE_URL: `file://${fixture}`,
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
