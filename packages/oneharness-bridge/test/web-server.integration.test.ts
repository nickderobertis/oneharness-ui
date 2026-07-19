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
const accessToken = "oneharness-ui-web-browser-access";
const accessHeader = `Basic ${Buffer.from(`oneharness:${accessToken}`).toString("base64")}`;
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
      accessToken,
      port: 0,
      staticDirectory: resolve(fixtureRoot, "ui"),
    });

    const page = await fetch(`${endpoint()}/`, { headers: { Authorization: accessHeader } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("oneharness UI");
    expect(page.headers.get("content-security-policy")).toContain("connect-src 'self'");
    const response = await fetch(`${endpoint()}/invoke`, {
      body: JSON.stringify({ kind: "list" }),
      headers: {
        Authorization: accessHeader,
        "Content-Type": "application/json",
        Origin: endpoint(),
      },
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
      accessToken,
      port: 0,
      staticDirectory: resolve(fixtureRoot, "ui"),
    });
    const health = await fetch(`${endpoint()}/health`);
    expect(await health.json()).toEqual({ status: "ok" });
    const unauthenticated = await fetch(`${endpoint()}/`);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("www-authenticate")).toContain("Basic");
    const missingOrigin = await fetch(`${endpoint()}/invoke`, {
      body: JSON.stringify({ kind: "list" }),
      headers: { Authorization: accessHeader },
      method: "POST",
    });
    expect(missingOrigin.status).toBe(403);
    const crossOrigin = await fetch(`${endpoint()}/invoke`, {
      body: JSON.stringify({ kind: "list" }),
      headers: { Authorization: accessHeader, Origin: "https://attacker.example" },
      method: "POST",
    });
    expect(crossOrigin.status).toBe(403);

    const invalid = await fetch(`${endpoint()}/invoke`, {
      body: JSON.stringify({ kind: "continue", message: "", sessionId: "session" }),
      headers: {
        Authorization: accessHeader,
        "Content-Type": "application/json",
        Origin: endpoint(),
      },
      method: "POST",
    });
    expect(invalid.status).toBe(200);
    expect(await invalid.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "The local bridge request is invalid." },
      ok: false,
    });
    const wrongMethod = await fetch(`${endpoint()}/invoke`, {
      headers: { Authorization: accessHeader },
    });
    expect(wrongMethod.status).toBe(405);
    const malformed = await fetch(`${endpoint()}/invoke`, {
      body: "{",
      headers: { Authorization: accessHeader, Origin: endpoint() },
      method: "POST",
    });
    expect(malformed.status).toBe(400);
    const oversized = await fetch(`${endpoint()}/invoke`, {
      body: JSON.stringify({ message: "x".repeat(70_000) }),
      headers: { Authorization: accessHeader, Origin: endpoint() },
      method: "POST",
    });
    expect(oversized.status).toBe(413);
    const head = await fetch(`${endpoint()}/`, {
      headers: { Authorization: accessHeader },
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const staticPost = await fetch(`${endpoint()}/`, {
      headers: { Authorization: accessHeader },
      method: "POST",
    });
    expect(staticPost.status).toBe(405);
    const authenticated = { headers: { Authorization: accessHeader } };
    expect((await fetch(`${endpoint()}/missing`, authenticated)).status).toBe(404);
    expect((await fetch(`${endpoint()}/%ZZ`, authenticated)).status).toBe(400);
    expect((await fetch(`${endpoint()}/%5Csecret`, authenticated)).status).toBe(400);
    expect((await fetch(`${endpoint()}/%2e%2e%2fsecret`, authenticated)).status).toBe(404);
  });
});
