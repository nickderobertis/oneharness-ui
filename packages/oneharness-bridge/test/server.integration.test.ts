import { afterEach, describe, expect, test } from "bun:test";
import { startServer } from "../src/server.ts";

const AUTHORIZATION = "oneharness-ui-server-authorization-token";
let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(async () => {
  await server?.stop(true);
  server = undefined;
});

function endpoint(): string {
  if (!server) throw new Error("test server was not started");
  return `http://127.0.0.1:${server.port}`;
}

describe("development HTTP bridge boundary", () => {
  test("requires its bearer capability before invoking the service", async () => {
    server = startServer(0, AUTHORIZATION);
    const missing = await fetch(`${endpoint()}/invoke`, {
      body: JSON.stringify({ kind: "list" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(missing.status).toBe(401);

    const wrong = await fetch(`${endpoint()}/invoke`, {
      body: JSON.stringify({ kind: "list" }),
      headers: {
        Authorization: "Bearer oneharness-ui-wrong-authorization-value",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    expect(wrong.status).toBe(401);
  });

  test("bounds the actual request stream and rejects malformed JSON", async () => {
    server = startServer(0, AUTHORIZATION);
    const malformed = await fetch(`${endpoint()}/invoke`, {
      body: "{",
      headers: { Authorization: `Bearer ${AUTHORIZATION}` },
      method: "POST",
    });
    expect(malformed.status).toBe(400);

    const oversized = await fetch(`${endpoint()}/invoke`, {
      body: JSON.stringify({ message: "x".repeat(70_000) }),
      headers: { Authorization: `Bearer ${AUTHORIZATION}` },
      method: "POST",
    });
    expect(oversized.status).toBe(413);
  });

  test("only permits loopback CORS origins", async () => {
    server = startServer(0, AUTHORIZATION);
    const permitted = await fetch(`${endpoint()}/health`, {
      headers: { Origin: "http://localhost:3000" },
    });
    expect(permitted.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");

    const rejected = await fetch(`${endpoint()}/health`, {
      headers: { Origin: "https://attacker.example" },
    });
    expect(rejected.headers.get("access-control-allow-origin")).toBe("null");
  });
});
