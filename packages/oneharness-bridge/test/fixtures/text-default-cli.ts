#!/usr/bin/env bun
//! Test-only oneharness stand-in for a CLI whose `history list` defaults to
//! its human-readable text view, with JSON only behind `--format json`. That
//! request is forwarded to the packaged CLI; so is every other subcommand, so
//! the SDK, its schemas, and the history store stay real. Only the text view a
//! caller gets by omitting the flag is rendered here.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { HistoryListSchema } from "@oneharness/sdk";
import { z } from "zod";

// The bridge and SDK pass a short argv of flags, ids, and paths; anything
// larger is not a call this stand-in was written for.
const argvSchema = z.array(z.string().min(1).max(4096)).max(64);

function packagedCli(argv: readonly string[], capture: boolean) {
  const sdkRequire = createRequire(import.meta.resolve("@oneharness/sdk"));
  const result = spawnSync(
    process.execPath,
    [sdkRequire.resolve("oneharness-cli/bin/oneharness.js"), ...argv],
    {
      encoding: "utf8",
      shell: false,
      stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  return result;
}

function textView(argv: readonly string[]): number {
  const listed = packagedCli([...argv, "--format", "json"], true);
  if (listed.status !== 0) return listed.status ?? 1;
  for (const session of HistoryListSchema.parse(JSON.parse(listed.stdout))) {
    process.stdout.write(`${session.id}  ${session.name}  ${session.started}\n`);
  }
  return 0;
}

const argv = argvSchema.parse(process.argv.slice(2));
process.exitCode =
  argv[0] === "history" && argv[1] === "list" && !argv.includes("--format")
    ? textView(argv)
    : (packagedCli(argv, false).status ?? 1);
