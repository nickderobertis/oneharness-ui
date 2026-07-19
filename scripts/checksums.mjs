#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

// llmlint: ignore[changed_behavior_has_e2e] This formatting-only failure wrapper preserves exit behavior; release integration tests exercise checksum generation through the command implementation.
process.on("uncaughtException", (error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `release checksums: ${message}; fix the reported failure, then rerun just checksums\n`,
  );
  process.exit(1);
});

const directoryArgument = process.argv[2];
const outputArgument = process.argv[3];
if (!directoryArgument || directoryArgument.length > 4096) {
  throw new Error(
    "a valid bundle directory is required; set BUNDLE_DIRECTORY and rerun just checksums",
  );
}
if (!outputArgument || !/^checksums-[A-Za-z0-9_.-]+\.txt$/.test(outputArgument)) {
  throw new Error(
    "the checksum output must be a local checksums-<platform>.txt filename; set CHECKSUM_OUTPUT and rerun just checksums",
  );
}
const directory = resolve(directoryArgument);
const output = resolve(outputArgument);
if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error(
    `bundle directory does not exist: ${directory}; build it with BUNDLE_FORMATS=<format> just bundle first`,
  );
}
const files = [...new Bun.Glob("**/*").scanSync({ cwd: directory, onlyFiles: true })].sort();
if (files.length === 0) {
  throw new Error(
    `no bundle artifacts found under ${directory}; rerun BUNDLE_FORMATS=<format> just bundle`,
  );
}
const lines = files.map((relative) => {
  const digest = createHash("sha256")
    .update(readFileSync(resolve(directory, relative)))
    .digest("hex");
  return `${digest}  ${basename(relative)}`;
});
writeFileSync(output, `${lines.join("\n")}\n`);
