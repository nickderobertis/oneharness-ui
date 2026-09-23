import type { RmOptions } from "node:fs";
import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { HistoryLineSchema, HistoryRecordSchema, OneHarness } from "@oneharness/sdk";
import { maxBridgeResponseBytes } from "@oneharness-ui/ipc-contract";

const repository = resolve(import.meta.dir, "../../..");

// The override names a program this fixture runs, so existence alone is not
// enough: a directory or an unexecutable file would fail far from here.
// Windows has no execute permission bit, so accessSync(X_OK) succeeds there for
// any readable file: PATHEXT is what decides whether a path names a program.
// It arrives from the environment, so entries that are not dot-extensions are
// dropped rather than trusted.
const windowsExecutableExtensions: readonly string[] = (
  process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD"
)
  .split(";")
  .flatMap((entry) => {
    const extension = entry.trim().toLowerCase();
    return /^\.[a-z0-9]{1,16}$/.test(extension) ? [extension] : [];
  });

// The platform is a parameter so both branches are reachable from any host:
// the extension rule cannot be exercised on POSIX otherwise, and the mode rule
// cannot be exercised on Windows at all.
export function isExecutableFile(path: string, platform: NodeJS.Platform): boolean {
  if (path.length === 0 || path.length > 4096 || !isAbsolute(path)) return false;
  try {
    if (!statSync(path).isFile()) return false;
    if (platform === "win32") {
      return windowsExecutableExtensions.includes(extname(path).toLowerCase());
    }
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
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
if (cliOverride !== undefined && !isExecutableFile(cliOverride, process.platform)) {
  throw new Error("ONEHARNESS_UI_TEST_CLI_BIN must be an existing absolute executable path");
}
export const fixtureOneHarnessCli = cliOverride ?? packagedOneHarnessCli;
export const fixtureProvider = resolve(
  repository,
  `target/oneharness-ui-test/oneharness-mock-harness${executableSuffix}`,
);
// The native runtime recognises its automation fixtures by this prefix.
// fixture.integration.test.ts reconciles this copy with runtime.rs.
export const FIXTURE_ROOT_PREFIX = "oneharness-ui-desktop-e2e-";
export const FIXTURE_REMOVAL_OPTIONS: Readonly<RmOptions> = {
  force: true,
  recursive: true,
};
// Windows refuses a deletion while WebView2 still holds a handle inside the
// profile it has just released, and the pinned Bun honours none of the retry
// options Node's remover accepts, so the fixture owns the schedule itself: 30
// waits, each one 250 ms step longer than the last, bounding a single removal
// to the same 116.25 seconds as before.
const FIXTURE_REMOVAL_ATTEMPTS = 31;
const FIXTURE_REMOVAL_STEP_MS = 250;
// The removal failures this fixture retries. Windows reports a handle it has
// not released yet as a busy or denied deletion, a walk that races an entry
// back into a directory reports a non-empty one, and an exhausted descriptor
// table reports the two limits. Any other failure is a real defect and is
// surfaced at once. fixture.integration.test.ts drives every code listed here.
export const TRANSIENT_REMOVAL_CODES: ReadonlySet<string> = new Set([
  "EBUSY",
  "EMFILE",
  "ENFILE",
  "ENOTEMPTY",
  "EPERM",
]);

function isTransientRemovalError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const { code } = error;
  return typeof code === "string" && TRANSIENT_REMOVAL_CODES.has(code);
}

async function removeFixturePath(path: string): Promise<void> {
  await rm(path, FIXTURE_REMOVAL_OPTIONS);
}

export type FixtureRemovalHooks = {
  delay?: (milliseconds: number) => Promise<void>;
  remove?: (path: string) => Promise<void>;
};

async function removeFixtureTree(
  path: string,
  { delay = sleep, remove = removeFixturePath }: FixtureRemovalHooks,
): Promise<void> {
  for (let attempt = 1; attempt < FIXTURE_REMOVAL_ATTEMPTS; attempt += 1) {
    try {
      await remove(path);
      return;
    } catch (error) {
      if (!isTransientRemovalError(error)) throw error;
      await delay(attempt * FIXTURE_REMOVAL_STEP_MS);
    }
  }
  // The last attempt is deliberately outside the loop: once the bound is spent
  // its failure is the one the caller sees, transient or not.
  await remove(path);
}

/// The cleanup a desktop fixture hands back, removing every directory it owns.
/// The hooks are the seam its integration test drives, so the Windows schedule
/// stays observable from a POSIX host without waiting out the bound.
export function createFixtureCleanup(
  paths: readonly string[],
  hooks: FixtureRemovalHooks = {},
): () => Promise<void> {
  return async () => {
    await Promise.all(paths.map(async (path) => await removeFixtureTree(path, hooks)));
  };
}

type SeedOptions = {
  exit?: number;
  name: string;
  prompt: string;
  stderr?: string;
  stdout: string;
};

const OVERSIZED_HISTORY_SESSION_COUNT = 55;
const PAGINATED_TURN_COUNT = 45;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MAX_INHERITED_ENVIRONMENT_BYTES = 32 * 1024;
const INHERITED_ENVIRONMENT_KEYS: readonly string[] = [
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
];

export function deterministicDesktopEnvironment(
  overrides: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of INHERITED_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    // The allowlist decides which host values reach the subprocess; this bound
    // decides how much, so an oversized inherited value cannot be handed on.
    if (typeof value === "string" && value.length <= MAX_INHERITED_ENVIRONMENT_BYTES) {
      environment[key] = value;
    }
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
  const environment = deterministicDesktopEnvironment({
    MOCK_EXIT: String(options.exit ?? 0),
    MOCK_STDERR: options.stderr ?? "",
    MOCK_STDOUT: options.stdout,
  });
  delete environment.ONEHARNESS_HISTORY_LABELS;
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
      "--format",
      "json",
      "--compact",
      "--no-config",
    ],
    {
      cwd: repository,
      env: environment,
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
  // The packaged CLI creates the canonical record first. Mutate only validated
  // fixture fields that the deterministic provider cannot express; the test
  // still drives the real UI → Tauri → sidecar → SDK → CLI/session boundary.
  const lines = (await readFile(historyFile, "utf8")).trim().split("\n");
  const parsed = lines.map((line) => HistoryLineSchema.parse(JSON.parse(line)));
  const runIndex = parsed.findLastIndex((line) => line.type === "run");
  // The SDK's line type is a wide union; narrowing or spreading it exceeds
  // TypeScript's union limit, so the schema validates the merged fields.
  const run: Readonly<Record<string, unknown>> | undefined = parsed[runIndex];
  if (run?.type !== "run") {
    throw new Error(`fixture history record is not an object: ${historyFile}`);
  }
  parsed[runIndex] = HistoryLineSchema.parse({ ...run, ...changes });
  await writeFile(historyFile, `${parsed.map((line) => JSON.stringify(line)).join("\n")}\n`);
}

async function readFirstHistoryRecord(historyFile: string) {
  const records = await new OneHarness().history({
    allProjects: true,
    historyDir: resolve(historyFile, "../.."),
    session: basename(historyFile, ".jsonl"),
  });
  const first = records[0];
  if (!first) throw new Error(`fixture history is empty: ${historyFile}`);
  return first;
}

function fixtureHistoryId(index: number): string {
  return `019f94e5-f419-7a12-bfef-${index.toString(16).padStart(12, "0")}`;
}

type HistoryLine = ReturnType<typeof HistoryLineSchema.parse>;
type EventLineVersion = Extract<HistoryLine, { type: "event" }>["schema_version"];

/// Build a serializer that lays a record out the way the packaged CLI laid out
/// `historyFile`: one line per event, stamped with the version the CLI itself
/// wrote there rather than one restated here, then the run line. A file without
/// event lines yields no version, and only records that carry events need one.
async function historyLineSerializer(
  historyFile: string,
): Promise<(record: ReturnType<typeof HistoryRecordSchema.parse>) => string> {
  const written = (await readFile(historyFile, "utf8"))
    .trim()
    .split("\n")
    .map((line): HistoryLine => HistoryLineSchema.parse(JSON.parse(line)));
  const versions = new Set<EventLineVersion>();
  for (const line of written) if (line.type === "event") versions.add(line.schema_version);
  if (versions.size > 1) {
    throw new Error(`fixture history event lines disagree on their schema version: ${historyFile}`);
  }
  const [eventLineVersion] = versions;
  return (record) => {
    const { events, ...run } = record;
    if (events?.length && eventLineVersion === undefined) {
      throw new Error(`fixture record carries events but ${historyFile} wrote no event lines`);
    }
    const lines = (events ?? []).map((event) =>
      HistoryLineSchema.parse({
        event,
        harness: record.harness,
        run_id: record.history_id,
        schema_version: eventLineVersion,
        type: "event",
      }),
    );
    lines.push(HistoryLineSchema.parse({ ...run, type: "run" }));
    return lines.map((line) => JSON.stringify(line)).join("\n");
  };
}

async function seedOversizedHistory(
  historyFile: string,
): Promise<{ bytes: number; sessionIds: string[] }> {
  // Paid model execution cannot deterministically produce a history corpus
  // above the legacy bridge limit. Derive every synthetic record from a real
  // packaged-CLI record and validate it with the SDK schema before persistence.
  const [template, serializeHistoryLines] = await Promise.all([
    readFirstHistoryRecord(historyFile),
    historyLineSerializer(historyFile),
  ]);
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
        history_id: fixtureHistoryId(index + 1),
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
        `${serializeHistoryLines(record)}\n`,
      );
    }),
  );
  const bytes = Buffer.byteLength(
    JSON.stringify({ data: { conversations: summaries, kind: "list" }, ok: true }),
  );
  if (bytes <= maxBridgeResponseBytes) {
    throw new Error(`oversized fixture legacy response was only ${bytes} bytes`);
  }
  return { bytes, sessionIds };
}

