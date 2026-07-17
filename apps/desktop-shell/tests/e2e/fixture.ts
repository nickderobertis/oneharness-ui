import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { HistoryRecordSchema } from "@oneharness/sdk";

const repository = resolve(import.meta.dir, "../../../..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const platformPackages: Readonly<Record<string, string>> = {
  "darwin-arm64": "@oneharness/cli-darwin-arm64",
  "darwin-x64": "@oneharness/cli-darwin-x64",
  "linux-arm64": "@oneharness/cli-linux-arm64",
  "linux-x64": "@oneharness/cli-linux-x64",
  "win32-x64": "@oneharness/cli-win32-x64",
};
const platformPackage = platformPackages[`${process.platform}-${process.arch}`];
if (!platformPackage) throw new Error("the packaged oneharness CLI does not support this platform");
const sdkRequire = createRequire(
  resolve(
    realpathSync(resolve(repository, "packages/oneharness-bridge/node_modules/@oneharness/sdk")),
    "dist/index.js",
  ),
);
const cliRequire = createRequire(sdkRequire.resolve("oneharness-cli/bin/oneharness.js"));
export const packagedOneHarnessCli = resolve(
  dirname(cliRequire.resolve(`${platformPackage}/package.json`)),
  "bin",
  `oneharness${executableSuffix}`,
);
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
export const fixtureOneHarnessCli = cliOverride ?? packagedOneHarnessCli;
export const fixtureProvider = resolve(
  repository,
  `target/oneharness-ui-test/oneharness-mock-harness${executableSuffix}`,
);
const FIXTURE_ROOT_PREFIX = "oneharness-ui-desktop-e2e-";

type SeedOptions = {
  exit?: number;
  name: string;
  prompt: string;
  stderr?: string;
  stdout: string;
};

const OVERSIZED_HISTORY_SESSION_COUNT = 55;
const PAGINATED_TURN_COUNT = 45;
const LEGACY_BRIDGE_RESPONSE_LIMIT_BYTES = 4 * 1024 * 1024;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const INHERITED_ENVIRONMENT_KEYS = [
  "APPDATA",
  "AR",
  "CARGO_HOME",
  "CARGO_TARGET_DIR",
  "CC",
  "CFLAGS",
  "CI",
  "ComSpec",
  "CXX",
  "CXXFLAGS",
  "DBUS_SESSION_BUS_ADDRESS",
  "DISPLAY",
  "DYLD_LIBRARY_PATH",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "LD_LIBRARY_PATH",
  "LDFLAGS",
  "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "OS",
  "PATH",
  "PATHEXT",
  "Path",
  "PKG_CONFIG_PATH",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "RUSTFLAGS",
  "RUSTUP_HOME",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "USERPROFILE",
  "WAYLAND_DISPLAY",
  "WINDIR",
  "XAUTHORITY",
  "XDG_RUNTIME_DIR",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

export function deterministicDesktopEnvironment(
  overrides: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of INHERITED_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (typeof value === "string") environment[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "string") environment[key] = value;
  }
  return environment;
}

export async function validateFixtureHistoryFile(
  historyDir: string,
  input: unknown,
): Promise<string> {
  if (typeof input !== "string") {
    throw new Error("fixture CLI did not return a history file");
  }
  let historyRoot: string;
  let historyFile: string;
  try {
    [historyRoot, historyFile] = await Promise.all([realpath(historyDir), realpath(input)]);
  } catch {
    throw new Error("fixture CLI returned a history file that does not exist");
  }
  const localPath = relative(historyRoot, historyFile);
  if (
    !localPath ||
    localPath === ".." ||
    localPath.startsWith(`..${sep}`) ||
    isAbsolute(localPath)
  ) {
    throw new Error("fixture CLI returned a history file outside its isolated directory");
  }
  return historyFile;
}

