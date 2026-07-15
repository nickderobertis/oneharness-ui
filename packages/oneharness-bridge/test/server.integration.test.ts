import { afterEach, describe, expect, test } from "bun:test";
import { startServer } from "../src/server.ts";

const AUTHORIZATION = "oneharness-ui-server-authorization-token";
const UI_ORIGIN = "http://127.0.0.1:3000";
let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(async () => {
  await server?.stop(true);
  server = undefined;
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
});
