#!/usr/bin/env node
// An llmlint override replaces a plugin rule's whole `files` block, so a local
// path exclusion has to restate the plugin's include globs. This gate resolves
// each overridden rule from its plugin alone and fails when the restated
// include list no longer matches, so an upstream scope change cannot leave the
// local copy stale. Overrides of rules the plugin leaves unscoped narrow them
// on purpose and are not compared.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const remedy = "then rerun just lint-llm-validate";
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const malformed = (what) =>
  new Error(`llmlint config printed ${what}; update llmlint with just setup-llmlint, ${remedy}`);

const resolveConfig = (args) => {
  const result = spawnSync("llmlint", ["config", ...args], { encoding: "utf8" });
  if (result.error !== undefined) {
    throw new Error(
      `could not run llmlint: ${result.error.message}; install it with just setup-llmlint, ${remedy}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `llmlint config ${args.join(" ")} failed: ${result.stderr.trim()}; fix llmlint.yml, ${remedy}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw malformed("output that is not JSON");
  }
  if (!isRecord(parsed) || !isRecord(parsed.config) || !Array.isArray(parsed.config.rules)) {
    throw malformed("no config.rules list");
  }
  return parsed;
};

const includeOf = (config, name) => {
  const rule = config.config.rules.find((entry) => isRecord(entry) && entry.name === name);
  if (rule === undefined) throw malformed(`no rule named ${JSON.stringify(name)}`);
  if (rule.files === null || rule.files === undefined) return [];
  const include = isRecord(rule.files) ? rule.files.include : undefined;
  if (!Array.isArray(include) || !include.every((glob) => typeof glob === "string")) {
    throw malformed(`a non-string files.include for ${JSON.stringify(name)}`);
  }
  return include;
};

const sameList = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const local = resolveConfig(["--sources"]);
if (!isRecord(local.sources) || !isRecord(local.sources.rules)) {
  throw malformed("no sources.rules map");
}
const restated = Object.entries(local.sources.rules).flatMap(([name, origin]) => {
  if (!isRecord(origin) || typeof origin.source !== "string") {
    throw malformed(`no source for rule ${JSON.stringify(name)}`);
  }
  if (origin.fields !== undefined && !isRecord(origin.fields)) {
    throw malformed(`non-object field sources for rule ${JSON.stringify(name)}`);
  }
  const filesSource = origin.fields?.files;
  if (filesSource !== undefined && typeof filesSource !== "string") {
    throw malformed(`a non-string files source for rule ${JSON.stringify(name)}`);
  }
  return filesSource !== undefined && filesSource !== origin.source
    ? [{ name, plugin: origin.source }]
    : [];
});

const scratch = mkdtempSync(join(tmpdir(), "oneharness-ui-llmlint-"));
try {
  const stale = [];
  for (const [index, { name, plugin }] of restated.entries()) {
    const pluginConfig = join(scratch, `plugin-${index}.yml`);
    writeFileSync(pluginConfig, `plugins:\n  - ${JSON.stringify(plugin)}\n`);
    const upstream = includeOf(resolveConfig(["-c", pluginConfig]), name);
    // A plugin rule with no include list is narrowed on purpose, not restated.
    if (upstream.length > 0 && !sameList(upstream, includeOf(local, name))) {
      stale.push(`${name}: plugin includes ${JSON.stringify(upstream)}`);
    }
  }
  if (stale.length > 0) {
    throw new Error(
      `llmlint.yml restates a plugin rule's files.include that no longer matches the plugin (${stale.join("; ")}); copy the plugin's include list into the override, ${remedy}`,
    );
  }
} finally {
  rmSync(scratch, { force: true, recursive: true });
}
