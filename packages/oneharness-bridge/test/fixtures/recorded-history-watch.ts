#!/usr/bin/env bun
//! Test-only oneharness stand-in that replays a recorded `history watch`
//! stream. Every other subcommand is forwarded verbatim to the packaged CLI,
//! so the SDK, its schemas, and the history lookup stay real; only the
//! continuous stream — which no completed fixture run can produce — is
//! replayed from recorded NDJSON lines.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import { HistoryStreamEnvelopeSchema } from "@oneharness/sdk";
import { historyCursorSchema } from "@oneharness-ui/ipc-contract";
import { z } from "zod";

const MAX_RECORDING_BYTES = 1024 * 1024;
const stderrSchema = z.string().max(16_384);

function recordingPath(): string {
  const path = process.env.ONEHARNESS_UI_TEST_WATCH_RECORDING ?? "";
  if (!isAbsolute(path) || path.length > 4096) {
    throw new Error("ONEHARNESS_UI_TEST_WATCH_RECORDING must be an absolute recording path");
  }
  return path;
}

function replayExitCode(): number {
  const value = process.env.ONEHARNESS_UI_TEST_WATCH_EXIT ?? "0";
  const code = Number(value);
  if (!Number.isInteger(code) || code < 0 || code > 255) {
    throw new Error("ONEHARNESS_UI_TEST_WATCH_EXIT must be an exit code between 0 and 255");
  }
  return code;
}

function resumeCursor(argv: readonly string[]): string | undefined {
  const flag = argv.indexOf("--after");
  if (flag < 0) return undefined;
  const cursor = argv[flag + 1];
  if (cursor === undefined) throw new Error("--after was passed without a cursor");
  return historyCursorSchema.parse(cursor);
}

function replay(argv: readonly string[]): number {
  const recording = readFileSync(recordingPath(), "utf8");
  if (Buffer.byteLength(recording) > MAX_RECORDING_BYTES) {
    throw new Error("the recorded history watch stream exceeds the fixture limit");
  }
  const envelopes = recording
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => HistoryStreamEnvelopeSchema.parse(JSON.parse(line)));
  const cursor = resumeCursor(argv);
  // oneharness resumes strictly after the named record, so the replay drops
  // every line up to and including it.
  const resumed = envelopes.findIndex(
    (envelope) => envelope.type === "record" && envelope.record.history_id === cursor,
  );
  for (const envelope of cursor !== undefined && resumed >= 0
    ? envelopes.slice(resumed + 1)
    : envelopes) {
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
  }
  const stderr = stderrSchema.parse(process.env.ONEHARNESS_UI_TEST_WATCH_STDERR ?? "");
  if (stderr) process.stderr.write(stderr);
  return replayExitCode();
}

function forward(argv: readonly string[]): number {
  const sdkRequire = createRequire(import.meta.resolve("@oneharness/sdk"));
  const result = spawnSync(
    process.execPath,
    [sdkRequire.resolve("oneharness-cli/bin/oneharness.js"), ...argv],
    { shell: false, stdio: "inherit", windowsHide: true },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const argv = process.argv.slice(2);
process.exitCode = argv[0] === "history" && argv[1] === "watch" ? replay(argv) : forward(argv);
