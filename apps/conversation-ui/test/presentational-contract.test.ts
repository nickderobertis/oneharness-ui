import { describe, expect, test } from "bun:test";
import {
  conversationLabelMaxLength,
  conversationLabelsMaxCount,
  conversationLabelsSchema,
  toolEventSchema,
} from "@oneharness-ui/ipc-contract";
import { conversationLabelLimits } from "@/features/conversations";
import type { ConversationToolEvent } from "../src/features/conversations/presentational-types";

describe("presentational contract drift gates", () => {
  test("keeps label editor limits aligned with the validated bridge contract", () => {
    expect(conversationLabelLimits).toEqual({
      maxCount: conversationLabelsMaxCount,
      maxLength: conversationLabelMaxLength,
    });
    expect(
      conversationLabelsSchema.safeParse(
        Array.from({ length: conversationLabelLimits.maxCount }, (_, index) =>
          String(index).padEnd(conversationLabelLimits.maxLength, "x"),
        ),
      ).success,
    ).toBe(true);
  });

  test("hands every validated tool timing field to the presentational tool event", () => {
    const validated = toolEventSchema.parse({
      durationMs: 240,
      finishedAt: "2026-07-15T10:00:01Z",
      index: 0,
      input: { command: "pwd" },
      kind: "tool_call",
      name: "Bash",
      output: null,
      startedAt: "2026-07-15T10:00:00Z",
      status: "completed",
      timingSource: "provider_measured",
      toolCallId: "call-1",
    });
    const presentational: ConversationToolEvent = validated;
    expect(presentational).toEqual(validated);

    const unmeasured: ConversationToolEvent = toolEventSchema.parse({
      index: 1,
      kind: "tool_result",
      output: "/repo",
    });
    expect(Object.hasOwn(unmeasured, "durationMs")).toBe(false);
    expect(Object.hasOwn(unmeasured, "status")).toBe(false);
  });
});
