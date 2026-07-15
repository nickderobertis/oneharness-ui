import { afterEach, describe, expect, mock, test } from "bun:test";
import { dataOrThrow, invokeBridge } from "../src/features/conversations/api/bridge-client";

afterEach(() => {
  delete window.__TAURI_INTERNALS__;
});

describe("validated bridge client", () => {
  test("rejects non-success HTTP and bridge error responses", async () => {
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
    await expect(invokeBridge({ kind: "list" })).rejects.toThrow("HTTP 503");
    expect(() =>
      dataOrThrow({
        error: { code: "CONFIG_ERROR", detail: "/bad/config.toml", message: "Bad config" },
        ok: false,
      }),
    ).toThrow("Bad config");
  });

  test("uses the scoped Tauri sidecar transport", async () => {
    const stdoutListeners: Array<(line: string) => void> = [];
    const closeListeners: Array<(event: { code: number }) => void> = [];
    mock.module("@tauri-apps/plugin-shell", () => ({
      Command: {
        sidecar: () => ({
          on: (event: string, listener: (value: { code: number }) => void) => {
            if (event === "close") closeListeners.push(listener);
          },
          spawn: async () => ({
            write: async () => {
              for (const listener of stdoutListeners) {
                listener(JSON.stringify({ data: { conversations: [], kind: "list" }, ok: true }));
              }
              for (const listener of closeListeners) listener({ code: 0 });
            },
          }),
          stderr: { on: () => undefined },
          stdout: {
            on: (_event: string, listener: (line: string) => void) =>
              stdoutListeners.push(listener),
          },
        }),
      },
    }));
    window.__TAURI_INTERNALS__ = {};
    const response = await invokeBridge({ kind: "list" });
    expect(response).toEqual({ data: { conversations: [], kind: "list" }, ok: true });
  });
});
