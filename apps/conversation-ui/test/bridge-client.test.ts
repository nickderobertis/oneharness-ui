import { afterEach, describe, expect, mock, test } from "bun:test";
import type { BridgeStreamFrame } from "@oneharness-ui/ipc-contract";
import {
  dataOrThrow,
  invokeBridge,
  watchBridge,
} from "../src/features/conversations/api/bridge-client";

const OPENED_FRAME = { cursor: null, kind: "opened", sessionId: "session-1", totalTurnCount: 0 };

function ndjsonResponse(lines: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" }, status: 200 },
  );
}

const originalBridgeUrl = process.env.NEXT_PUBLIC_ONEHARNESS_BRIDGE_URL;
const originalFetch = globalThis.fetch;

class TestChannel<T> {
  onmessage: (message: T) => void = () => {};
}

let tauriInvoke: (command: string, args: Record<string, unknown>) => Promise<unknown> = async () =>
  undefined;
mock.module("@tauri-apps/api/core", () => ({
  Channel: TestChannel,
  invoke: async (command: string, args: Record<string, unknown>) =>
    await tauriInvoke(command, args),
}));

afterEach(() => {
  delete window.__TAURI_INTERNALS__;
  if (originalBridgeUrl === undefined) delete process.env.NEXT_PUBLIC_ONEHARNESS_BRIDGE_URL;
  else process.env.NEXT_PUBLIC_ONEHARNESS_BRIDGE_URL = originalBridgeUrl;
  globalThis.fetch = originalFetch;
});

