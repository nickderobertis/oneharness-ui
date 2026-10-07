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
const resolveConfig = (args) => {
  const result = spawnSync("llmlint", ["config", ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `llmlint config ${args.join(" ")} failed: ${result.stderr.trim()}; fix llmlint.yml, ${remedy}`,
    );
  }
  return JSON.parse(result.stdout);
};
const ruleNamed = (config, name) => config.config.rules.find((rule) => rule.name === name);
const sameList = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const local = resolveConfig(["--sources"]);
const restated = Object.entries(local.sources.rules).filter(
  ([, origin]) => origin.fields?.files !== undefined && origin.fields.files !== origin.source,
);
const scratch = mkdtempSync(join(tmpdir(), "oneharness-ui-llmlint-"));
try {
  const stale = [];
  for (const [name, origin] of restated) {
    const pluginConfig = join(scratch, `${name}.yml`);
    writeFileSync(pluginConfig, `plugins:\n  - ${JSON.stringify(origin.source)}\n`);
    const upstream = ruleNamed(resolveConfig(["-c", pluginConfig]), name)?.files?.include ?? [];
    const current = ruleNamed(local, name)?.files?.include ?? [];
    // A plugin rule with no include list is narrowed on purpose, not restated.
    if (upstream.length > 0 && !sameList(upstream, current)) {
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
