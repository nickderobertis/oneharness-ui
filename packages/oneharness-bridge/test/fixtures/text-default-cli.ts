#!/usr/bin/env bun
//! Test-only oneharness stand-in for a CLI whose `history list` defaults to
//! its human-readable text view, with JSON only behind `--format json`. That
//! request is forwarded to the packaged CLI; so is every other subcommand, so
//! the SDK, its schemas, and the history store stay real. Only the text view a
//! caller gets by omitting the flag is rendered here.
import { boundedArgv, runPackagedCli } from "./forwarding-cli.ts";

async function textView(argv: readonly string[]): Promise<number> {
  const listed = runPackagedCli([...argv, "--format", "json"], true);
  if (listed.status !== 0) return listed.status ?? 1;
  // Only this call needs the SDK's schema (see forwarding-cli.ts).
  const { HistoryListSchema } = await import("@oneharness/sdk");
  for (const session of HistoryListSchema.parse(JSON.parse(listed.stdout))) {
    process.stdout.write(`${session.id}  ${session.name}  ${session.started}\n`);
  }
  return 0;
}

const argv = boundedArgv();
process.exitCode =
  argv[0] === "history" && argv[1] === "list" && !argv.includes("--format")
    ? await textView(argv)
    : (runPackagedCli(argv, false).status ?? 1);
