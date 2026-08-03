import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { OneHarness } from "@oneharness/sdk";
import { type BridgeStreamFrame, bridgeStreamFrameSchema } from "@oneharness-ui/ipc-contract";
import { startServer } from "../src/server.ts";

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
const AUTHORIZATION = "oneharness-ui-server-authorization-token";
const UI_ORIGIN = "http://127.0.0.1:3000";
let server: ReturnType<typeof Bun.serve> | undefined;
let historyDir = "";
const originalEnvironment = new Map<string, string | undefined>();

beforeEach(async () => {
  historyDir = await mkdtemp(resolve(tmpdir(), "oneharness-ui-server-"));
  for (const key of ["ONEHARNESS_BIN", "ONEHARNESS_HISTORY_LABELS", "ONEHARNESS_UI_HISTORY_DIR"]) {
    originalEnvironment.set(key, process.env[key]);
  }
  delete process.env.ONEHARNESS_HISTORY_LABELS;
});

afterEach(async () => {
  await server?.stop(true);
  server = undefined;
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  originalEnvironment.clear();
  await rm(historyDir, { force: true, recursive: true });
});

function endpoint(): string {
  if (!server) throw new Error("test server was not started");
  return `http://127.0.0.1:${server.port}`;
}

async function sessionCookie(): Promise<string> {
  const response = await fetch(`${endpoint()}/session`, { headers: { Origin: UI_ORIGIN } });
  expect(response.status).toBe(204);
  const cookie = response.headers.get("set-cookie");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");
  if (!cookie) throw new Error("session response omitted its cookie");
  return cookie.split(";", 1)[0] ?? "";
}

async function seedWatchableSession(): Promise<string> {
  const report = await new OneHarness(cliOverride ? { executable: cliOverride } : {}).run({
    bins: { "claude-code": provider },
    env: {
      MOCK_EXIT: "0",
      MOCK_STDERR: "",
      MOCK_STDOUT: '{"result":"Streamed over HTTP","session_id":"native-http-watch"}',
      ONEHARNESS_HISTORY_LABELS: "{}",
    },
    events: true,
    harnesses: ["claude-code"],
    history: true,
    historyDir,
    historyName: "http-watch",
    mode: "bypass",
    prompt: "Watch this conversation over HTTP",
  });
  if (!report.history_file) throw new Error("watch fixture did not write history");
  process.env.ONEHARNESS_UI_HISTORY_DIR = historyDir;
  if (cliOverride) process.env.ONEHARNESS_BIN = cliOverride;
  const filename = report.history_file.split(/[\\/]/).at(-1) ?? "";
  return filename.slice(0, filename.lastIndexOf("."));
}

/// Read newline-delimited frames until `count` arrive, then cancel the reader
/// exactly as a closed conversation view would.
async function readFrames(response: Response, count: number): Promise<BridgeStreamFrame[]> {
  const body = response.body;
  if (!body) throw new Error("watch response carried no body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const frames: BridgeStreamFrame[] = [];
  let buffered = "";
  try {
    while (frames.length < count) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffered += decoder.decode(chunk.value, { stream: true });
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        frames.push(bridgeStreamFrameSchema.parse(JSON.parse(buffered.slice(0, newline))));
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
      }
    }
  } finally {
    await reader.cancel();
  }
  return frames;
}

describe("development HTTP bridge boundary", () => {
  test("keeps its capability in an HttpOnly session cookie", async () => {
    server = startServer(0, AUTHORIZATION);
    const missing = await fetch(`${endpoint()}/invoke`, {
      body: JSON.stringify({ kind: "list" }),
      headers: { "Content-Type": "application/json", Origin: UI_ORIGIN },
      method: "POST",
    });
    expect(missing.status).toBe(401);

    const wrong = await fetch(`${endpoint()}/invoke`, {
      body: JSON.stringify({ kind: "list" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: "oneharness_ui_capability=oneharness-ui-wrong-authorization-value",
        Origin: UI_ORIGIN,
      },
      method: "POST",
    });
    expect(wrong.status).toBe(401);
  });

  test("bounds the actual request stream and rejects malformed JSON", async () => {
    server = startServer(0, AUTHORIZATION);
    const cookie = await sessionCookie();
    const malformed = await fetch(`${endpoint()}/invoke`, {
      body: "{",
      headers: { Cookie: cookie, Origin: UI_ORIGIN },
      method: "POST",
    });
    expect(malformed.status).toBe(400);

    const oversized = await fetch(`${endpoint()}/invoke`, {
      body: JSON.stringify({ message: "x".repeat(70_000) }),
      headers: { Cookie: cookie, Origin: UI_ORIGIN },
      method: "POST",
    });
    expect(oversized.status).toBe(413);
  });

  test("only permits loopback CORS origins", async () => {
    server = startServer(0, AUTHORIZATION);
    const permitted = await fetch(`${endpoint()}/health`, {
      headers: { Origin: UI_ORIGIN },
    });
    expect(permitted.headers.get("access-control-allow-origin")).toBe(UI_ORIGIN);

    const rejected = await fetch(`${endpoint()}/session`, {
      headers: { Origin: "https://attacker.example" },
    });
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("access-control-allow-origin")).toBe("null");
    expect(rejected.headers.get("set-cookie")).toBeNull();
  });

  test("streams watch frames behind the same capability and stops when the reader leaves", async () => {
    const sessionId = await seedWatchableSession();
    server = startServer(0, AUTHORIZATION);

    const unauthorized = await fetch(`${endpoint()}/watch`, {
      body: JSON.stringify({ kind: "watch", sessionId }),
      headers: { "Content-Type": "application/json", Origin: UI_ORIGIN },
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);

    const cookie = await sessionCookie();
    const crossOrigin = await fetch(`${endpoint()}/watch`, {
      body: JSON.stringify({ kind: "watch", sessionId }),
      headers: { Cookie: cookie, Origin: "https://attacker.example" },
      method: "POST",
    });
    expect(crossOrigin.status).toBe(403);

    const stream = await fetch(`${endpoint()}/watch`, {
      body: JSON.stringify({ kind: "watch", sessionId }),
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: UI_ORIGIN },
      method: "POST",
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toBe("application/x-ndjson");
    expect(stream.headers.get("cache-control")).toBe("no-store");
    expect(await readFrames(stream, 1)).toMatchObject([
      { kind: "opened", sessionId, totalTurnCount: 1 },
    ]);

    // The stream is not the only transport left standing: the unary endpoint
    // still answers after a watch reader disconnects.
    const listed = await fetch(`${endpoint()}/invoke`, {
      body: JSON.stringify({ kind: "list" }),
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: UI_ORIGIN },
      method: "POST",
    });
    expect(await listed.json()).toMatchObject({ ok: true });
  }, 60_000);
});
