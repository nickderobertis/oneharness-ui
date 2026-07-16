import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repository = resolve(import.meta.dir, "../../../..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const cli = resolve(repository, `.cache/upstream-target/debug/oneharness${executableSuffix}`);
const provider = resolve(
  repository,
  `.cache/upstream-target/debug/oneharness-mock-harness${executableSuffix}`,
);

type SeedOptions = {
  exit?: number;
  name: string;
  prompt: string;
  stderr?: string;
  stdout: string;
};

type CliReport = { history_file?: unknown };

async function seed(
  historyDir: string,
  providerPath: string,
  options: SeedOptions,
): Promise<string> {
  const child = Bun.spawn(
    [
      cli,
      "run",
      "--harness",
      "claude-code",
      "--prompt",
      options.prompt,
      "--bin",
      `claude-code=${providerPath}`,
      "--events",
      "--history",
      "--history-dir",
      historyDir,
      "--history-name",
      options.name,
      "--bypass",
      "--compact",
      "--no-config",
    ],
    {
      cwd: repository,
      env: {
        ...process.env,
        MOCK_EXIT: String(options.exit ?? 0),
        MOCK_STDERR: options.stderr ?? "",
        MOCK_STDOUT: options.stdout,
      },
      stderr: "pipe",
      stdout: "pipe",
    },
  );
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0 && (options.exit ?? 0) === 0) {
    throw new Error(`fixture CLI exited ${exitCode}: ${stderr.trim()}`);
  }
  let report: CliReport;
  try {
    report = JSON.parse(stdout) as CliReport;
  } catch {
    throw new Error(`fixture CLI returned malformed JSON: ${stdout.slice(0, 200)}`);
  }
  if (typeof report.history_file !== "string") {
    throw new Error(`fixture CLI did not create history for ${options.name}`);
  }
  return report.history_file;
}

async function patchRecord(
  historyFile: string,
  changes: Readonly<Record<string, unknown>>,
): Promise<void> {
  const lines = (await readFile(historyFile, "utf8")).trim().split("\n");
  const first = lines[0];
  if (!first) throw new Error(`fixture history is empty: ${historyFile}`);
  const record = JSON.parse(first) as Record<string, unknown>;
  await writeFile(historyFile, `${JSON.stringify({ ...record, ...changes })}\n`);
}

export type DesktopFixture = {
  cleanup: () => Promise<void>;
  environment: {
    MOCK_ARGV_FILE: string;
    MOCK_EXIT: string;
    MOCK_STDERR: string;
    MOCK_STDOUT: string;
    ONEHARNESS_NO_CONFIG: string;
    ONEHARNESS_UI_E2E_PROVIDER_ARGV: string;
    ONEHARNESS_UI_HISTORY_DIR: string;
    ONEHARNESS_UI_PROVIDER_BIN: string;
    ONEHARNESS_UI_PROVIDER_HARNESS: string;
  };
};

export async function createDesktopFixture(providerPath = provider): Promise<DesktopFixture> {
  for (const [label, path] of [
    ["pinned oneharness CLI", cli],
    ["deterministic provider", providerPath],
  ] as const) {
    if (!existsSync(path)) {
      throw new Error(`${label} is missing at ${path}; run just bootstrap`);
    }
  }

  const root = await mkdtemp(resolve(tmpdir(), "oneharness-ui-desktop-e2e-"));
  const historyDir = resolve(root, "history");
  const providerArgv = resolve(root, "provider-argv.txt");
  try {
    await seed(historyDir, providerPath, {
      name: "plain-session",
      prompt: "Answer without optional thinking",
      stdout: '{"result":"A concise answer","session_id":"native-plain-session"}',
    });

    const stopped = await seed(historyDir, providerPath, {
      name: "stopped-tool-session",
      prompt: "Inspect the native desktop boundary",
      stdout: [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool-1","name":"Bash","input":{"command":"pwd"}}]}}',
        '{"type":"result","result":"The native boundary was inspected","session_id":"native-stopped-session","usage":{"input_tokens":0,"output_tokens":6}}',
      ].join("\n"),
    });
    await patchRecord(stopped, {
      exit_code: null,
      status: "timeout",
      thinking: "I checked the native command boundary before answering.",
    });

    await seed(historyDir, providerPath, {
      exit: 1,
      name: "recoverable-failure",
      prompt: "This provider attempt should fail",
      stderr: "rate limit exceeded",
      stdout: '{"result":"","session_id":"native-failed-session"}',
    });

    return {
      cleanup: async () => await rm(root, { force: true, recursive: true }),
      environment: {
        MOCK_ARGV_FILE: providerArgv,
        MOCK_EXIT: "0",
        MOCK_STDERR: "",
        MOCK_STDOUT:
          '{"result":"Native continuation succeeded","session_id":"native-continued-session"}',
        ONEHARNESS_NO_CONFIG: "1",
        ONEHARNESS_UI_E2E_PROVIDER_ARGV: providerArgv,
        ONEHARNESS_UI_HISTORY_DIR: historyDir,
        ONEHARNESS_UI_PROVIDER_BIN: providerPath,
        ONEHARNESS_UI_PROVIDER_HARNESS: "claude-code",
      },
    };
  } catch (error) {
    await rm(root, { force: true, recursive: true });
    throw error;
  }
}
