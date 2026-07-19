import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { HistoryRecordSchema, OneHarness, RunOptionsSchema, type RunReport } from "@oneharness/sdk";
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
const TEST_AUTHORIZATION = "oneharness-ui-integration-authorization";

let historyDir = "";
const originalMockEnvironment = new Map<string, string | undefined>();
const mockKeys = ["MOCK_EXIT", "MOCK_STDERR", "MOCK_STDOUT", "ONEHARNESS_NO_CONFIG"];

beforeEach(async () => {
  historyDir = await mkdtemp(resolve(tmpdir(), "oneharness-ui-bridge-"));
  for (const key of mockKeys) originalMockEnvironment.set(key, process.env[key]);
});

afterEach(async () => {
  for (const [key, value] of originalMockEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  originalMockEnvironment.clear();
  await rm(historyDir, { force: true, recursive: true });
});

async function seed(
  name: string,
  stdout: string,
  options: { exit?: number; prompt?: string; stderr?: string } = {},
): Promise<RunReport> {
  const report = await new OneHarness(cliOverride ? { executable: cliOverride } : {}).run({
    bins: { "claude-code": provider },
    env: {
      MOCK_EXIT: String(options.exit ?? 0),
      MOCK_STDERR: options.stderr ?? "",
      MOCK_STDOUT: stdout,
    },
    events: true,
    harnesses: ["claude-code"],
    history: true,
    historyDir,
    historyName: name,
    mode: "bypass",
    prompt: options.prompt ?? "Inspect the repository",
  });
  expect(report.oneharness_version).toBe("0.3.23");
  return report;
}

function service(): BridgeService {
  return new BridgeService(
    {
      ...(cliOverride ? { executable: cliOverride } : {}),
      historyDir,
      providerBin: provider,
      providerHarness: "claude-code",
    },
    TEST_AUTHORIZATION,
  );
}

describe("BridgeService across SDK, CLI, provider, and history boundaries", () => {
  test("uses the exact public SDK and its generated input/response schemas", async () => {
    const manifest = JSON.parse(
      await readFile(
        resolve(import.meta.dir, "../node_modules/@oneharness/sdk/package.json"),
        "utf8",
      ),
    ) as { dependencies?: Record<string, string>; version?: string };
    expect(manifest).toMatchObject({
      dependencies: { "oneharness-cli": "0.3.23" },
      version: "0.3.23",
    });
    expect(
      RunOptionsSchema.safeParse({ prompt: "Valid prompt", repositoryOwnedOption: true }).success,
    ).toBe(false);

    const report = await seed("schema-boundary", '{"result":"Validated","session_id":"sdk-1"}');
    const { record } = await readFixtureHistoryRecord(historyDir, report);
    expect(HistoryRecordSchema.safeParse({ ...record, status: "future-status" }).success).toBe(
      false,
    );
    const forwardCompatible = HistoryRecordSchema.parse({
      ...record,
      future_payload: { preserved: true },
    });
    expect(forwardCompatible.future_payload).toEqual({ preserved: true });

    await expect(
      readFixtureHistoryRecord(historyDir, { ...report, history_file: null }),
    ).rejects.toThrow("did not write history");
    const outside = resolve(historyDir, "..", `${basename(historyDir)}-outside.jsonl`);
    const multiple = resolve(historyDir, "multiple.jsonl");
    try {
      await writeFile(outside, `${JSON.stringify(record)}\n`);
      await expect(
        readFixtureHistoryRecord(historyDir, { ...report, history_file: outside }),
      ).rejects.toThrow("outside the isolated fixture directory");
      await writeFile(multiple, `${JSON.stringify(record)}\n${JSON.stringify(record)}\n`);
      await expect(
        readFixtureHistoryRecord(historyDir, { ...report, history_file: multiple }),
      ).rejects.toThrow("must contain one record");
    } finally {
      await rm(outside, { force: true });
    }
  });

  test("rejects callers without the local authorization capability", async () => {
    const result = await service().handle({ kind: "list" }, "incorrect-authorization-value-0000");
    expect(result).toEqual({
      error: { code: "UNAUTHORIZED", message: "Local bridge authorization failed." },
      ok: false,
    });
    const labelResult = await service().handle(
      { kind: "set-labels", labels: ["private"], sessionId: "session-1" },
      "incorrect-authorization-value-0000",
    );
    expect(labelResult).toEqual(result);
  });

  test("rejects invalid bridge input before touching history", async () => {
    const result = await service().handle({ kind: "unknown" }, TEST_AUTHORIZATION);
    expect(result).toEqual({
      error: { code: "INVALID_REQUEST", message: "The local bridge request is invalid." },
      ok: false,
    });
  });

  test("rejects oversized ambient discovery configuration", async () => {
    process.env.ONEHARNESS_NO_CONFIG = "x".repeat(32_769);
    const result = await service().handle({ kind: "list" }, TEST_AUTHORIZATION);
    expect(result).toMatchObject({ ok: false, error: { code: "ONEHARNESS_ERROR" } });
  });

  test("discovers, selects, and safely preserves optional detail", async () => {
    const report = await seed(
      "tool-session",
      [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"pwd"}}]}}',
        '{"type":"result","result":"Repository inspected","session_id":"native-1","usage":{"input_tokens":0,"output_tokens":4}}',
      ].join("\n"),
    );
    const { historyFile, record } = await readFixtureHistoryRecord(historyDir, report);
    record.thinking = "Checked the project shape before answering.";
    record.future_payload = { preserved: true };
    await writeFile(historyFile, `${JSON.stringify(record)}\n`);

    const listed = await service().handle({ kind: "list" }, TEST_AUTHORIZATION);
    expect(listed.ok && listed.data.kind === "list" && listed.data.conversations).toHaveLength(1);
    expect(listed).toMatchObject({
      data: { nextCursor: null, totalCount: 1 },
      ok: true,
    });
    const sessionId =
      listed.ok && listed.data.kind === "list" ? listed.data.conversations[0]?.id : "";
    const selected = await service().handle({ kind: "get", sessionId }, TEST_AUTHORIZATION);
    expect(
      selected.ok && selected.data.kind === "get" && selected.data.conversation.turns[0],
    ).toMatchObject({
      assistant: "Repository inspected",
      reasoning: "Checked the project shape before answering.",
      status: "completed",
      unknown: { future_payload: { preserved: true } },
      usage: { inputTokens: 0, outputTokens: 4 },
    });
    expect(
      selected.ok && selected.data.kind === "get"
        ? selected.data.conversation.turns[0]?.tools[0]?.name
        : undefined,
    ).toBe("Bash");
  });

  test("continues a stopped session and returns the new history selection", async () => {
    const report = await seed(
      "continue-me",
      '{"result":"First answer","session_id":"native-continue-1"}',
    );
    const { historyFile, record } = await readFixtureHistoryRecord(historyDir, report);
    await writeFile(
      historyFile,
      `${JSON.stringify({ ...record, exit_code: null, status: "timeout" })}\n`,
    );
    process.env.MOCK_STDOUT = '{"result":"Continued answer","session_id":"native-continue-1"}';
    process.env.MOCK_EXIT = "0";
    const listed = await service().handle({ kind: "list" }, TEST_AUTHORIZATION);
    const firstId =
      listed.ok && listed.data.kind === "list" ? listed.data.conversations[0]?.id : "";
    const selected = await service().handle(
      { kind: "get", sessionId: firstId },
      TEST_AUTHORIZATION,
    );
    expect(
      selected.ok && selected.data.kind === "get" ? selected.data.conversation : undefined,
    ).toMatchObject({ canContinue: true, state: "stopped" });
    const continued = await service().handle(
      {
        kind: "continue",
        message: "Now explain the smallest fix",
        sessionId: firstId,
      },
      TEST_AUTHORIZATION,
    );
    if (!continued.ok) throw new Error(JSON.stringify(continued.error));
    expect(continued.ok && continued.data.kind === "continue").toBe(true);
    if (!continued.ok || continued.data.kind !== "continue") return;
    expect(continued.data.selectedSessionId).not.toBe(firstId);
    expect(continued.data.conversation.turns[0]).toMatchObject({
      assistant: "Continued answer",
      user: "Now explain the smallest fix",
    });
  });

  test("rejects an ineligible conversation before provider execution", async () => {
    await seed("no-native-session", '{"result":"No resumable handle"}');
    const listed = await service().handle({ kind: "list" }, TEST_AUTHORIZATION);
    const id = listed.ok && listed.data.kind === "list" ? listed.data.conversations[0]?.id : "";
    const result = await service().handle(
      {
        kind: "continue",
        message: "Try anyway",
        sessionId: id,
      },
      TEST_AUTHORIZATION,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "ONEHARNESS_ERROR" } });
  });

  test("records provider failure and supports a subsequent recovered continuation", async () => {
    await seed("recoverable", '{"result":"Ready","session_id":"native-recovery"}');
    const listed = await service().handle({ kind: "list" }, TEST_AUTHORIZATION);
    const initial =
      listed.ok && listed.data.kind === "list" ? listed.data.conversations[0]?.id : "";

    process.env.MOCK_EXIT = "1";
    process.env.MOCK_STDERR = "rate limit exceeded";
    process.env.MOCK_STDOUT = '{"result":"","session_id":"native-recovery"}';
    const failed = await service().handle(
      {
        kind: "continue",
        message: "First retry",
        sessionId: initial,
      },
      TEST_AUTHORIZATION,
    );
    if (!failed.ok) throw new Error(JSON.stringify(failed.error));
    expect(failed.ok && failed.data.kind === "continue" && failed.data.conversation.state).toBe(
      "failed",
    );
    if (!failed.ok || failed.data.kind !== "continue") return;

    process.env.MOCK_EXIT = "0";
    process.env.MOCK_STDERR = "";
    process.env.MOCK_STDOUT = '{"result":"Recovered","session_id":"native-recovery"}';
    const recovered = await service().handle(
      {
        kind: "continue",
        message: "Retry after recovery",
        sessionId: failed.data.selectedSessionId,
      },
      TEST_AUTHORIZATION,
    );
    expect(
      recovered.ok && recovered.data.kind === "continue" && recovered.data.conversation,
    ).toMatchObject({
      state: "completed",
      turns: [{ assistant: "Recovered" }],
    });
  });

  test("surfaces an explicitly configured missing config path", async () => {
    await seed("config-check", '{"result":"Ready","session_id":"native-config"}');
    const listed = await service().handle({ kind: "list" }, TEST_AUTHORIZATION);
    const id = listed.ok && listed.data.kind === "list" ? listed.data.conversations[0]?.id : "";
    const previousConfig = process.env.ONEHARNESS_CONFIG;
    const missingConfigPath = resolve(historyDir, "missing-oneharness.toml");
    process.env.ONEHARNESS_CONFIG = missingConfigPath;
    const missingConfig = await service().handle(
      {
        kind: "continue",
        message: "Continue through the configured harness",
        sessionId: id,
      },
      TEST_AUTHORIZATION,
    );
    if (previousConfig === undefined) delete process.env.ONEHARNESS_CONFIG;
    else process.env.ONEHARNESS_CONFIG = previousConfig;
    expect(missingConfig).toMatchObject({ ok: false, error: { code: "CONFIG_ERROR" } });
    if (!missingConfig.ok) expect(missingConfig.error.detail).toContain(missingConfigPath);
  });

  test("surfaces malformed history and useful executable/storage errors", async () => {
    const malformedDirectory = resolve(historyDir, "project");
    await mkdir(malformedDirectory);
    await writeFile(
      resolve(malformedDirectory, "broken-session.jsonl"),
      '{"session":"broken-session","name":"Broken","timestamp":"2026-07-15T00:00:00Z"}\n',
    );
    const malformedList = await service().handle({ kind: "list" }, TEST_AUTHORIZATION);
    const malformedId =
      malformedList.ok && malformedList.data.kind === "list"
        ? malformedList.data.conversations[0]?.id
        : undefined;
    const malformed = await service().handle(
      { kind: "get", sessionId: malformedId ?? "" },
      TEST_AUTHORIZATION,
    );
    expect(malformed).toMatchObject({ ok: false, error: { code: "MALFORMED_HISTORY" } });

    const missingExecutable = await new BridgeService(
      {
        executable: resolve(historyDir, "missing-oneharness"),
        historyDir,
      },
      TEST_AUTHORIZATION,
    ).handle({ kind: "list" }, TEST_AUTHORIZATION);
    expect(missingExecutable).toMatchObject({ ok: false, error: { code: "EXECUTABLE_NOT_FOUND" } });

    const fileInsteadOfDirectory = resolve(historyDir, "not-a-directory");
    await writeFile(fileInsteadOfDirectory, "not a history directory");
    const storage = await new BridgeService(
      {
        ...(cliOverride ? { executable: cliOverride } : {}),
        historyDir: fileInsteadOfDirectory,
      },
      TEST_AUTHORIZATION,
    ).handle({ kind: "list" }, TEST_AUTHORIZATION);
    expect(storage.ok).toBe(false);
    if (!storage.ok) expect(storage.error.detail).toContain("not-a-directory");
  });

  test("pages SDK summaries without loading every conversation detail", async () => {
    const report = await seed(
      "page-template",
      '{"result":"Page template answer","session_id":"native-page-template"}',
      { prompt: "summary pages must not include this detail prompt" },
    );
    const { historyFile, record } = await readFixtureHistoryRecord(historyDir, report);
    await Promise.all(
      Array.from({ length: 26 }, async (_, index) => {
        const session = `page-session-${String(index).padStart(2, "0")}`;
        const copy = HistoryRecordSchema.parse({
          ...record,
          name: `page-${String(index).padStart(2, "0")}`,
          session,
        });
        await writeFile(
          resolve(dirname(historyFile), `${session}.jsonl`),
          `${JSON.stringify(copy)}\n`,
        );
      }),
    );

    const first = await service().handle({ kind: "list" }, TEST_AUTHORIZATION);
    if (!first.ok || first.data.kind !== "list") throw new Error(JSON.stringify(first));
    expect(first.data.conversations).toHaveLength(25);
    expect(first.data.totalCount).toBe(27);
    expect(first.data.nextCursor).not.toBeNull();
    expect(JSON.stringify(first)).not.toContain(
      "summary pages must not include this detail prompt",
    );

    const inserted = HistoryRecordSchema.parse({
      ...record,
      name: "inserted-after-first-page",
      session: "inserted-after-first-page",
      timestamp: "9999-12-31T23:59:59Z",
    });
    await writeFile(
      resolve(dirname(historyFile), "inserted-after-first-page.jsonl"),
      `${JSON.stringify(inserted)}\n`,
    );

    const second = await service().handle(
      { cursor: first.data.nextCursor ?? undefined, kind: "list" },
      TEST_AUTHORIZATION,
    );
    if (!second.ok || second.data.kind !== "list") throw new Error(JSON.stringify(second));
    expect(second.data).toMatchObject({ nextCursor: null, totalCount: 28 });
    expect(second.data.conversations).toHaveLength(2);
    expect(second.data.conversations.map(({ name }) => name)).not.toContain(
      "inserted-after-first-page",
    );

    const refreshed = await service().handle({ kind: "list" }, TEST_AUTHORIZATION);
    expect(
      refreshed.ok && refreshed.data.kind === "list"
        ? refreshed.data.conversations[0]?.name
        : undefined,
    ).toBe("inserted-after-first-page");

    const selected = await service().handle(
      { kind: "get", sessionId: second.data.conversations[0]?.id ?? "" },
      TEST_AUTHORIZATION,
    );
    expect(selected.ok && selected.data.kind === "get").toBe(true);
  });

  test("keeps each on-demand turn page under the response byte budget", async () => {
    const report = await seed(
      "large-conversation",
      '{"result":"Bounded detail answer","session_id":"native-large-conversation"}',
    );
    const { historyFile, record } = await readFixtureHistoryRecord(historyDir, report);
    const largePrompt = "bounded conversation detail ".repeat(6_500);
    const records = Array.from({ length: 5 }, (_, index) =>
      HistoryRecordSchema.parse({
        ...record,
        prompt: `${index}:${largePrompt}`,
        timestamp: `2026-07-17T00:00:0${index}Z`,
      }),
    );
    await writeFile(historyFile, `${records.map((item) => JSON.stringify(item)).join("\n")}\n`);

    const listed = await service().handle({ kind: "list" }, TEST_AUTHORIZATION);
    const id =
      listed.ok && listed.data.kind === "list"
        ? listed.data.conversations.find(({ name }) => name === "large-conversation")?.id
        : undefined;
    const first = await service().handle({ kind: "get", sessionId: id ?? "" }, TEST_AUTHORIZATION);
    if (!first.ok || first.data.kind !== "get") throw new Error(JSON.stringify(first));
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(512 * 1024);
    expect(first.data.conversation).toMatchObject({ totalTurnCount: 5 });
    expect(first.data.conversation.nextTurnOffset).not.toBeNull();

    const second = await service().handle(
      {
        kind: "get",
        sessionId: id ?? "",
        turnOffset: first.data.conversation.nextTurnOffset ?? undefined,
      },
      TEST_AUTHORIZATION,
    );
    expect(Buffer.byteLength(JSON.stringify(second))).toBeLessThan(512 * 1024);
    expect(second.ok && second.data.kind === "get").toBe(true);
  });
});
