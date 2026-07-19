import { describe, expect, test } from "bun:test";
import { bridgeRequestSchema, bridgeResponseSchema, usageSchema } from "../src/index.ts";

describe("IPC validation", () => {
  test("round-trips labels while omitting empty backward-compatible summaries", () => {
    const base = {
      harnesses: ["codex"],
      id: "session-1",
      name: "Session",
      project: "/project",
      startedAt: "2026-07-19T00:00:00Z",
      turnCount: 1,
    };
    const response = bridgeResponseSchema.parse({
      data: {
        conversations: [base, { ...base, id: "session-2", labels: ["urgent"] }],
        kind: "list",
        nextCursor: null,
        totalCount: 2,
      },
      ok: true,
    });
    expect(response).toEqual({
      data: {
        conversations: [base, { ...base, id: "session-2", labels: ["urgent"] }],
        kind: "list",
        nextCursor: null,
        totalCount: 2,
      },
      ok: true,
    });
    expect(JSON.stringify(response)).not.toContain('"labels":[]');
  });

  test("accepts zero usage while preserving absent and null", () => {
    expect(usageSchema.parse({ inputTokens: 0 })).toEqual({ inputTokens: 0 });
    expect(usageSchema.parse({ inputTokens: null })).toEqual({ inputTokens: null });
    expect(usageSchema.parse({})).toEqual({});
  });

  test("rejects unsafe selectors and blank continuation messages", () => {
    expect(() => bridgeRequestSchema.parse({ kind: "get", sessionId: "../secret" })).toThrow();
    expect(() =>
      bridgeRequestSchema.parse({ kind: "continue", sessionId: "valid", message: "  " }),
    ).toThrow();
    expect(() =>
      bridgeRequestSchema.parse({
        cursor: { sessionId: "../secret", startedAt: "2026-07-15T00:00:00Z" },
        kind: "list",
      }),
    ).toThrow();
    expect(() =>
      bridgeRequestSchema.parse({ kind: "get", sessionId: "valid", turnOffset: -1 }),
    ).toThrow();
    expect(() =>
      bridgeRequestSchema.parse({
        kind: "set-labels",
        labels: ["<b>".repeat(40)],
        sessionId: "valid",
      }),
    ).toThrow();
  });

  test("keeps unknown upstream structured values as data", () => {
    const response = bridgeResponseSchema.parse({
      ok: true,
      data: {
        kind: "get",
        conversation: {
          id: "session-1",
          name: "Session",
          project: "/project",
          startedAt: "2026-07-15T00:00:00Z",
          state: "future-state",
          canContinue: false,
          harnesses: ["future-harness"],
          nextTurnOffset: null,
          turns: [
            {
              id: "session-1-0",
              user: "hello",
              assistant: null,
              reasoning: null,
              status: "future-state",
              failureKind: null,
              timestamp: "2026-07-15T00:00:00Z",
              harness: "future-harness",
              model: null,
              tools: [],
              usage: {},
              unknown: { future: { nested: true } },
            },
          ],
          totalTurnCount: 1,
        },
      },
    });
    expect(response.ok && response.data.kind === "get" && response.data.conversation.state).toBe(
      "future-state",
    );
  });
});
