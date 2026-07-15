import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { OneHarness, type RunReport } from "@oneharness/sdk";
import { BridgeService } from "../src/service.ts";

const repository = resolve(import.meta.dir, "../../..");
const provider =
  process.env.ONEHARNESS_UI_TEST_PROVIDER_BIN ??
  resolve(
    repository,
    `.cache/upstream-target/debug/oneharness-mock-harness${process.platform === "win32" ? ".exe" : ""}`,
  );
const executable = resolve(
  repository,
  `.cache/upstream-target/debug/oneharness${process.platform === "win32" ? ".exe" : ""}`,
);
const TEST_AUTHORIZATION = "oneharness-ui-integration-authorization";

let historyDir = "";
const originalMockEnvironment = new Map<string, string | undefined>();
const mockKeys = ["MOCK_EXIT", "MOCK_STDERR", "MOCK_STDOUT"];

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
  return await new OneHarness({ executable }).run({
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
}

function service(): BridgeService {
  return new BridgeService(
    {
      executable,
      historyDir,
      providerBin: provider,
      providerHarness: "claude-code",
    },
    TEST_AUTHORIZATION,
  );
}

describe("BridgeService across SDK, CLI, provider, and history boundaries", () => {
  test("rejects callers without the local authorization capability", async () => {
    const result = await service().handle({ kind: "list" }, "incorrect-authorization-value-0000");
    expect(result).toEqual({
      error: { code: "UNAUTHORIZED", message: "Local bridge authorization failed." },
      ok: false,
    });
  });

  test("discovers, selects, and safely preserves optional detail", async () => {
    const report = await seed(
      "tool-session",
      [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"pwd"}}]}}',
        '{"type":"result","result":"Repository inspected","session_id":"native-1","usage":{"input_tokens":0,"output_tokens":4}}',
      ].join("\n"),
    );
    const historyFile = report.history_file;
    if (!historyFile) throw new Error("seed run did not write history");
    const record = JSON.parse(await readFile(historyFile, "utf8")) as Record<string, unknown>;
    record.thinking = "Checked the project shape before answering.";
    record.future_payload = { preserved: true };
    await writeFile(historyFile, `${JSON.stringify(record)}\n`);

    const listed = await service().handle({ kind: "list" }, TEST_AUTHORIZATION);
    expect(listed.ok && listed.data.kind === "list" && listed.data.conversations).toHaveLength(1);
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

  test("continues the exact native session and returns the new history selection", async () => {
    await seed("continue-me", '{"result":"First answer","session_id":"native-continue-1"}');
    process.env.MOCK_STDOUT = '{"result":"Continued answer","session_id":"native-continue-1"}';
    process.env.MOCK_EXIT = "0";
    const listed = await service().handle({ kind: "list" }, TEST_AUTHORIZATION);
    const firstId =
      listed.ok && listed.data.kind === "list" ? listed.data.conversations[0]?.id : "";
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
    const malformed = await service().handle({ kind: "list" }, TEST_AUTHORIZATION);
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
        executable,
        historyDir: fileInsteadOfDirectory,
      },
      TEST_AUTHORIZATION,
    ).handle({ kind: "list" }, TEST_AUTHORIZATION);
    expect(storage.ok).toBe(false);
    if (!storage.ok) expect(storage.error.detail).toContain("not-a-directory");
  });
});
