import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { OneHarness } from "@oneharness/sdk";
import { bridgeResponseSchema } from "@oneharness-ui/ipc-contract";
import { startWebServer, WATCH_KEEPALIVE_MS } from "../src/server.ts";
import { startHeldRun } from "./history-fixture.ts";

const repository = resolve(import.meta.dir, "../../..");
const cliOverride = process.env.ONEHARNESS_UI_TEST_CLI_BIN;
const providerOverride = process.env.ONEHARNESS_UI_TEST_PROVIDER_BIN;
// `as const` preserves the two allowed environment names while the common
// validation loop pairs each one with its independently typed override.
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
const accessToken = randomBytes(24).toString("base64url");
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

  test("streams a watched conversation as newline-delimited frames", async () => {
    const historyDir = resolve(fixtureRoot, "history");
    await mkdir(historyDir);
    const report = await new OneHarness(cliOverride ? { executable: cliOverride } : {}).run({
      bins: { "claude-code": provider },
      env: {
        MOCK_EXIT: "0",
        MOCK_STDERR: "",
        MOCK_STDOUT: '{"result":"Watched from the browser","session_id":"web-watch-native"}',
      },
      events: true,
      harnesses: ["claude-code"],
      history: true,
      historyDir,
      historyName: "web-watch-session",
      mode: "bypass",
      prompt: "Follow this session live",
    });
    if (!report.history_file) throw new Error("watch fixture did not write history");
    const filename = report.history_file.split(/[\\/]/).at(-1) ?? "";
    const sessionId = filename.slice(0, filename.lastIndexOf("."));
    process.env.ONEHARNESS_UI_HISTORY_DIR = historyDir;
    if (cliOverride) process.env.ONEHARNESS_BIN = cliOverride;
    server = await startWebServer({
      accessToken,
      port: 0,
      staticDirectory: resolve(fixtureRoot, "ui"),
    });

    const unauthenticated = await fetch(`${endpoint()}/watch`, {
      body: JSON.stringify({ kind: "watch", sessionId }),
      headers: { Origin: endpoint() },
      method: "POST",
    });
    expect(unauthenticated.status).toBe(401);
    const crossOrigin = await fetch(`${endpoint()}/watch`, {
      body: JSON.stringify({ kind: "watch", sessionId }),
      headers: { Authorization: accessHeader, Origin: "https://attacker.example" },
      method: "POST",
    });
    expect(crossOrigin.status).toBe(403);
    const wrongMethod = await fetch(`${endpoint()}/watch`, {
      headers: { Authorization: accessHeader },
    });
    expect(wrongMethod.status).toBe(405);

    const stream = await fetch(`${endpoint()}/watch`, {
      body: JSON.stringify({ kind: "watch", sessionId }),
      headers: {
        Authorization: accessHeader,
        "Content-Type": "application/json",
        Origin: endpoint(),
      },
      method: "POST",
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toBe("application/x-ndjson");
    expect(stream.headers.get("content-security-policy")).toContain("connect-src 'self'");
    const reader = stream.body?.getReader();
    if (!reader) throw new Error("watch response carried no body");
    const first = await reader.read();
    expect(JSON.parse(new TextDecoder().decode(first.value).split("\n", 1)[0] ?? "")).toMatchObject(
      { kind: "opened", sessionId, totalTurnCount: 1 },
    );
    await reader.cancel();
  }, 60_000);

  test("keeps a running session's watch moving with blank keep-alive lines while it is quiet", async () => {
    const historyDir = resolve(fixtureRoot, "history");
    await mkdir(historyDir);
    const live = await startHeldRun(
      {
        bins: { "claude-code": provider },
        harnesses: ["claude-code"],
        history: true,
        historyDir,
        historyName: "quiet-session",
        mode: "bypass",
        prompt: "Think for a while",
      },
      {
        after: ['{"type":"result","result":"Finally done","session_id":"web-quiet-native"}'],
        before: [
          '{"type":"assistant","message":{"content":[{"type":"text","text":"Thinking it over."}]}}',
        ],
        ...(cliOverride ? { executable: cliOverride } : {}),
      },
    );
    try {
      process.env.ONEHARNESS_UI_HISTORY_DIR = historyDir;
      if (cliOverride) process.env.ONEHARNESS_BIN = cliOverride;
      server = await startWebServer({
        accessToken,
        port: 0,
        staticDirectory: resolve(fixtureRoot, "ui"),
      });
      const post = async (path: string, body: unknown) =>
        await fetch(`${endpoint()}${path}`, {
          body: JSON.stringify(body),
          headers: {
            Authorization: accessHeader,
            "Content-Type": "application/json",
            Origin: endpoint(),
          },
          method: "POST",
        });
      let sessionId = "";
      for (const deadline = Date.now() + 20_000; !sessionId && Date.now() < deadline; ) {
        const listed = bridgeResponseSchema.parse(
          await (await post("/invoke", { kind: "list" })).json(),
        );
        sessionId =
          listed.ok && listed.data.kind === "list"
            ? (listed.data.conversations.find(({ running }) => running)?.id ?? "")
            : "";
        if (!sessionId) await Bun.sleep(50);
      }
      expect(sessionId).not.toBe("");

      const stream = await post("/watch", { kind: "watch", sessionId });
      const reader = stream.body?.getReader();
      if (!reader) throw new Error("watch response carried no body");
      const decoder = new TextDecoder();
      let buffered = "";
      const nextLine = async (): Promise<string> => {
        for (;;) {
          const newline = buffered.indexOf("\n");
          if (newline >= 0) {
            const line = buffered.slice(0, newline);
            buffered = buffered.slice(newline + 1);
            return line;
          }
          const chunk = await reader.read();
          if (chunk.done) throw new Error("the watch stream closed while the run was quiet");
          buffered += decoder.decode(chunk.value, { stream: true });
        }
      };
      const nextFrame = async (): Promise<{ kind: string; [key: string]: unknown }> => {
        for (;;) {
          const line = await nextLine();
          if (line !== "") return JSON.parse(line);
        }
      };
      expect(await nextFrame()).toMatchObject({ kind: "opened", sessionId });
      expect(await nextFrame()).toMatchObject({ kind: "turn", turn: { status: "running" } });
      expect(await nextFrame()).toMatchObject({
        event: { kind: "message", text: "Thinking it over." },
        kind: "agent-event",
      });
      // Nothing happens while the run holds, yet the stream keeps writing.
      const quietSince = Date.now();
      expect(await nextLine()).toBe("");
      expect(Date.now() - quietSince).toBeLessThan(WATCH_KEEPALIVE_MS * 3);
      expect(await nextLine()).toBe("");
      await live.release();
      expect(await nextFrame()).toMatchObject({
        kind: "turn",
        turn: { assistant: "Finally done", status: "completed" },
      });
      await reader.cancel();
    } finally {
      await live.release();
    }
  }, 60_000);

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
    for (const authorization of [
      "Basic malformed",
      `Basic ${Buffer.from("oneharness:incorrect-access-token-value").toString("base64")}`,
    ]) {
      expect(
        (await fetch(`${endpoint()}/`, { headers: { Authorization: authorization } })).status,
      ).toBe(401);
    }
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
