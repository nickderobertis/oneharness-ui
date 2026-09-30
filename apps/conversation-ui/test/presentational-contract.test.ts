import { describe, expect, test } from "bun:test";
import type {
  ConversationAgentEvent as IpcConversationAgentEvent,
  ConversationSummary as IpcConversationSummary,
  ConversationToolEvent as IpcConversationToolEvent,
  ConversationTurn as IpcConversationTurn,
} from "@oneharness-ui/ipc-contract";
import {
  conversationLabelMaxLength,
  conversationLabelsMaxCount,
  conversationLabelsSchema,
  toolEventSchema,
} from "@oneharness-ui/ipc-contract";
import { conversationLabelLimits } from "@/features/conversations";
import type {
  ConversationAgentEvent,
  ConversationSummary,
  ConversationToolEvent,
  ConversationTurn,
} from "../src/features/conversations/presentational-types";

type ExactType<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;

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
    const toolEventTypesMatchExactly: ExactType<ConversationToolEvent, IpcConversationToolEvent> =
      true;
    expect(toolEventTypesMatchExactly).toBe(true);
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

  test("hands the agent's messages, reasoning and running state to presentation unchanged", () => {
    const agentEventTypesMatchExactly: ExactType<
      ConversationAgentEvent,
      IpcConversationAgentEvent
    > = true;
    const narrationFieldMatchesExactly: ExactType<
      Pick<ConversationTurn, "agentEvents">,
      Pick<IpcConversationTurn, "agentEvents">
    > = true;
    const runningFieldMatchesExactly: ExactType<
      Pick<ConversationSummary, "running">,
      Pick<IpcConversationSummary, "running">
    > = true;
    expect([
      agentEventTypesMatchExactly,
      narrationFieldMatchesExactly,
      runningFieldMatchesExactly,
    ]).toEqual([true, true, true]);
  });

  test("keeps the presentational turn aligned with every validated timing field", () => {
    type TimingFields =
      | "durationMs"
      | "finishedAt"
      | "modelMs"
      | "startedAt"
      | "timeToFirstTokenMs"
      | "toolMs";
    const turnTimingTypesMatchExactly: ExactType<
      Pick<ConversationTurn, TimingFields>,
      Pick<IpcConversationTurn, TimingFields>
    > = true;
    expect(turnTimingTypesMatchExactly).toBe(true);
  });
});
