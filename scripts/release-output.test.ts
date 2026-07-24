import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseOutputs, writeReleaseOutputs } from "./release-output.mjs";

describe("version workflow release handoff", () => {
  test("a no-release push does not authorize npm publication", () => {
    expect(releaseOutputs()).toEqual({ released: "false" });
    expect(() => releaseOutputs("not-semver")).toThrow(
      "pass semantic-release's nextRelease.version",
    );
    expect(() => writeReleaseOutputs(undefined)).toThrow("GITHUB_OUTPUT is missing");
  });

  test("a release push passes the exact semantic-release version", () => {
    const directory = mkdtempSync(join(tmpdir(), "oneharness-release-output-"));
    const output = join(directory, "github-output");

    writeReleaseOutputs(output);
    writeReleaseOutputs(output, "0.7.0");

    expect(readFileSync(output, "utf8")).toBe("released=false\nreleased=true\nversion=0.7.0\n");
  });

  test("the workflow condition and semantic success hook use the handoff", () => {
    const workflow = readFileSync(".github/workflows/version.yml", "utf8");
    const releaseConfig = readFileSync(".releaserc.json", "utf8");

    expect(workflow).toContain("if: steps.release.outputs.released == 'true'");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("just init-release-output");
    expect(workflow).toContain("RELEASE_VERSION: $" + "{{ steps.release.outputs.version }}");
    expect(releaseConfig).toContain(
      "just record-release-output '" + "$" + "{nextRelease.version}'",
    );
  });
});