async function seedPaginatedTurns(historyFile: string): Promise<string[]> {
  const [template, serializeHistoryLines] = await Promise.all([
    readFirstHistoryRecord(historyFile),
    historyLineSerializer(historyFile),
  ]);
  const records = Array.from({ length: PAGINATED_TURN_COUNT }, (_, index) =>
    HistoryRecordSchema.parse({
      ...template,
      events: index === 0 ? template.events : [],
      history_id: fixtureHistoryId(index + 100),
      prompt: `Native paginated prompt ${String(index).padStart(2, "0")}`,
      text:
        index === 0 ? template.text : `Native paginated answer ${String(index).padStart(2, "0")}`,
      thinking: index === 0 ? template.thinking : undefined,
    }),
  );
  await writeFile(historyFile, `${records.map(serializeHistoryLines).join("\n")}\n`);
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
  const requiredExecutables: readonly (readonly [string, string])[] = [
    [
      cliOverride ? "configured oneharness test CLI" : "@oneharness/sdk packaged CLI",
      fixtureOneHarnessCli,
    ],
    ["deterministic provider", providerPath],
  ];
  for (const [label, path] of requiredExecutables) {
    if (!isExecutableFile(path, process.platform)) {
      throw new Error(`${label} is not an executable file at ${path}; run just bootstrap`);
    }
  }

  const root = await mkdtemp(resolve(tmpdir(), FIXTURE_ROOT_PREFIX));
  const historyDir = resolve(root, "history");
  const providerArgv = resolve(root, "provider-argv.txt");
  const webview2UserDataDir = resolveFixtureWebView2UserDataDirectory(root, process.platform);
  const webview2Root = dirname(webview2UserDataDir);
  // Windows keeps the WebView2 profile outside the fixture root, so cleanup
  // owns both trees there and the root alone everywhere else. WebView2 can
  // retain a profile handle briefly after deleteSession has returned, which the
  // bounded retries above absorb.
  const cleanup = createFixtureCleanup(
    process.platform === "win32" ? [root, webview2Root] : [root],
  );
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
