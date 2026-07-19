#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

process.on("uncaughtException", (error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${message}; reconcile the named restatement with its canonical source, then rerun just lint\n`,
  );
  process.exit(1);
});

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const fail = (message) => {
  // llmlint: ignore[changed_behavior_has_e2e] This is the failure assertion inside a static integration gate: just lint drives it over the real manifests, schemas, SDK, bridge, Rust source, and workflows; deliberately corrupting those production inputs in an automated test would duplicate this assertion rather than exercise a user journey.
  throw new Error(`contract drift: ${message}`);
};
const capture = (source, pattern, description) => {
  const value = source.match(pattern)?.[1];
  if (value === undefined) fail(`could not read ${description}`);
  return value;
};
const assertEqual = (actual, expected, description) => {
  if (actual !== expected) fail(`${description} is ${actual}; expected ${expected}`);
};
const assertRestatements = (source, pattern, expected, description) => {
  const values = [...source.matchAll(pattern)].map((match) => match[1]);
  if (values.length === 0) fail(`could not find ${description}`);
  const unexpected = values.find((value) => value !== expected);
  if (unexpected !== undefined) fail(`${description} contains ${unexpected}; expected ${expected}`);
};

const bridgePackage = JSON.parse(read("packages/oneharness-bridge/package.json"));
const desktopPackage = JSON.parse(read("apps/desktop-shell/package.json"));
const sdkVersion = bridgePackage.dependencies?.["@oneharness/sdk"];
if (typeof sdkVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(sdkVersion)) {
  fail("packages/oneharness-bridge/package.json must pin an exact @oneharness/sdk version");
}
assertEqual(
  desktopPackage.devDependencies?.["@oneharness/sdk"],
  sdkVersion,
  "desktop @oneharness/sdk version",
);
assertRestatements(
  read("scripts/build-sidecar.mjs"),
  /@oneharness\/sdk (\d+\.\d+\.\d+)/g,
  sdkVersion,
  "build-sidecar SDK versions",
);
assertEqual(
  capture(
    read("scripts/build-compatible-cli.sh"),
    /readonly UPSTREAM_VERSION="(\d+\.\d+\.\d+)"/,
    "source-build upstream version",
  ),
  sdkVersion,
  "source-build upstream version",
);

const contract = read("packages/ipc-contract/src/index.ts");
const service = read("packages/oneharness-bridge/src/service.ts");
const sdk = await import(
  pathToFileURL(
    resolve(root, "packages/oneharness-bridge/node_modules/@oneharness/sdk/dist/index.js"),
  ).href
);
const knownRecordKeysSource = capture(
  service,
  /const knownRecordKeys = new Set\(\[([\s\S]*?)\]\);/,
  "known history-record keys",
);
const knownRecordKeys = [...knownRecordKeysSource.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
const expectedRecordKeys = [
  ...Object.keys(sdk.HistoryRecordSchema.shape),
  "reasoning",
  "thinking",
].sort();
assertEqual(
  JSON.stringify(knownRecordKeys.toSorted()),
  JSON.stringify(expectedRecordKeys),
  "SDK and legacy history-record keys",
);
const listLimit = capture(
  contract,
  /conversations: z\.array\(conversationSummarySchema\)\.max\((\d+)\)/,
  "conversation-list schema maximum",
);
const turnLimit = capture(
  contract,
  /turns: z\.array\(conversationTurnSchema\)\.max\((\d+)\)/,
  "conversation-turn schema maximum",
);
assertEqual(
  capture(service, /CONVERSATION_LIST_PAGE_SIZE = (\d+)/, "conversation-list page size"),
  listLimit,
  "conversation-list page size",
);
assertEqual(
  capture(service, /CONVERSATION_TURN_PAGE_SIZE = (\d+)/, "conversation-turn page size"),
  turnLimit,
  "conversation-turn page size",
);

const requestLimitPattern = /(?:const MAX_REQUEST_BYTES(?:: usize)? = )(\d+ \* \d+)/;
const requestLimits = [
  "packages/oneharness-bridge/src/cli.ts",
  "packages/oneharness-bridge/src/server.ts",
  "apps/desktop-shell/src/runtime.rs",
].map((path) => capture(read(path), requestLimitPattern, `${path} request limit`));
for (const limit of requestLimits.slice(1)) {
  assertEqual(limit, requestLimits[0], "bridge request byte limit");
}

const toolVersions = Object.fromEntries(
  read(".tool-versions")
    .trim()
    .split("\n")
    .map((line) => line.split(/\s+/, 2)),
);
const workflows = [
  ".github/workflows/check.yml",
  ".github/workflows/desktop-e2e.yml",
  ".github/workflows/llmlint.yml",
  ".github/workflows/release.yml",
  ".github/workflows/version.yml",
];
for (const path of workflows) {
  const workflow = read(path);
  assertRestatements(
    workflow,
    /node-version: ([^\s]+)/g,
    toolVersions.nodejs,
    `${path} Node versions`,
  );
  assertRestatements(workflow, /bun-version: ([^\s]+)/g, toolVersions.bun, `${path} Bun versions`);
  assertRestatements(workflow, /^\s+version: ([^\s]+)$/gm, toolVersions.uv, `${path} uv versions`);
  assertRestatements(
    workflow,
    /cargo install just --locked --version ([^\s]+)/g,
    toolVersions.just,
    `${path} just versions`,
  );
}