async function seed(
  historyDir: string,
  providerPath: string,
  options: SeedOptions,
): Promise<string> {
  const child = Bun.spawn(
    [
      fixtureOneHarnessCli,
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
      env: deterministicDesktopEnvironment({
        MOCK_EXIT: String(options.exit ?? 0),
        MOCK_STDERR: options.stderr ?? "",
        MOCK_STDOUT: options.stdout,
      }),
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
  let report: unknown;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new Error(`fixture CLI returned malformed JSON: ${stdout.slice(0, 200)}`);
  }
  if (!isJsonObject(report)) {
    throw new Error(`fixture CLI did not create history for ${options.name}`);
  }
  return await validateFixtureHistoryFile(historyDir, report.history_file);
}

async function patchRecord(
  historyFile: string,
  changes: Readonly<Record<string, unknown>>,
): Promise<void> {
  const lines = (await readFile(historyFile, "utf8")).trim().split("\n");
  const first = lines[0];
  if (!first) throw new Error(`fixture history is empty: ${historyFile}`);
  const record: unknown = JSON.parse(first);
  if (!isJsonObject(record)) {
    throw new Error(`fixture history record is not an object: ${historyFile}`);
  }
  await writeFile(historyFile, `${JSON.stringify({ ...record, ...changes })}\n`);
}

async function readFirstHistoryRecord(historyFile: string) {
  const firstLine = (await readFile(historyFile, "utf8")).trim().split("\n")[0];
  if (!firstLine) throw new Error(`fixture history is empty: ${historyFile}`);
  return HistoryRecordSchema.parse(JSON.parse(firstLine));
}

async function seedOversizedHistory(
  historyFile: string,
): Promise<{ bytes: number; sessionIds: string[] }> {
  const template = await readFirstHistoryRecord(historyFile);
  const prompt = "Deterministic oversized native history prompt. ".repeat(2_100);
  const summaries: Array<Record<string, unknown>> = [];
  const sessionIds = Array.from(
    { length: OVERSIZED_HISTORY_SESSION_COUNT },
    (_, index) => `oversized-session-${String(index).padStart(2, "0")}`,
  );
  await Promise.all(
    sessionIds.map(async (session, index) => {
      const suffix = String(index).padStart(2, "0");
      const record = HistoryRecordSchema.parse({
        ...template,
        name: session,
        prompt,
        session,
        session_id: `native-oversized-${suffix}`,
      });
      summaries.push({
        canContinue: true,
        harnesses: [record.harness],
        id: session,
        name: session,
        preview: record.prompt,
        project: record.project,
        startedAt: record.timestamp,
        state: "completed",
        turnCount: 1,
      });
      await writeFile(
        resolve(dirname(historyFile), `${session}.jsonl`),
        `${JSON.stringify(record)}\n`,
      );
    }),
  );
  const bytes = Buffer.byteLength(
    JSON.stringify({ data: { conversations: summaries, kind: "list" }, ok: true }),
  );
  if (bytes <= LEGACY_BRIDGE_RESPONSE_LIMIT_BYTES) {
    throw new Error(`oversized fixture legacy response was only ${bytes} bytes`);
  }
  return { bytes, sessionIds };
}

async function seedPaginatedTurns(historyFile: string): Promise<string[]> {
  const template = await readFirstHistoryRecord(historyFile);
  const records = Array.from({ length: PAGINATED_TURN_COUNT }, (_, index) =>
    HistoryRecordSchema.parse({
      ...template,
      events: index === 0 ? template.events : [],
      prompt: `Native paginated prompt ${String(index).padStart(2, "0")}`,
      text:
        index === 0 ? template.text : `Native paginated answer ${String(index).padStart(2, "0")}`,
      thinking: index === 0 ? template.thinking : undefined,
    }),
  );
  await writeFile(historyFile, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  return records.map((record, index) => `${record.session}-${index}`);
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
    ONEHARNESS_UI_E2E_LEGACY_HISTORY_BYTES: string;
    ONEHARNESS_UI_E2E_SESSION_IDS: string;
    ONEHARNESS_UI_E2E_TURN_IDS: string;
    ONEHARNESS_UI_E2E_WEBVIEW2_USER_DATA_DIR: string;
    ONEHARNESS_UI_HISTORY_DIR: string;
    ONEHARNESS_UI_PROVIDER_BIN: string;
    ONEHARNESS_UI_PROVIDER_HARNESS: string;
    TAURI_WEBVIEW_AUTOMATION: string;
  };
  recordWebView2Diagnostics: (output: string) => Promise<void>;
};

export function resolveFixtureWebView2UserDataDirectory(
  root: string,
  platform: NodeJS.Platform,
  localAppData = process.env.LOCALAPPDATA,
): string {
  if (platform !== "win32") return resolve(root, "webview2-user-data");
  const fixtureName = basename(root);
  if (
    !localAppData ||
    !isAbsolute(localAppData) ||
    !fixtureName.startsWith(FIXTURE_ROOT_PREFIX) ||
    fixtureName.length === FIXTURE_ROOT_PREFIX.length
  ) {
    throw new Error("Windows desktop E2E requires an absolute LOCALAPPDATA fixture directory");
  }
  return resolve(localAppData, "main", fixtureName, "webview2-user-data");
}

export async function recordWebView2ProfileDiagnostics(
  userDataDirectory: string,
  output: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform !== "win32") {
    await writeFile(output, "PASS\tWebView2 profile diagnostics not applicable\n", { mode: 0o600 });
    return;
  }
  let entries: string[] = [];
  try {
    entries = await readdir(userDataDirectory, { recursive: true });
  } catch {
    // Report the absent directory through the bounded diagnostic below.
  }
  const profileReady = existsSync(resolve(dirname(userDataDirectory), "tauri-profile-ready"));
  const devToolsReady = entries.some((entry) => basename(entry) === "DevToolsActivePort");
  await writeFile(
    output,
    [
      `${profileReady ? "PASS" : "FAIL"}\tTauri accepted WebView2 profile argument`,
      `${devToolsReady ? "PASS" : "FAIL"}\tWebView2 created DevToolsActivePort`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
}

export async function createDesktopFixture(
  providerPath = fixtureProvider,
): Promise<DesktopFixture> {
  for (const [label, path] of [
    [
      cliOverride ? "configured oneharness test CLI" : "@oneharness/sdk 0.3.23 packaged CLI",
      fixtureOneHarnessCli,
    ],
    ["deterministic provider", providerPath],
  ] as const) {
    if (!existsSync(path)) {
      throw new Error(`${label} is missing at ${path}; run just bootstrap`);
    }
  }

  const root = await mkdtemp(resolve(tmpdir(), "oneharness-ui-desktop-e2e-"));
  const historyDir = resolve(root, "history");
  const providerArgv = resolve(root, "provider-argv.txt");
  const webview2UserDataDir = resolveFixtureWebView2UserDataDirectory(root, process.platform);
  const webview2Root = dirname(webview2UserDataDir);
  const cleanup = async (): Promise<void> => {
    if (process.platform === "win32") {
      await Promise.all([
        rm(root, { force: true, recursive: true }),
        rm(webview2Root, { force: true, recursive: true }),
      ]);
    } else {
      await rm(root, { force: true, recursive: true });
    }
  };
  try {
    await Promise.all([
      mkdir(webview2UserDataDir, { recursive: true }),
      writeFile(providerArgv, ""),
    ]);
    const plainHistory = await seed(historyDir, providerPath, {
      name: "plain-session",
      prompt: "Answer without optional thinking",
      stdout: '{"result":"A concise answer","session_id":"native-plain-session"}',
    });
    const oversized = await seedOversizedHistory(plainHistory);

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
    const turnIds = await seedPaginatedTurns(stopped);

    const failed = await seed(historyDir, providerPath, {
      exit: 1,
      name: "recoverable-failure",
      prompt: "This provider attempt should fail",
      stderr: "rate limit exceeded",
      stdout: '{"result":"","session_id":"native-failed-session"}',
    });
    const [plainRecord, stoppedRecord, failedRecord] = await Promise.all([
      readFirstHistoryRecord(plainHistory),
      readFirstHistoryRecord(stopped),
      readFirstHistoryRecord(failed),
    ]);
    const sessionIds = [
      plainRecord.session,
      ...oversized.sessionIds,
      stoppedRecord.session,
      failedRecord.session,
    ];

    return {
      cleanup,
      environment: {
        MOCK_ARGV_FILE: providerArgv,
        MOCK_EXIT: "0",
        MOCK_STDERR: "",
        MOCK_STDOUT:
          '{"result":"Native continuation succeeded","session_id":"native-continued-session"}',
        ONEHARNESS_NO_CONFIG: "1",
        ONEHARNESS_UI_E2E_PROVIDER_ARGV: providerArgv,
        ONEHARNESS_UI_E2E_LEGACY_HISTORY_BYTES: String(oversized.bytes),
        ONEHARNESS_UI_E2E_SESSION_IDS: JSON.stringify(sessionIds),
        ONEHARNESS_UI_E2E_TURN_IDS: JSON.stringify(turnIds),
        ONEHARNESS_UI_E2E_WEBVIEW2_USER_DATA_DIR: webview2UserDataDir,
        ONEHARNESS_UI_HISTORY_DIR: historyDir,
        ONEHARNESS_UI_PROVIDER_BIN: providerPath,
        ONEHARNESS_UI_PROVIDER_HARNESS: "claude-code",
        // The release application keeps its own WebView2 profile and wry's
        // browser arguments unless this journey opts in, so EdgeDriver only
        // reaches the shared profile and debugging port while it is set.
        TAURI_WEBVIEW_AUTOMATION: "true",
      },
      recordWebView2Diagnostics: async (output) =>
        await recordWebView2ProfileDiagnostics(webview2UserDataDir, output),
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
