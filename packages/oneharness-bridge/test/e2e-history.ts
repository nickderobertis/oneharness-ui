import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HistoryRecordSchema, OneHarness, type RunOptions, type RunReport } from "@oneharness/sdk";
import { e2eProject } from "./e2e-configuration.ts";
import { type HeldRun, readFixtureHistoryRecord, startHeldRun } from "./history-fixture.ts";

// Resolved from the module URL rather than a Bun-only global: the e2e web
// server loads this under Bun and the browser journeys load it under the
// Playwright runner.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const e2eHistoryDir = resolve(repository, ".cache/e2e-history");
// The seeded records and the server's continuations run through one harness.
export const e2eProviderHarness = "claude-code";
export const e2eProviderBin = resolve(
  repository,
  `target/oneharness-ui-test/oneharness-mock-harness${process.platform === "win32" ? ".exe" : ""}`,
);

/// Replace the fixture history with the recorded baseline every journey reads.
/// Continuing a conversation appends a record, so a suite that runs more than
/// once against one server — as the browser target does, once per engine —
/// reseeds before its first journey instead of inheriting the previous run.
///
/// `recordedFrom` re-times each seeded run to start one minute after the one
/// before it, from that instant, with fixed durations and tool times, so
/// screenshots of the timeline do not depend on when or how fast it ran.
export async function seedE2eHistory({
  cwd = e2eProject,
  provider = e2eProviderBin,
  recordedFrom,
  settleMs = 0,
}: {
  cwd?: string;
  provider?: string;
  recordedFrom?: string;
  settleMs?: number;
} = {}): Promise<void> {
  await mkdir(cwd, { recursive: true });
  await rm(e2eHistoryDir, { force: true, recursive: true });
  await mkdir(e2eHistoryDir, { recursive: true });
  const sdk = new OneHarness();
  let seeded = 0;

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
      bins: { [e2eProviderHarness]: provider },
      // llmlint: ignore[contracts_have_one_source_or_a_drift_gate] oneharness-mock-harness.rs owns these keys, and the journeys assert its recorded output, so a renamed key fails them.
      env: { MOCK_EXIT: String(exit), MOCK_STDERR: stderr, MOCK_STDOUT: stdout },
      events: true,
      harnesses: [e2eProviderHarness],
      history: true,
      historyDir: e2eHistoryDir,
      historyName: name,
      mode: "bypass",
      prompt,
      cwd,
    });
    if (recordedFrom !== undefined) {
      await retimeRecordedRun(result, Date.parse(recordedFrom) + seeded * 60_000, seededDurationMs);
    }
    seeded += 1;
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

function providerRun(name: string, prompt: string, env: Record<string, string>): RunOptions {
  return {
    bins: { [e2eProviderHarness]: e2eProviderBin },
    cwd: e2eProject,
    env: { MOCK_EXIT: "0", MOCK_STDERR: "", ...env },
    events: true,
    harnesses: [e2eProviderHarness],
    history: true,
    historyDir: e2eHistoryDir,
    historyName: name,
    mode: "bypass",
    prompt,
  };
}

/// Record a finished run whose agent wrote to the user and reasoned between
/// its tool calls: text at event 0, 4 and 7, reasoning at 3, and tool calls
/// with their results at 1–2 and 5–6. A journey adds it on its own so the
/// shared baseline, which the visual captures also read, stays as it is.
export async function seedNarratedE2eSession(): Promise<void> {
  await new OneHarness().run(
    providerRun("narrated-session", "Narrate the inspection", {
      MOCK_STDOUT: [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"I will look at the **workspace** first."}]}}',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"pwd"}}]}}',
        '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"/workspace/product"}]}}',
        '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"Check what the directory holds before answering."}]}}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Now I will list what it holds."}]}}',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t2","name":"Read","input":{"file_path":"README.md"}}]}}',
        '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t2","content":"# Product"}]}}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"The workspace holds the product README."}]}}',
        '{"type":"result","result":"Narrated inspection complete","session_id":"e2e-native-narrated"}',
      ].join("\n"),
    }),
  );
}

/** How long every re-timed seeded run lasts; its tool calls run in its second half. */
const seededDurationMs = 4_000;

/// Rewrite a recorded run so it starts at `startedAt` and lasts `durationMs`,
/// and give each timed tool event a fixed slot inside it, as a run recorded at
/// that moment would have. Every other byte stays the CLI's own.
async function retimeRecordedRun(
  report: RunReport,
  startedAt: number,
  durationMs: number,
): Promise<void> {
  const fixture = await readFixtureHistoryRecord(e2eHistoryDir, report);
  const instant = (offsetMs: number) => new Date(startedAt + offsetMs).toISOString();
  const events = fixture.record.events?.map((event) =>
    event.started_at
      ? {
          ...event,
          duration_ms: 300,
          finished_at: instant(durationMs / 2 + 300),
          started_at: instant(durationMs / 2),
        }
      : event,
  );
  await writeFile(
    fixture.historyFile,
    `${fixture.historyLines(
      HistoryRecordSchema.parse({
        ...fixture.record,
        ...(events ? { events } : {}),
        duration_ms: durationMs,
        timestamp: instant(0).replace(/\.\d{3}Z$/, "Z"),
      }),
    )}\n`,
  );
}

/// Record a finished run, then re-time it to start at `startedAt` and last
/// `durationMs`, as a run that long would have recorded it. A test cannot wait
/// out a five-hour run.
export async function seedTimedE2eSession({
  durationMs,
  name,
  startedAt,
}: {
  durationMs: number;
  name: string;
  startedAt: string;
}): Promise<void> {
  const report = await new OneHarness().run(
    providerRun(name, "Work for the whole span", {
      MOCK_STDOUT: `{"result":"Finished the ${name} run","session_id":"e2e-native-timed"}`,
    }),
  );
  await retimeRecordedRun(report, Date.parse(startedAt), durationMs);
}

/// Start a real streamed run whose provider holds after its first events, so
/// the session is on disk with those events but no closing record until the
/// journey calls `release`, which then waits for the run to finish.
export async function startInFlightE2eSession(): Promise<HeldRun> {
  return await startHeldRun(providerRun("live-session", "Inspect while I watch", {}), {
    after: [
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"/workspace/product"}]}}',
      '{"type":"result","result":"Live inspection finished","session_id":"e2e-native-live"}',
    ],
    before: [
      '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"Plan the inspection."}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Inspecting the workspace now."}]}}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"pwd"}}]}}',
    ],
  });
}
