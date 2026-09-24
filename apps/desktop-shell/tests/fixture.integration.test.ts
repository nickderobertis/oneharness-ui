import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { maxBridgeResponseBytes } from "@oneharness-ui/ipc-contract";
import {
  createDesktopFixture,
  deterministicDesktopEnvironment,
  FIXTURE_REMOVAL_OPTIONS,
  FIXTURE_ROOT_PREFIX,
  fixtureOneHarnessCli,
  fixtureProvider,
  isExecutableFile,
  packagedOneHarnessCli,
  recordWebView2ProfileDiagnostics,
  TRANSIENT_REMOVAL_CODES,
  validateFixtureHistoryFile,
} from "./fixture.ts";

const repository = resolve(import.meta.dir, "../../..");

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsedIdList(value: string): unknown[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("fixture id environment value is not a JSON array");
  return parsed;
}

function requiredString(record: JsonObject, field: string): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new Error(`fixture inspection record has invalid ${field}`);
  }
  return value;
}

async function invoke(args: string[]): Promise<JsonObject[]> {
  const child = Bun.spawn([fixtureOneHarnessCli, ...args], {
    cwd: repository,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0) throw new Error(`fixture inspection exited ${exitCode}: ${stderr.trim()}`);
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error("fixture inspection returned malformed JSON");
  }
  if (!Array.isArray(value) || !value.every(isJsonObject)) {
    throw new Error("fixture inspection returned an invalid record collection");
  }
  return value;
}

async function fixtureRoots(): Promise<string[]> {
  const entries = await readdir(tmpdir());
  return entries.filter((name) => name.startsWith(FIXTURE_ROOT_PREFIX)).sort();
}

function removalError(code: string, message: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = code;
  return error;
}

async function removeFixturePaths(
  fixture: Awaited<ReturnType<typeof createDesktopFixture>>,
): Promise<void> {
  const root = dirname(fixture.environment.ONEHARNESS_UI_HISTORY_DIR);
  const webView2Root = dirname(fixture.environment.ONEHARNESS_UI_E2E_WEBVIEW2_USER_DATA_DIR);
  await Promise.all(
    [...new Set([root, webView2Root])].map(async (path) => await rm(path, FIXTURE_REMOVAL_OPTIONS)),
  );
}

