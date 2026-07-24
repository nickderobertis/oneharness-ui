#!/usr/bin/env node
import { appendFileSync } from "node:fs";

const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function releaseOutputs(version) {
  if (version === undefined) return { released: "false" };
  if (!semver.test(version)) {
    throw new Error(
      "release output version must be a valid semantic version; pass semantic-release's nextRelease.version and rerun the version workflow",
    );
  }
  return { released: "true", version };
}

export function writeReleaseOutputs(path, version) {
  if (!path) {
    throw new Error("GITHUB_OUTPUT is missing; run this command from the version workflow");
  }
  const outputs = releaseOutputs(version);
  appendFileSync(
    path,
    `${Object.entries(outputs)
      .map(([name, value]) => `${name}=${value}`)
      .join("\n")}\n`,
  );
}

if (import.meta.main) {
  writeReleaseOutputs(process.env.GITHUB_OUTPUT, process.argv[2]);
}
