#!/usr/bin/env bun
//! Test-only oneharness stand-in for a CLI one release ahead of the packaged
//! SDK, whose `history show` records carry fields this SDK's schema does not
//! name. The lookup itself is forwarded to the packaged CLI, and so is every
//! other subcommand, so the SDK, its schemas, and the history store stay real.
//! Only the patch that makes each shown record look like a newer contract is
//! applied here, because the packaged CLI re-serialises through its own schema
//! and drops anything the file carries beyond it.
import { boundedArgv, runPackagedCli } from "./forwarding-cli.ts";
import { FUTURE_RECORD_LOOKUP_ENV, FUTURE_RECORD_PATCH_ENV } from "./future-record-contract.ts";

const MAX_ENV_BYTES = 16_384;

function boundedEnv(name: string): string {
  const raw = process.env[name] ?? "";
  if (raw.length === 0 || Buffer.byteLength(raw) > MAX_ENV_BYTES) {
    throw new Error(`${name} must be bounded, non-empty JSON`);
  }
  return raw;
}

// Which call carries the records to patch is the SDK's to say: the test passes
// the argv the SDK's `CAPABILITIES` manifest renders the lookup from, so a
// release that renames the lookup subcommand moves this stand-in with it. It
// arrives over the environment so that a call this stand-in only forwards
// never loads the SDK (see forwarding-cli.ts). The bridge runs history
// discovery under its allowlisted CLI environment, which never carries it; a
// call without it is therefore always one this stand-in only forwards.
function lookupArgv(): unknown[] | undefined {
  if (process.env[FUTURE_RECORD_LOOKUP_ENV] === undefined) return undefined;
  const parsed: unknown = JSON.parse(boundedEnv(FUTURE_RECORD_LOOKUP_ENV));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`${FUTURE_RECORD_LOOKUP_ENV} must be the SDK's lookup argv`);
  }
  return parsed;
}

async function writePatchedShowOutput(argv: readonly string[]): Promise<number> {
  const shown = runPackagedCli(argv, true);
  if (shown.status !== 0) return shown.status ?? 1;
  const [{ HistoryRecordsSchema }, { z }] = await Promise.all([
    import("@oneharness/sdk"),
    import("zod"),
  ]);
  // The patch arrives as JSON so one fixture covers both a key the SDK does
  // not know and a future value in a key it does.
  const patch = z
    .record(z.string().min(1).max(128), z.unknown())
    .parse(JSON.parse(boundedEnv(FUTURE_RECORD_PATCH_ENV)));
  const records = HistoryRecordsSchema.parse(JSON.parse(shown.stdout));
  process.stdout.write(`${JSON.stringify(records.map((record) => ({ ...record, ...patch })))}\n`);
  return 0;
}

const argv = boundedArgv();
const lookup = lookupArgv();
process.exitCode = lookup?.every((word, index) => argv[index] === word)
  ? await writePatchedShowOutput(argv)
  : (runPackagedCli(argv, false).status ?? 1);
