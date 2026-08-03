import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  HistoryLineSchema,
  type HistoryRecord,
  HistoryRecordSchema,
  OneHarness,
} from "@oneharness/sdk";
import type { BridgeStreamFrame } from "@oneharness-ui/ipc-contract";
import { BridgeService } from "../src/service.ts";
import { readFixtureHistoryRecord } from "./history-fixture.ts";

const repository = resolve(import.meta.dir, "../../..");
const cliOverride = process.env.ONEHARNESS_UI_TEST_CLI_BIN;
const providerOverride = process.env.ONEHARNESS_UI_TEST_PROVIDER_BIN;
for (const [name, value] of [
  ["ONEHARNESS_UI_TEST_CLI_BIN", cliOverride],
  ["ONEHARNESS_UI_TEST_PROVIDER_BIN", providerOverride],
] as const) {
  if (
    value !== undefined &&
    (value.length === 0 || value.length > 4096 || !isAbsolute(value) || !existsSync(value))
  ) {
    throw new Error(`${name} must be an existing absolute executable path`);
  }
}
const provider =
  providerOverride ??
  resolve(
    repository,
    `target/oneharness-ui-test/oneharness-mock-harness${process.platform === "win32" ? ".exe" : ""}`,
  );
const recordedWatch = resolve(import.meta.dir, "fixtures/recorded-history-watch.ts");
const recording = resolve(import.meta.dir, "fixtures/history-watch-stream-v1.ndjson");
const TEST_AUTHORIZATION = "oneharness-ui-watch-authorization-value";
const EXISTING_RUN = "019fc600-0000-7000-8000-000000000001";
const STREAMED_RUN = "019fc600-0000-7000-8000-000000000002";
const WATCH_ENVIRONMENT = ["ONEHARNESS_UI_TEST_WATCH_RECORDING", "ONEHARNESS_UI_TEST_WATCH_EXIT"];

let historyDir = "";
const originalEnvironment = new Map<string, string | undefined>();

beforeEach(async () => {
  historyDir = await mkdtemp(resolve(tmpdir(), "oneharness-ui-watch-"));
  for (const key of [...WATCH_ENVIRONMENT, "ONEHARNESS_HISTORY_LABELS"]) {
    originalEnvironment.set(key, process.env[key]);
  }
  delete process.env.ONEHARNESS_HISTORY_LABELS;
});

afterEach(async () => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  originalEnvironment.clear();
  await rm(historyDir, { force: true, recursive: true });
});

function historyLines(record: HistoryRecord): string {
  const { events, ...run } = record;
  const lines = (events ?? []).map((event) =>
    HistoryLineSchema.parse({
      event,
      harness: record.harness,
      run_id: record.history_id,
      schema_version: "1.0",
      type: "event",
    }),
  );
  lines.push(HistoryLineSchema.parse({ ...run, type: "run" }));
  return lines.map((line) => JSON.stringify(line)).join("\n");
}

/// Build a real history session on disk from a real fixture run, so the watch
/// resolves its starting turns through the packaged CLI's own lookup.
async function seedSession(
  session: string,
  records: ReadonlyArray<Partial<HistoryRecord> & { history_id: string }>,
): Promise<void> {
  const report = await new OneHarness(cliOverride ? { executable: cliOverride } : {}).run({
    bins: { "claude-code": provider },
    env: {
      MOCK_EXIT: "0",
      MOCK_STDERR: "",
      MOCK_STDOUT: '{"type":"result","result":"Template answer","session_id":"native-template"}',
      ONEHARNESS_HISTORY_LABELS: "{}",
    },
    events: true,
    harnesses: ["claude-code"],
    history: true,
    historyDir,
    historyName: "template",
    mode: "bypass",
    prompt: "Seed the watched session",
  });
  const { historyFile, record } = await readFixtureHistoryRecord(historyDir, report);
  const written = records.map((overrides, index) =>
    HistoryRecordSchema.parse({
      ...record,
      session,
      timestamp: `2026-08-01T00:00:0${index}Z`,
      ...overrides,
    }),
  );
  await writeFile(
    resolve(dirname(historyFile), `${session}.jsonl`),
    `${written.map(historyLines).join("\n")}\n`,
  );
}

function service(executable = cliOverride): BridgeService {
  return new BridgeService(
    {
      ...(executable ? { executable } : {}),
      historyDir,
      providerBin: provider,
      providerHarness: "claude-code",
    },
    TEST_AUTHORIZATION,
  );
}

async function collect(
  stream: AsyncGenerator<BridgeStreamFrame>,
  limit = 20,
): Promise<BridgeStreamFrame[]> {
  const frames: BridgeStreamFrame[] = [];
  for await (const frame of stream) {
    frames.push(frame);
    if (frames.length >= limit) break;
  }
  return frames;
}

function cursorId(index: number): string {
  return `019fc5ff-0000-7000-8000-${index.toString(16).padStart(12, "0")}`;
}