describe("validated bridge client", () => {
  test("rejects non-success HTTP and bridge error responses", async () => {
    process.env.NEXT_PUBLIC_ONEHARNESS_BRIDGE_URL = "http://127.0.0.1:4317";
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
    await expect(invokeBridge({ kind: "list" })).rejects.toThrow("HTTP 503");
    expect(() =>
      dataOrThrow({
        error: { code: "CONFIG_ERROR", detail: "/bad/config.toml", message: "Bad config" },
        ok: false,
      }),
    ).toThrow("Bad config");
  });

  test("rejects remote HTTP bridge configuration", async () => {
    process.env.NEXT_PUBLIC_ONEHARNESS_BRIDGE_URL = "https://bridge.example.com";
    await expect(invokeBridge({ kind: "list" })).rejects.toThrow("loopback URL");
  });

  test("establishes an opaque browser session before invoking the bridge", async () => {
    process.env.NEXT_PUBLIC_ONEHARNESS_BRIDGE_URL = "http://127.0.0.1:4317";
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({ init, url: String(input) });
      if (String(input).endsWith("/session")) return new Response(null, { status: 204 });
      return Response.json({
        data: { conversations: [], kind: "list", nextCursor: null, totalCount: 0 },
        ok: true,
      });
    }) as typeof fetch;

    await expect(invokeBridge({ kind: "list" })).resolves.toEqual({
      data: { conversations: [], kind: "list", nextCursor: null, totalCount: 0 },
      ok: true,
    });
    expect(requests.map(({ url }) => url)).toEqual([
      "http://127.0.0.1:4317/session",
      "http://127.0.0.1:4317/invoke",
    ]);
    expect(requests.every(({ init }) => init?.credentials === "include")).toBe(true);
    expect(requests[1]?.init?.headers).toEqual({ "Content-Type": "application/json" });
  });

  test("uses the serving origin in web mode", async () => {
    delete process.env.NEXT_PUBLIC_ONEHARNESS_BRIDGE_URL;
    const requests: string[] = [];
    globalThis.fetch = (async (input) => {
      requests.push(String(input));
      return Response.json({
        data: { conversations: [], kind: "list", nextCursor: null, totalCount: 0 },
        ok: true,
      });
    }) as typeof fetch;

    await invokeBridge({ kind: "list" });
    expect(requests).toEqual(["/invoke"]);
  });

  test("uses only the fixed Tauri bridge command", async () => {
    let failure: Error | undefined;
    const invocations: Array<{ args: unknown; command: string }> = [];
    tauriInvoke = async (command, args) => {
      invocations.push({ args, command });
      if (failure) throw failure;
      return {
        data: { conversations: [], kind: "list", nextCursor: null, totalCount: 0 },
        ok: true,
      };
    };
    window.__TAURI_INTERNALS__ = {};
    const response = await invokeBridge({ kind: "list" });
    expect(response).toEqual({
      data: { conversations: [], kind: "list", nextCursor: null, totalCount: 0 },
      ok: true,
    });
    expect(invocations).toEqual([
      { args: { request: { kind: "list" } }, command: "invoke_bridge" },
    ]);
    failure = new Error("bridge unavailable");
    await expect(invokeBridge({ kind: "list" })).rejects.toThrow("bridge unavailable");
  });

  test("streams and revalidates watch frames over HTTP", async () => {
    process.env.NEXT_PUBLIC_ONEHARNESS_BRIDGE_URL = "http://127.0.0.1:4317";
    const requests: string[] = [];
    let body: readonly string[] = [
      `${JSON.stringify(OPENED_FRAME)}\n`,
      `${JSON.stringify({
        kind: "tool-event",
        tool: { index: 0, kind: "tool_call", name: "Bash" },
        turnId: "session-1-0",
      })}\n`,
    ];
    globalThis.fetch = (async (input: string | URL | Request) => {
      requests.push(String(input));
      if (String(input).endsWith("/session")) return new Response(null, { status: 204 });
      return ndjsonResponse(body);
    }) as typeof fetch;

    const frames: BridgeStreamFrame[] = [];
    await watchBridge(
      { kind: "watch", sessionId: "session-1" },
      (frame) => frames.push(frame),
      new AbortController().signal,
    );
    expect(requests).toEqual(["http://127.0.0.1:4317/session", "http://127.0.0.1:4317/watch"]);
    expect(frames.map(({ kind }) => kind)).toEqual(["opened", "tool-event"]);

    // Anything the sidecar could not have produced stops the stream.
    body = ['{"kind":"future-frame"}\n'];
    await expect(
      watchBridge(
        { kind: "watch", sessionId: "session-1" },
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    body = [`{"kind":"opened","cursor":null,"sessionId":"${"x".repeat(600_000)}"`];
    await expect(
      watchBridge(
        { kind: "watch", sessionId: "session-1" },
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow("oversized live frame");
  }, 30_000);

  test("refuses a non-watch request and an unavailable stream", async () => {
    process.env.NEXT_PUBLIC_ONEHARNESS_BRIDGE_URL = "http://127.0.0.1:4317";
    await expect(
      watchBridge({ kind: "list" }, () => {}, new AbortController().signal),
    ).rejects.toThrow("Only a watch request");

    globalThis.fetch = (async (input: string | URL | Request) =>
      String(input).endsWith("/session")
        ? new Response(null, { status: 204 })
        : new Response(null, { status: 503 })) as typeof fetch;
    await expect(
      watchBridge(
        { kind: "watch", sessionId: "session-1" },
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow("HTTP 503");

    globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
    await expect(
      watchBridge(
        { kind: "watch", sessionId: "session-1" },
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow("session returned HTTP 503");
  });

  test("surfaces a stream the local bridge drops mid-conversation", async () => {
    delete process.env.NEXT_PUBLIC_ONEHARNESS_BRIDGE_URL;
    const encoder = new TextEncoder();
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`${JSON.stringify(OPENED_FRAME)}\n`));
            controller.error(new Error("the local bridge closed the live stream"));
          },
        }),
        { headers: { "Content-Type": "application/x-ndjson" }, status: 200 },
      )) as typeof fetch;

    await expect(
      watchBridge(
        { kind: "watch", sessionId: "session-1" },
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow("closed the live stream");
  });

  test("opens and closes the Tauri watch through its own channel", async () => {
    const invocations: Array<{ args: Record<string, unknown>; command: string }> = [];
    tauriInvoke = async (command, args) => {
      invocations.push({ args, command });
      if (command !== "start_bridge_watch") return undefined;
      (args.channel as TestChannel<unknown>).onmessage(OPENED_FRAME);
      return 4;
    };
    window.__TAURI_INTERNALS__ = {};
    const controller = new AbortController();
    const frames: BridgeStreamFrame[] = [];
    const watching = watchBridge(
      { kind: "watch", sessionId: "session-1" },
      (frame) => frames.push(frame),
      controller.signal,
    );
    await Promise.resolve();
    controller.abort();
    await watching;

    expect(frames).toEqual([OPENED_FRAME as BridgeStreamFrame]);
    expect(invocations.map(({ command }) => command)).toEqual([
      "start_bridge_watch",
      "stop_bridge_watch",
    ]);
    expect(invocations[0]?.args.request).toEqual({ kind: "watch", sessionId: "session-1" });
    expect(invocations[1]?.args).toEqual({ id: 4 });
  });
});
