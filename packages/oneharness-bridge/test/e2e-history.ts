import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OneHarness } from "@oneharness/sdk";
import { e2eProject } from "./e2e-configuration.ts";

// Resolved from the module URL rather than a Bun-only global: the e2e web
// server loads this under Bun and the browser journeys load it under the
// Playwright runner.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const e2eHistoryDir = resolve(repository, ".cache/e2e-history");
export const e2eProviderBin = resolve(
  repository,
  `target/oneharness-ui-test/oneharness-mock-harness${process.platform === "win32" ? ".exe" : ""}`,
);

/// Replace the fixture history with the recorded baseline every journey reads.
/// Continuing a conversation appends a record, so a suite that runs more than
/// once against one server — as the browser target does, once per engine —
/// reseeds before its first journey instead of inheriting the previous run.
export async function seedE2eHistory({
  cwd = e2eProject,
  provider = e2eProviderBin,
  settleMs = 0,
}: {
  cwd?: string;
  provider?: string;
  settleMs?: number;
} = {}): Promise<void> {
  await mkdir(cwd, { recursive: true });
  await rm(e2eHistoryDir, { force: true, recursive: true });
  await mkdir(e2eHistoryDir, { recursive: true });
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
    const result = await sdk.run({
      bins: { "claude-code": provider },
      env: { MOCK_EXIT: String(exit), MOCK_STDERR: stderr, MOCK_STDOUT: stdout },
      events: true,
      harnesses: ["claude-code"],
      history: true,
      historyDir: e2eHistoryDir,
      historyName: name,
      mode: "bypass",
      prompt,
      cwd,
    });
    // The visual journeys need each record to land in its own second so the
    // captured history list keeps a stable order.
    if (settleMs > 0) await new Promise((wake) => setTimeout(wake, settleMs));
    return result;
  }

  await seed({
    name: "tool-session",
    prompt: "Inspect the tool boundary",
    stdout: [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"pwd"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"/workspace/product"}]}}',
      '{"type":"result","result":"Tool inspection complete","session_id":"e2e-native-tool","usage":{"input_tokens":0,"output_tokens":5}}',
    ].join("\n"),
  });
  await seed({
    name: "plain-session",
    prompt: "Answer without reasoning",
    stdout: '{"result":"A concise answer","session_id":"e2e-native-plain"}',
  });
  await seed({
    name: "markdown-session",
    prompt:
      "Render **safely** <img src=x onerror=alert('unsafe')><script>globalThis.injected=true</script>",
    stdout: JSON.stringify({
      result: "**Highlighted code**\n\n```ts\nconst answer = 42;\n```",
      session_id: "e2e-native-markdown",
    }),
  });
  await seed({
    name: "json-session",
    prompt: "Return structured data",
    stdout: JSON.stringify({
      result: '{"status":"ready","items":[1,2]}',
      session_id: "e2e-native-json",
    }),
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
}
