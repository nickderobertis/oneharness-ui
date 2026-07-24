import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const versions = readFileSync(resolve(root, "scripts/visual-docs-versions.env"), "utf8");
const workflow = readFileSync(resolve(root, ".github/workflows/visual-docs.yml"), "utf8");
const setup = readFileSync(resolve(root, "scripts/setup-screencomp.sh"), "utf8");
const screencompConfig = readFileSync(resolve(root, "screencomp.toml"), "utf8");
const themeSource = readFileSync(
  resolve(root, "apps/conversation-ui/src/components/theme.ts"),
  "utf8",
);
const verifyScript = readFileSync(resolve(root, "scripts/verify-visual.sh"), "utf8");
const packageManifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  packageManager: string;
};

describe("visual docs command contracts", () => {
  test("keeps workflow tool pins aligned with local capture", () => {
    const screencomp = versions.match(/SCREENCOMP_VERSION=([^\n]+)/)?.[1];
    const image = versions.match(/VISUAL_PLAYWRIGHT_IMAGE=([^\n]+)/)?.[1];
    expect(screencomp).toBe("v0.4.2");
    expect(image).toBe("mcr.microsoft.com/playwright:v1.61.1-noble");
    expect(workflow).toContain(`screencomp-version: ${screencomp}`);
    expect(workflow).toContain(`container: ${image}`);
  });

  test("keeps the capture paths and container platform on the configured architecture", () => {
    const captureScript = readFileSync(resolve(root, "capture.sh"), "utf8");
    const captureTest = readFileSync(
      resolve(root, "apps/conversation-ui/tests/visual/conversations.visual.ts"),
      "utf8",
    );
    expect(screencompConfig).toContain('arches = ["x86_64"]');
    expect(verifyScript).toContain('PLATFORM="linux/amd64"');
    expect(verifyScript).toContain("SHOTS_OUT=$output/x86_64");
    for (const tree of ["current", "verify"]) {
      expect(captureScript).toContain(`/shots/${tree}/x86_64`);
      expect(captureTest).toContain(`/shots/${tree}/x86_64`);
    }
  });

  test("keeps gallery theme values aligned with captured application themes", () => {
    const applicationThemes = JSON.parse(
      themeSource.match(/themes = (\[[^\]]+\])/)?.[1] ?? "null",
    ) as string[] | null;
    const galleryThemes = JSON.parse(
      screencompConfig.match(/key = "theme"\s+label = "Theme"\s+values = (\[[^\]]+\])/)?.[1] ??
        "null",
    ) as string[] | null;
    expect(galleryThemes).toEqual(applicationThemes?.filter((theme) => theme !== "system"));
  });

  test("keeps the capture runtime on the workspace Bun pin", () => {
    expect(packageManifest.packageManager).toBe("bun@1.3.14");
    expect(readFileSync(resolve(root, "capture.sh"), "utf8")).toContain(
      `npm install --global ${packageManifest.packageManager}`,
    );
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

  test("runs every capture stage and identifies each failed operation", () => {
    const directory = mkdtempSync(join(tmpdir(), "visual-capture-test-"));
    const bin = join(directory, "bin");
    mkdirSync(bin);
    const log = join(directory, "commands.log");
    for (const command of ["npm", "bun"]) {
      const executable = join(bin, command);
      writeFileSync(
        executable,
        `#!/bin/sh\nprintf '%s %s\\n' '${command}' "$*" >> "$TEST_COMMAND_LOG"\nactual='${command} '"$*"\n[ "$TEST_FAIL_COMMAND" != "$actual" ]\n`,
      );
      chmodSync(executable, 0o755);
    }
    const node = join(bin, "node");
    writeFileSync(node, "#!/bin/sh\nprintf '%064d' 0\n");
    chmodSync(node, 0o755);
    const baseEnvironment = {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      TEST_COMMAND_LOG: log,
      TEST_FAIL_COMMAND: "",
    };
    const success = Bun.spawnSync(["bash", "capture.sh"], { cwd: root, env: baseEnvironment });
    expect(success.exitCode).toBe(0);
    expect(readFileSync(log, "utf8")).toContain("playwright test");

    const failure = Bun.spawnSync(["bash", "capture.sh"], {
      cwd: root,
      env: {
        ...baseEnvironment,
        TEST_FAIL_COMMAND: "bun install --frozen-lockfile --ignore-scripts",
      },
    });
    expect(failure.exitCode).toBe(1);
    expect(failure.stderr.toString()).toContain("visual capture: workspace install: failed");
  });

  test("reports verification failures from the screencomp boundary", () => {
    const directory = mkdtempSync(join(tmpdir(), "visual-verify-test-"));
    const bin = join(directory, "bin");
    mkdirSync(bin);
    for (const command of ["test-docker", "test-screencomp"]) {
      const executable = join(bin, command);
      writeFileSync(executable, `#!/bin/sh\n[ "$TEST_FAIL_SUBCOMMAND" != "$1" ]\n`);
      chmodSync(executable, 0o755);
    }
    const environment = {
      ...process.env,
      ONEHARNESS_VISUAL_DOCKER_COMMAND: "test-docker",
      ONEHARNESS_VISUAL_SCREENCOMP_COMMAND: "test-screencomp",
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      TEST_FAIL_SUBCOMMAND: "verify",
    };
    const result = Bun.spawnSync(["bash", "scripts/verify-visual.sh"], {
      cwd: root,
      env: environment,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("captures are not reproducible");
  });
});
