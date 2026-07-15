#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const directory = resolve(process.argv[2] ?? "");
const output = resolve(process.argv[3] ?? "checksums.txt");
if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error(`bundle directory does not exist: ${directory}`);
}
const files = [...new Bun.Glob("**/*").scanSync({ cwd: directory, onlyFiles: true })].sort();
if (files.length === 0) throw new Error(`no bundle artifacts found under ${directory}`);
const lines = files.map((relative) => {
  const digest = createHash("sha256")
    .update(readFileSync(resolve(directory, relative)))
    .digest("hex");
  return `${digest}  ${basename(relative)}`;
});
writeFileSync(output, `${lines.join("\n")}\n`);