describe("native desktop fixture", () => {
  test("keeps the fixture root prefix aligned with the native runtime", async () => {
    const runtime = await readFile(
      resolve(repository, "apps/desktop-shell/src/runtime.rs"),
      "utf8",
    );
    // Reporting the declared value keeps a drift failure readable: the whole
    // runtime source would otherwise be printed as the unmatched haystack.
    const declared = runtime.match(/const FIXTURE_ROOT_PREFIX: &str = "([^"]*)";/u)?.[1];
    expect(declared).toBe(FIXTURE_ROOT_PREFIX);
  });

  test("creates schema 1.2 stopped, paginated, and recoverable records", async () => {
    const fixture = await createDesktopFixture();
    const historyDir = fixture.environment.ONEHARNESS_UI_HISTORY_DIR;
    const fixtureRoot = dirname(historyDir);
    const expectedWebView2Directory =
      process.platform === "win32"
        ? resolve(
            process.env.LOCALAPPDATA ?? "",
            "main",
            basename(fixtureRoot),
            "webview2-user-data",
          )
        : resolve(fixtureRoot, "webview2-user-data");
    const webView2Root = dirname(expectedWebView2Directory);
    try {
      expect(Object.hasOwn(fixture.environment, "ONEHARNESS_BIN")).toBe(false);
      expect(fixture.environment.ONEHARNESS_UI_E2E_WEBVIEW2_USER_DATA_DIR).toBe(
        expectedWebView2Directory,
      );
      expect(Object.hasOwn(fixture.environment, "WEBVIEW2_USER_DATA_FOLDER")).toBe(false);
      // Tauri only adopts EdgeDriver's shared profile and debugging port while
      // the journey opts in, so the driver cannot reach the app without this.
      expect(fixture.environment.TAURI_WEBVIEW_AUTOMATION).toBe("true");
      const listed = await invoke([
        "history",
        "list",
        "--format",
        "json",
        "--compact",
        "--all-projects",
        "--history-dir",
        historyDir,
      ]);
      const names = listed.map((record) => requiredString(record, "name"));
      expect(names).toContain("plain-session");
      expect(names).toContain("recoverable-failure");
      expect(names).toContain("stopped-tool-session");
      expect(names.filter((name) => name.startsWith("oversized-session-"))).toHaveLength(55);
      const sessionIds = parsedIdList(fixture.environment.ONEHARNESS_UI_E2E_SESSION_IDS);
      expect(sessionIds).toHaveLength(58);
      expect(new Set(sessionIds).size).toBe(58);
      const turnIds = parsedIdList(fixture.environment.ONEHARNESS_UI_E2E_TURN_IDS);
      expect(turnIds).toHaveLength(45);
      expect(new Set(turnIds).size).toBe(45);
      expect(Number(fixture.environment.ONEHARNESS_UI_E2E_LEGACY_HISTORY_BYTES)).toBeGreaterThan(
        maxBridgeResponseBytes,
      );

      const stoppedSummary = listed.find(
        (record) => requiredString(record, "name") === "stopped-tool-session",
      );
      if (!stoppedSummary) throw new Error("stopped fixture was not listed");
      const stopped = await invoke([
        "history",
        "show",
        requiredString(stoppedSummary, "id"),
        "--format",
        "json",
        "--compact",
        "--all-projects",
        "--history-dir",
        historyDir,
      ]);
      expect(stopped).toHaveLength(45);
      expect(stopped[0]).toMatchObject({
        schema_version: "1.2",
        session_id: "native-stopped-session",
        status: "timeout",
      });

      const failedSummary = listed.find(
        (record) => requiredString(record, "name") === "recoverable-failure",
      );
      if (!failedSummary) throw new Error("recoverable fixture was not listed");
      const failed = await invoke([
        "history",
        "show",
        requiredString(failedSummary, "id"),
        "--format",
        "json",
        "--compact",
        "--all-projects",
        "--history-dir",
        historyDir,
      ]);
      expect(failed[0]).toMatchObject({
        failure_kind: "rate_limit",
        session_id: "native-failed-session",
        status: "nonzero",
      });
    } finally {
      await fixture.cleanup();
    }
    expect(existsSync(fixtureRoot)).toBe(false);
    expect(existsSync(webView2Root)).toBe(false);
  });

  test("removes temporary history when the real provider process cannot run", async () => {
    const before = await fixtureRoots();
    await expect(createDesktopFixture(packagedOneHarnessCli)).rejects.toThrow("fixture CLI exited");
    expect(await fixtureRoots()).toEqual(before);
  });

  // llmlint: ignore-block[e2e_not_mocked, tests_mirror_real_usage, expensive_tests_stay_behind_their_own_edge] POSIX cannot produce WebView2's FileBusy error, so injected removers drive the real fixture cleanup. The desktop fixture-integration target inherits the desktop app's conversation-ui dependency.
  test("retries a fixture directory that Windows still reports as busy", async () => {
    const removed: string[] = [];
    const waited: number[] = [];
    let busyAttempts = 3;
    let root: string;
    const fixture = await createDesktopFixture(fixtureProvider, {
      delay: async (milliseconds) => {
        waited.push(milliseconds);
      },
      remove: async (path) => {
        if (path === root && busyAttempts > 0) {
          busyAttempts -= 1;
          throw removalError("EBUSY", "EBUSY: resource busy or locked, rmdir");
        }
        await rm(path, FIXTURE_REMOVAL_OPTIONS);
        removed.push(path);
      },
    });
    root = dirname(fixture.environment.ONEHARNESS_UI_HISTORY_DIR);

    await fixture.cleanup();

    expect(removed).toContain(root);
    expect(existsSync(root)).toBe(false);
    expect(waited).toEqual([250, 500, 750]);
  });

  test("surfaces the final busy failure once the removal bound is spent", async () => {
    const waited: number[] = [];
    let attempts = 0;
    let root: string;
    const fixture = await createDesktopFixture(fixtureProvider, {
      delay: async (milliseconds) => {
        waited.push(milliseconds);
      },
      remove: async (path) => {
        if (path !== root) {
          await rm(path, FIXTURE_REMOVAL_OPTIONS);
          return;
        }
        attempts += 1;
        throw removalError("EBUSY", `EBUSY: resource busy or locked, attempt ${attempts}`);
      },
    });
    root = dirname(fixture.environment.ONEHARNESS_UI_HISTORY_DIR);

    try {
      await expect(fixture.cleanup()).rejects.toThrow("attempt 31");
    } finally {
      await removeFixturePaths(fixture);
    }

    expect(attempts).toBe(31);
    expect(waited).toEqual(Array.from({ length: 30 }, (_, index) => (index + 1) * 250));
    expect(waited.reduce((total, milliseconds) => total + milliseconds, 0)).toBe(116_250);
  });

  test("retries every removal failure the fixture treats as transient", async () => {
    expect([...TRANSIENT_REMOVAL_CODES].sort()).toEqual([
      "EBUSY",
      "EMFILE",
      "ENFILE",
      "ENOTEMPTY",
      "EPERM",
    ]);
    for (const code of TRANSIENT_REMOVAL_CODES) {
      const waited: number[] = [];
      let attempts = 0;
      let root: string;
      const fixture = await createDesktopFixture(fixtureProvider, {
        delay: async (milliseconds) => {
          waited.push(milliseconds);
        },
        remove: async (path) => {
          if (path !== root) {
            await rm(path, FIXTURE_REMOVAL_OPTIONS);
            return;
          }
          attempts += 1;
          if (attempts === 1) throw removalError(code, `${code}: the profile is still held`);
          await rm(path, FIXTURE_REMOVAL_OPTIONS);
        },
      });
      root = dirname(fixture.environment.ONEHARNESS_UI_HISTORY_DIR);

      await fixture.cleanup();

      expect([code, attempts, waited]).toEqual([code, 2, [250]]);
    }
  }, 30_000);

  test("refuses to retry a removal failure that is not transient", async () => {
    const waited: number[] = [];
    let attempts = 0;
    let root: string;
    const fixture = await createDesktopFixture(fixtureProvider, {
      delay: async (milliseconds) => {
        waited.push(milliseconds);
      },
      remove: async (path) => {
        if (path !== root) {
          await rm(path, FIXTURE_REMOVAL_OPTIONS);
          return;
        }
        attempts += 1;
        throw removalError("EACCES", "EACCES: permission denied, rmdir");
      },
    });
    root = dirname(fixture.environment.ONEHARNESS_UI_HISTORY_DIR);

    try {
      await expect(fixture.cleanup()).rejects.toThrow("permission denied");
    } finally {
      await removeFixturePaths(fixture);
    }

    expect(attempts).toBe(1);
    expect(waited).toEqual([]);
  });

  // llmlint: ignore[tests_assert_real_behavior] This checks the static fs.rm option contract; the tests above exercise cleanup outcomes through the fixture entry point.
  test("keeps the removal bound in the fixture rather than the filesystem remover", async () => {
    expect(Object.keys(FIXTURE_REMOVAL_OPTIONS).sort()).toEqual(["force", "recursive"]);
    // The pinned Bun ignores the remover's own retry options on Windows, so the
    // fixture must not hand its bound back to them anywhere. Reporting the
    // offending lines keeps a drift failure readable: the whole fixture source
    // would otherwise be printed as the unmatched haystack.
    const fixtureSource = await readFile(resolve(import.meta.dir, "fixture.ts"), "utf8");
    const delegated = fixtureSource
      .split("\n")
      .filter((line) => /maxRetries|retryDelay/u.test(line));
    expect(delegated).toEqual([]);
  });
  // llmlint: ignore-end[e2e_not_mocked, tests_mirror_real_usage, expensive_tests_stay_behind_their_own_edge]

  test("reads the execute bit on POSIX and the extension on Windows", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "oneharness-ui-executable-"));
    try {
      const program = resolve(root, "provider.exe");
      const document = resolve(root, "provider.txt");
      await Promise.all([
        writeFile(program, "", { mode: 0o644 }),
        writeFile(document, "", { mode: 0o755 }),
      ]);

      // Windows has no execute bit, so only the extension can decide there.
      // This half runs on every host, which is what makes the Windows rule
      // reachable from a POSIX one.
      expect(isExecutableFile(program, "win32")).toBe(true);
      expect(isExecutableFile(document, "win32")).toBe(false);
      expect(isExecutableFile(resolve(root, "missing.exe"), "win32")).toBe(false);
      expect(isExecutableFile(root, "win32")).toBe(false);

      // The mode rule is the host filesystem's, so it is only observable where
      // modes exist; on Windows every readable file answers X_OK.
      if (process.platform !== "win32") {
        expect(isExecutableFile(document, "linux")).toBe(true);
        expect(isExecutableFile(program, "linux")).toBe(false);
        expect(isExecutableFile(root, "linux")).toBe(false);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("refuses a deterministic provider that is not an executable file", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "oneharness-ui-provider-executable-"));
    const notExecutable = resolve(root, "provider.txt");
    try {
      await writeFile(notExecutable, "", { mode: 0o644 });
      const before = await fixtureRoots();
      // The provider is spawned, so an existing path is not enough: a readable
      // regular file has to be refused here rather than at the spawn, which
      // would already have created the fixture this asserts was never made.
      await expect(createDesktopFixture(notExecutable)).rejects.toThrow(
        `deterministic provider is not an executable file at ${notExecutable}`,
      );
      expect(await fixtureRoots()).toEqual(before);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("rejects a CLI history path outside the isolated fixture directory", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "oneharness-ui-history-boundary-"));
    const historyDir = resolve(root, "history");
    const inside = resolve(historyDir, "session.jsonl");
    const outside = resolve(root, "outside.jsonl");
    try {
      await mkdir(historyDir);
      await Promise.all([writeFile(inside, "{}\n"), writeFile(outside, "{}\n")]);
      await expect(validateFixtureHistoryFile(historyDir, inside)).resolves.toBe(
        await realpath(inside),
      );
      await expect(validateFixtureHistoryFile(historyDir, outside)).rejects.toThrow(
        "outside its isolated directory",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("distinguishes Tauri profile setup from WebView2 bridge readiness", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "oneharness-ui-webview-diagnostics-"));
    const userDataDirectory = resolve(root, "fixture", "webview2-user-data");
    const output = resolve(root, "webview2-profile.log");
    try {
      await mkdir(userDataDirectory, { recursive: true });
      await writeFile(resolve(root, "fixture", "tauri-profile-ready"), "ready\n");
      await writeFile(resolve(userDataDirectory, "DevToolsActivePort"), "1234\n");
      await recordWebView2ProfileDiagnostics(userDataDirectory, output, "win32");
      expect(await readFile(output, "utf8")).toBe(
        "PASS\tTauri accepted WebView2 profile argument\n" +
          "PASS\tWebView2 created DevToolsActivePort\n",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("rejects a provider argv path outside the isolated desktop fixture", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "oneharness-ui-provider-boundary-"));
    const outside = resolve(root, "provider-argv.txt");
    try {
      await writeFile(outside, "");
      const child = Bun.spawn([fixtureProvider], {
        env: deterministicDesktopEnvironment({ MOCK_ARGV_FILE: outside }),
        stderr: "pipe",
        stdout: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("MOCK_ARGV_FILE must be the isolated desktop fixture argv file");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("rejects invalid deterministic provider controls", async () => {
    const child = Bun.spawn([fixtureProvider], {
      env: deterministicDesktopEnvironment({ MOCK_EXIT: "bad" }),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("MOCK_EXIT must be an integer between 0 and 255");
  });

  test("scrubs ambient oneharness and provider overrides before deterministic subprocesses", () => {
    process.env.ONEHARNESS_UI_UNTRUSTED_TEST = "ambient";
    process.env.MOCK_UNTRUSTED_TEST = "ambient";
    process.env.UNRELATED_DESKTOP_E2E_TEST = "ambient";
    try {
      const environment = deterministicDesktopEnvironment({
        MOCK_STDOUT: "controlled",
        ONEHARNESS_NO_CONFIG: "1",
      });
      expect(environment.ONEHARNESS_UI_UNTRUSTED_TEST).toBeUndefined();
      expect(environment.MOCK_UNTRUSTED_TEST).toBeUndefined();
      expect(environment.UNRELATED_DESKTOP_E2E_TEST).toBeUndefined();
      expect(environment).toMatchObject({ MOCK_STDOUT: "controlled", ONEHARNESS_NO_CONFIG: "1" });
    } finally {
      delete process.env.ONEHARNESS_UI_UNTRUSTED_TEST;
      delete process.env.MOCK_UNTRUSTED_TEST;
      delete process.env.UNRELATED_DESKTOP_E2E_TEST;
    }
  });
});
