#!/usr/bin/env bun
//! Test-only oneharness stand-in for a CLI one release ahead of the packaged
//! SDK, whose `history show` records carry fields this SDK's schema does not
//! name. The lookup itself is forwarded to the packaged CLI, and so is every
//! other subcommand, so the SDK, its schemas, and the history store stay real.
//! Only the patch that makes each shown record look like a newer contract is
//! applied here, because the packaged CLI re-serialises through its own schema
//! and drops anything the file carries beyond it.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { CAPABILITIES, HistoryRecordsSchema } from "@oneharness/sdk";
import { z } from "zod";
import { FUTURE_RECORD_PATCH_ENV } from "./future-record-contract.ts";

// Which call carries the records to patch is the SDK's to say: `CAPABILITIES`
// is the manifest the SDK itself renders this argv from, so a release that
// renames the lookup subcommand moves this stand-in with it rather than
// leaving it forwarding a call it no longer recognises.
const LOOKUP_ARGV = CAPABILITIES.history.argv;

// The bridge and SDK pass a short argv of flags, ids, and paths; anything
// larger is not a call this stand-in was written for.
const argvSchema = z.array(z.string().min(1).max(4096)).max(64);
// The patch arrives as JSON so one fixture covers both a key the SDK does not
// know and a future value in a key it does.
const patchSchema = z.record(z.string().min(1).max(128), z.unknown());
const MAX_PATCH_BYTES = 16_384;

function runPackagedCli(argv: readonly string[], capture: boolean) {
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

function recordPatch(): Record<string, unknown> {
  const raw = process.env[FUTURE_RECORD_PATCH_ENV] ?? "";
  if (raw.length === 0 || Buffer.byteLength(raw) > MAX_PATCH_BYTES) {
    throw new Error(`${FUTURE_RECORD_PATCH_ENV} must be a bounded JSON object of record fields`);
  }
  return patchSchema.parse(JSON.parse(raw));
}

function writePatchedShowOutput(argv: readonly string[]): number {
  const shown = runPackagedCli(argv, true);
  if (shown.status !== 0) return shown.status ?? 1;
  const records = HistoryRecordsSchema.parse(JSON.parse(shown.stdout));
  const patch = recordPatch();
  process.stdout.write(`${JSON.stringify(records.map((record) => ({ ...record, ...patch })))}\n`);
  return 0;
}

const argv = argvSchema.parse(process.argv.slice(2));
process.exitCode = LOOKUP_ARGV.every((word, index) => argv[index] === word)
  ? writePatchedShowOutput(argv)
  : (runPackagedCli(argv, false).status ?? 1);
