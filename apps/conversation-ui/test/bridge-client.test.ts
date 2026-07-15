import { afterEach, describe, expect, mock, test } from "bun:test";
import { dataOrThrow, invokeBridge } from "../src/features/conversations/api/bridge-client";

const originalBridgeUrl = process.env.NEXT_PUBLIC_ONEHARNESS_BRIDGE_URL;
const originalFetch = globalThis.fetch;

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
      return Response.json({ data: { conversations: [], kind: "list" }, ok: true });
    }) as typeof fetch;

    await expect(invokeBridge({ kind: "list" })).resolves.toEqual({
      data: { conversations: [], kind: "list" },
      ok: true,
    });
    expect(requests.map(({ url }) => url)).toEqual([
      "http://127.0.0.1:4317/session",
      "http://127.0.0.1:4317/invoke",
    ]);
    expect(requests.every(({ init }) => init?.credentials === "include")).toBe(true);
    expect(requests[1]?.init?.headers).toEqual({ "Content-Type": "application/json" });
  });

  test("uses the scoped Tauri sidecar transport", async () => {
    let exitCode = 0;
    mock.module("@tauri-apps/plugin-shell", () => ({
      Command: {
        sidecar: () => {
          const stdoutListeners: Array<(line: string) => void> = [];
          const stderrListeners: Array<(line: string) => void> = [];
          const closeListeners: Array<(event: { code: number }) => void> = [];
          return {
            on: (event: string, listener: (value: { code: number }) => void) => {
              if (event === "close") closeListeners.push(listener);
            },
            spawn: async () => ({
              write: async () => {
                if (exitCode === 0) {
                  for (const listener of stdoutListeners) {
                    listener(
                      JSON.stringify({ data: { conversations: [], kind: "list" }, ok: true }),
                    );
                  }
                } else {
                  for (const listener of stderrListeners) listener("bridge unavailable");
                }
                for (const listener of closeListeners) listener({ code: exitCode });
              },
            }),
            stderr: {
              on: (_event: string, listener: (line: string) => void) =>
                stderrListeners.push(listener),
            },
            stdout: {
              on: (_event: string, listener: (line: string) => void) =>
                stdoutListeners.push(listener),
            },
          };
        },
      },
    }));
    window.__TAURI_INTERNALS__ = {};
    const response = await invokeBridge({ kind: "list" });
    expect(response).toEqual({ data: { conversations: [], kind: "list" }, ok: true });
    exitCode = 1;
    await expect(invokeBridge({ kind: "list" })).rejects.toThrow("bridge unavailable");
  });
});
