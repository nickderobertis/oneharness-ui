#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const version = process.env.RELEASE_VERSION;
if (!version || !semver.test(version)) {
  throw new Error(
    "RELEASE_VERSION must be the semantic-release output; set it to the released version and rerun 'just publish-ui'",
  );
}
if (!process.env.NODE_AUTH_TOKEN) {
  throw new Error(
    "NODE_AUTH_TOKEN is missing; configure the NPM_TOKEN repository secret, then rerun 'just publish-ui'",
  );
}

const root = resolve(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "packages/ui/package.json"), "utf8"));
if (manifest.version !== version) {
  throw new Error(
    `@oneharness/ui manifest version ${manifest.version} does not match released version ${version}; rerun semantic-release before publishing`,
  );
}

const publish = Bun.spawnSync(
  ["npm", "publish", "packages/ui", "--access", "public", "--provenance"],
  {
    cwd: root,
    stderr: "pipe",
    stdout: "pipe",
  },
);
if (publish.exitCode !== 0) {
  process.stdout.write(publish.stdout);
  process.stderr.write(publish.stderr);
  process.stderr.write(
    "npm package publish: verify provenance, package version, and NPM_TOKEN access, then rerun 'just publish-ui'\n",
  );
  process.exit(publish.exitCode);
}
