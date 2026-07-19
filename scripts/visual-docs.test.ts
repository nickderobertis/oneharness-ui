import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const versions = readFileSync(resolve(root, "scripts/visual-docs-versions.sh"), "utf8");
const workflow = readFileSync(resolve(root, ".github/workflows/visual-docs.yml"), "utf8");
const setup = readFileSync(resolve(root, "scripts/setup-screencomp.sh"), "utf8");

describe("visual docs command contracts", () => {
  test("keeps workflow tool pins aligned with local capture", () => {
    const screencomp = versions.match(/SCREENCOMP_VERSION="([^"]+)"/)?.[1];
    const image = versions.match(/VISUAL_PLAYWRIGHT_IMAGE="([^"]+)"/)?.[1];
    expect(screencomp).toBe("v0.4.2");
    expect(image).toBe("mcr.microsoft.com/playwright:v1.61.1-noble");
    expect(workflow).toContain(`screencomp-version: ${screencomp}`);
    expect(workflow).toContain(`container: ${image}`);
  });

  test("pins and verifies the downloaded installer before execution", () => {
    expect(setup).toContain("INSTALLER_SHA256=");
    expect(setup.indexOf('actual_sha256="')).toBeLessThan(setup.indexOf('sh "$installer"'));
    expect(setup).toContain("screencomp/" + "$" + "{SCREENCOMP_VERSION}/scripts/install.sh");
  });

  test("rejects capture output outside the ignored screencomp trees", () => {
    const result = Bun.spawnSync(["bash", "capture.sh"], {
      cwd: root,
      env: { ...process.env, SHOTS_OUT: "/tmp/untrusted-visual-output" },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain(
      "SHOTS_OUT must select the current or verify x86_64 shot directory",
    );
  });

  test("reports a concrete remedy when the container runtime is missing", () => {
    const result = Bun.spawnSync(["bash", "scripts/verify-visual.sh"], {
      cwd: root,
      env: { ...process.env, ONEHARNESS_VISUAL_DOCKER_COMMAND: "missing-docker-for-test" },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Docker is required");
  });

  test("rejects an installer whose pinned checksum does not match", () => {
    const directory = mkdtempSync(join(tmpdir(), "screencomp-setup-test-"));
    const bin = join(directory, "bin");
    mkdirSync(bin);
    const curl = join(bin, "curl");
    writeFileSync(
      curl,
      '#!/bin/sh\nwhile [ "$1" != "-o" ]; do shift; done\nprintf tampered > "$2"\n',
    );
    chmodSync(curl, 0o755);
    const result = Bun.spawnSync(["bash", "scripts/setup-screencomp.sh"], {
      cwd: root,
      env: { ...process.env, HOME: directory, PATH: `${bin}${delimiter}${process.env.PATH}` },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("installer checksum mismatch");
  });
});
