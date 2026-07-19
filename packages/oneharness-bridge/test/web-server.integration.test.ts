import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { OneHarness } from "@oneharness/sdk";
import { startWebServer } from "../src/server.ts";

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
const authorization = "oneharness-ui-web-integration-authorization";
let fixtureRoot = "";
let server: ReturnType<typeof Bun.serve> | undefined;
const originalHistoryDir = process.env.ONEHARNESS_UI_HISTORY_DIR;
const originalExecutable = process.env.ONEHARNESS_BIN;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(resolve(tmpdir(), "oneharness-ui-web-"));
  await mkdir(resolve(fixtureRoot, "ui"));
  await writeFile(
    resolve(fixtureRoot, "ui/index.html"),
    "<!doctype html><title>oneharness UI</title>",
  );
});

afterEach(async () => {
  await server?.stop(true);
  server = undefined;
  await rm(fixtureRoot, { force: true, recursive: true });
  if (originalHistoryDir === undefined) delete process.env.ONEHARNESS_UI_HISTORY_DIR;
  else process.env.ONEHARNESS_UI_HISTORY_DIR = originalHistoryDir;
  if (originalExecutable === undefined) delete process.env.ONEHARNESS_BIN;
  else process.env.ONEHARNESS_BIN = originalExecutable;
});

function endpoint(): string {
  if (!server) throw new Error("test server was not started");
  return `http://127.0.0.1:${server.port}`;
}

async function cookie(): Promise<string> {
  const response = await fetch(`${endpoint()}/session`);
  expect(response.status).toBe(204);
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

describe("web UI over the real HTTP, SDK, CLI, provider, and history boundary", () => {
  test("serves the UI and lists SDK-validated history over the same origin", async () => {
    const historyDir = resolve(fixtureRoot, "history");
    await mkdir(historyDir);
    await new OneHarness(cliOverride ? { executable: cliOverride } : {}).run({
      bins: { "claude-code": provider },
      env: {
        MOCK_EXIT: "0",
        MOCK_STDERR: "",
        MOCK_STDOUT: '{"result":"From web","session_id":"web-native"}',
      },
      harnesses: ["claude-code"],
      history: true,
      historyDir,
      historyName: "web-session",
      mode: "bypass",
      prompt: "Read this from another device",
    });
    process.env.ONEHARNESS_UI_HISTORY_DIR = historyDir;
    if (cliOverride) process.env.ONEHARNESS_BIN = cliOverride;
    server = await startWebServer({
      authorization,
      port: 0,
      staticDirectory: resolve(fixtureRoot, "ui"),
    });

    const page = await fetch(`${endpoint()}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("oneharness UI");
    expect(page.headers.get("content-security-policy")).toContain("connect-src 'self'");
    const response = await fetch(`${endpoint()}/invoke`, {
      body: JSON.stringify({ kind: "list" }),
      headers: { "Content-Type": "application/json", Cookie: await cookie() },
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { conversations: [{ name: "web-session" }], kind: "list", totalCount: 1 },
      ok: true,
    });
  });

  test("rejects cross-origin and invalid contract input", async () => {
    server = await startWebServer({
      authorization,
      port: 0,
      staticDirectory: resolve(fixtureRoot, "ui"),
    });
    const sessionCookie = await cookie();
    const crossOrigin = await fetch(`${endpoint()}/invoke`, {
      body: JSON.stringify({ kind: "list" }),
      headers: { Cookie: sessionCookie, Origin: "https://attacker.example" },
      method: "POST",
    });
    expect(crossOrigin.status).toBe(403);
    const crossSiteSession = await fetch(`${endpoint()}/session`, {
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(crossSiteSession.status).toBe(403);
    expect(crossSiteSession.headers.get("set-cookie")).toBeNull();

    const invalid = await fetch(`${endpoint()}/invoke`, {
      body: JSON.stringify({ kind: "continue", message: "", sessionId: "session" }),
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      method: "POST",
    });
    expect(invalid.status).toBe(200);
    expect(await invalid.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "The local bridge request is invalid." },
      ok: false,
    });
  });
});
