import { describe, expect, test } from "bun:test";
import type {
  Conversation,
  ConversationTurn,
} from "../src/features/conversations/presentational-types";

const baseTurn: ConversationTurn = {
  assistant: "done",
  failureKind: null,
  harness: "codex",
  id: "turn-1",
  model: "gpt",
  reasoning: null,
  status: "completed",
  timestamp: "2026-08-03T10:00:00.000Z",
  tools: [],
  unknown: {},
  usage: {},
  user: "work",
};

import { conversationTimeline } from "../src/features/conversations/conversation-timeline";

const base: Conversation = {
  canContinue: false,
  harnesses: ["codex"],
  id: "session",
  name: "Timeline fixture",
  project: "/workspace",
  startedAt: "2026-08-03T10:00:00.000Z",
  state: "completed",
  turns: [baseTurn],
};

describe("conversationTimeline", () => {
  test("uses recorded turn, phase, and tool timing", () => {
    const conversation: Conversation = {
      ...base,
      turns: [
        {
          ...baseTurn,
          durationMs: 10_000,
          modelMs: 6_000,
          timeToFirstTokenMs: 800,
          toolMs: 4_000,
          tools: [
            {
              durationMs: 2_000,
              index: 0,
              kind: "tool_call",
              name: "Bash",
              startedAt: "2026-08-03T10:00:06.000Z",
              status: "completed",
            },
          ],
        },
      ],
    };
    const { items, lanes, markers, origin } = conversationTimeline(conversation);
    expect(
      items.map(({ duration, kind, laneId, parent }) => ({ duration, kind, laneId, parent })),
    ).toEqual([
      { duration: 10_000, kind: "turn", laneId: "turns", parent: undefined },
      { duration: 6_000, kind: "model phase", laneId: "phases", parent: "turn-1" },
      { duration: 4_000, kind: "tools phase", laneId: "phases", parent: "turn-1" },
      { duration: 2_000, kind: "tool_call", laneId: "tools", parent: "turn-1" },
    ]);
    expect(lanes.map((lane) => lane.id)).toEqual(["turns", "phases", "tools"]);
    expect(markers).toEqual([
      {
        at: Date.parse("2026-08-03T10:00:00.800Z"),
        id: "turn-1-first-token",
        label: "First token",
        payload: { turn: conversation.turns[0] as ConversationTurn, type: "milestone" },
        status: "completed",
      },
    ]);
    expect(origin).toBe(Date.parse(conversation.startedAt));
  });

  test("keeps absent timing as points instead of inventing duration", () => {
    const conversation: Conversation = {
      ...base,
      turns: [{ ...baseTurn, tools: [{ index: 0, kind: "tool_call", name: "Unknown clock" }] }],
    };
    const { items, lanes, markers } = conversationTimeline(conversation);
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.duration === undefined && item.end === undefined)).toBe(true);
    expect(lanes.map((lane) => lane.id)).toEqual(["turns", "tools"]);
    expect(markers).toEqual([]);
  });
});
