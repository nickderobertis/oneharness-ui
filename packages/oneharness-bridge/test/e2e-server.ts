import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { OneHarness } from "@oneharness/sdk";
import { z } from "zod";
import { startWebServer } from "../src/server.ts";
import { e2eWebPort } from "./e2e-configuration.ts";
import { readFixtureHistoryRecord } from "./history-fixture.ts";

const repository = resolve(import.meta.dir, "../../..");
const webAccessToken = z
  .string()
  .min(32)
  .max(256)
  .parse(process.env.ONEHARNESS_UI_TEST_WEB_ACCESS_TOKEN);
const cliOverride = process.env.ONEHARNESS_UI_TEST_CLI_BIN;
if (
  cliOverride !== undefined &&
  (cliOverride.length === 0 ||
    cliOverride.length > 4096 ||
    !isAbsolute(cliOverride) ||
    !existsSync(cliOverride))
) {
  throw new Error("ONEHARNESS_UI_TEST_CLI_BIN must be an existing absolute executable path");
}
const historyDir = resolve(repository, ".cache/e2e-history");
const provider = resolve(
  repository,
  `target/oneharness-ui-test/oneharness-mock-harness${process.platform === "win32" ? ".exe" : ""}`,
);

if (cliOverride) process.env.ONEHARNESS_BIN = cliOverride;
await rm(historyDir, { force: true, recursive: true });
await mkdir(historyDir, { recursive: true });
const sdk = new OneHarness();

async function seed({
  exit = 0,
  name,
  prompt,
  stderr = "",
  stdout,
}: {
  exit?: number;
  name: string;
  prompt: string;
  stderr?: string;
  stdout: string;
}) {
  return await sdk.run({
    bins: { "claude-code": provider },
    env: { MOCK_EXIT: String(exit), MOCK_STDERR: stderr, MOCK_STDOUT: stdout },
    events: true,
    harnesses: ["claude-code"],
    history: true,
    historyDir,
    historyName: name,
    mode: "bypass",
    prompt,
  });
}

const tools = await seed({
  name: "tool-session",
  prompt: "Inspect the tool boundary",
  stdout: [
    '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"pwd"}}]}}',
    '{"type":"result","result":"Tool inspection complete","session_id":"e2e-native-tool","usage":{"input_tokens":0,"output_tokens":5}}',
  ].join("\n"),
});
const { historyFile: toolsHistoryFile, record: toolRecord } = await readFixtureHistoryRecord(
  historyDir,
  tools,
);
toolRecord.reasoning = "I checked the command boundary first.";
await writeFile(toolsHistoryFile, `${JSON.stringify(toolRecord)}\n`);

await seed({
  name: "plain-session",
  prompt: "Answer without reasoning",
  stdout: '{"result":"A concise answer","session_id":"e2e-native-plain"}',
});
await seed({
  name: "ineligible-session",
  prompt: "This provider omitted its session handle",
  stdout: '{"result":"No continuation handle"}',
});
await seed({
  exit: 1,
  name: "failed-session",
  prompt: "The provider will fail",
  stderr: "rate limit exceeded",
  stdout: '{"result":"","session_id":"e2e-native-failure"}',
});

process.env.ONEHARNESS_UI_HISTORY_DIR = historyDir;
process.env.ONEHARNESS_UI_PROVIDER_BIN = provider;
process.env.ONEHARNESS_UI_PROVIDER_HARNESS = "claude-code";
process.env.MOCK_EXIT = "0";
process.env.MOCK_STDERR = "";
process.env.MOCK_STDOUT =
  '{"result":"Continued from the exact desktop session","session_id":"e2e-native-continued"}';
await startWebServer({
  accessToken: webAccessToken,
  port: e2eWebPort,
  staticDirectory: resolve(repository, "apps/conversation-ui/out"),
});
