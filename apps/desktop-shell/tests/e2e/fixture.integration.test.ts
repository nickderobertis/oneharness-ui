import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import {
  createDesktopFixture,
  deterministicDesktopEnvironment,
  fixtureOneHarnessCli,
  fixtureProvider,
  packagedOneHarnessCli,
  recordWebView2ProfileDiagnostics,
  validateFixtureHistoryFile,
} from "./fixture.ts";

const repository = resolve(import.meta.dir, "../../../..");

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

describe("native desktop fixture", () => {
  test("creates SDK-valid stopped, optional-thinking, and recoverable records", async () => {
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
      const sessionIds = JSON.parse(fixture.environment.ONEHARNESS_UI_E2E_SESSION_IDS) as unknown[];
      expect(sessionIds).toHaveLength(58);
      expect(new Set(sessionIds).size).toBe(58);
      const turnIds = JSON.parse(fixture.environment.ONEHARNESS_UI_E2E_TURN_IDS) as unknown[];
      expect(turnIds).toHaveLength(45);
      expect(new Set(turnIds).size).toBe(45);
      expect(Number(fixture.environment.ONEHARNESS_UI_E2E_LEGACY_HISTORY_BYTES)).toBeGreaterThan(
        4 * 1024 * 1024,
      );

      const stoppedSummary = listed.find(
        (record) => requiredString(record, "name") === "stopped-tool-session",
      );
      if (!stoppedSummary) throw new Error("stopped fixture was not listed");
      const stopped = await invoke([
        "history",
        "show",
        requiredString(stoppedSummary, "id"),
        "--compact",
        "--all-projects",
        "--history-dir",
        historyDir,
      ]);
      expect(stopped).toHaveLength(45);
      expect(stopped[0]).toMatchObject({
        session_id: "native-stopped-session",
        status: "timeout",
        thinking: "I checked the native command boundary before answering.",
      });

      const failedSummary = listed.find(
        (record) => requiredString(record, "name") === "recoverable-failure",
      );
      if (!failedSummary) throw new Error("recoverable fixture was not listed");
      const failed = await invoke([
        "history",
        "show",
        requiredString(failedSummary, "id"),
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
    const prefix = "oneharness-ui-desktop-e2e-";
    const before = (await readdir(tmpdir())).filter((name) => name.startsWith(prefix)).sort();
    await expect(createDesktopFixture(packagedOneHarnessCli)).rejects.toThrow("fixture CLI exited");
    const after = (await readdir(tmpdir())).filter((name) => name.startsWith(prefix)).sort();
    expect(after).toEqual(before);
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