describe("BridgeService watch across the SDK history stream boundary", () => {
  test("opens at the session's last record and replays turns after a resume cursor", async () => {
    await seedSession("resumable-session", [
      { history_id: cursorId(0), prompt: "First question" },
      { history_id: cursorId(1), prompt: "Second question" },
      { history_id: cursorId(2), prompt: "Third question" },
    ]);

    const opened = await collect(
      service().watch({ kind: "watch", sessionId: "resumable-session" }, TEST_AUTHORIZATION),
      1,
    );
    expect(opened[0]).toEqual({
      cursor: cursorId(2),
      kind: "opened",
      sessionId: "resumable-session",
      totalTurnCount: 3,
    });

    // The packaged CLI resumes strictly after the cursor, so only the turns the
    // caller has not seen arrive — with the indexes the paged view already used.
    const resumed = await collect(
      service().watch(
        { after: cursorId(0), kind: "watch", sessionId: "resumable-session" },
        TEST_AUTHORIZATION,
      ),
      3,
    );
    expect(resumed[0]).toMatchObject({ cursor: cursorId(0), kind: "opened", totalTurnCount: 3 });
    expect(resumed.slice(1)).toMatchObject([
      { cursor: cursorId(1), kind: "turn", turn: { id: "resumable-session-1" } },
      { cursor: cursorId(2), kind: "turn", turn: { id: "resumable-session-2" } },
    ]);
    expect(resumed.flatMap((frame) => (frame.kind === "turn" ? [frame.turn.user] : []))).toEqual([
      "Second question",
      "Third question",
    ]);
  }, 60_000);

  test("joins recorded event lines to the watched session by run id", async () => {
    await seedSession("live-session", [{ history_id: EXISTING_RUN, prompt: "Start the work" }]);
    process.env.ONEHARNESS_UI_TEST_WATCH_RECORDING = recording;

    const frames = await collect(
      service(recordedWatch).watch(
        { kind: "watch", sessionId: "live-session" },
        TEST_AUTHORIZATION,
      ),
    );

    expect(frames[0]).toMatchObject({ cursor: EXISTING_RUN, kind: "opened", totalTurnCount: 1 });
    // A run already known to belong to this session streams straight through;
    // the run that is still open waits for the record that names its session.
    expect(frames[1]).toEqual({
      kind: "tool-event",
      tool: { index: 1, input: { command: "pwd" }, kind: "tool_call", name: "Bash", output: null },
      turnId: "live-session-0",
    });
    expect(frames[2]).toMatchObject({
      cursor: STREAMED_RUN,
      kind: "turn",
      turn: {
        assistant: "Streamed answer",
        id: "live-session-1",
        tools: [{ input: { pattern: "redirect" }, name: "Grep" }],
        usage: { inputTokens: 11, outputTokens: 7 },
        user: "Keep going",
      },
    });
    expect(frames[3]).toEqual({
      kind: "tool-event",
      tool: { index: 1, input: null, kind: "tool_result", name: null, output: "3 matches" },
      turnId: "live-session-1",
    });
    // A different session's record and its buffered events never reach this
    // conversation.
    expect(frames).toHaveLength(4);
    expect(JSON.stringify(frames)).not.toContain("/elsewhere/secret.txt");
  }, 60_000);

  test("forwards the resume cursor to the history stream", async () => {
    await seedSession("live-session", [{ history_id: EXISTING_RUN, prompt: "Start the work" }]);
    process.env.ONEHARNESS_UI_TEST_WATCH_RECORDING = recording;

    const frames = await collect(
      service(recordedWatch).watch(
        { after: STREAMED_RUN, kind: "watch", sessionId: "live-session" },
        TEST_AUTHORIZATION,
      ),
    );

    expect(frames[0]).toMatchObject({ cursor: STREAMED_RUN, kind: "opened" });
    expect(frames.slice(1)).toEqual([]);
  }, 60_000);

  test("reports a stream that fails after opening", async () => {
    await seedSession("live-session", [{ history_id: EXISTING_RUN, prompt: "Start the work" }]);
    process.env.ONEHARNESS_UI_TEST_WATCH_RECORDING = recording;
    process.env.ONEHARNESS_UI_TEST_WATCH_EXIT = "3";

    const frames = await collect(
      service(recordedWatch).watch(
        { kind: "watch", sessionId: "live-session" },
        TEST_AUTHORIZATION,
      ),
    );

    expect(frames[0]).toMatchObject({ kind: "opened" });
    expect(frames.at(-1)).toMatchObject({ error: { code: "ONEHARNESS_ERROR" }, kind: "error" });
  }, 60_000);

  test("refuses unauthorized, non-watch, and unknown-session streams", async () => {
    expect(
      await collect(
        service().watch(
          { kind: "watch", sessionId: "any-session" },
          "wrong-authorization-value-00",
        ),
      ),
    ).toEqual([
      {
        error: { code: "UNAUTHORIZED", message: "Local bridge authorization failed." },
        kind: "error",
      },
    ]);
    expect(await collect(service().watch({ kind: "list" }, TEST_AUTHORIZATION))).toMatchObject([
      { error: { code: "INVALID_REQUEST" }, kind: "error" },
    ]);
    expect(
      await collect(service().watch({ kind: "watch", sessionId: "missing" }, TEST_AUTHORIZATION)),
    ).toMatchObject([{ kind: "error" }]);
    expect(
      await service().handle({ kind: "watch", sessionId: "any-session" }, TEST_AUTHORIZATION),
    ).toEqual({
      error: { code: "INVALID_REQUEST", message: "The local bridge request is invalid." },
      ok: false,
    });
  }, 60_000);

  test("stops the stream when the caller aborts", async () => {
    await seedSession("live-session", [{ history_id: EXISTING_RUN, prompt: "Start the work" }]);
    process.env.ONEHARNESS_UI_TEST_WATCH_RECORDING = recording;
    const controller = new AbortController();

    const frames: BridgeStreamFrame[] = [];
    for await (const frame of service(recordedWatch).watch(
      { kind: "watch", sessionId: "live-session" },
      TEST_AUTHORIZATION,
      controller.signal,
    )) {
      frames.push(frame);
      controller.abort();
    }

    expect(frames).toMatchObject([{ kind: "opened" }]);
  }, 60_000);
});
