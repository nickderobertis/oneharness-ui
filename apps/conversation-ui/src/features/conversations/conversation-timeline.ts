import type { TimelineItem } from "../../components/timeline";
import type { Conversation, ConversationTurn } from "./presentational-types";
import { pairToolEvents } from "./tool-invocations";

export type ConversationTimelinePayload =
  | { type: "phase"; turn: ConversationTurn }
  | { type: "tool"; turn: ConversationTurn }
  | { type: "turn"; turn: ConversationTurn };

function instant(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function reported(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function conversationTimelineItems(
  conversation: Conversation,
): TimelineItem<ConversationTimelinePayload>[] {
  const items: TimelineItem<ConversationTimelinePayload>[] = [];
  for (const turn of conversation.turns) {
    const start = instant(turn.startedAt) ?? instant(turn.timestamp);
    if (start === null) continue;
    const duration = reported(turn.durationMs);
    const finished = instant(turn.finishedAt);
    items.push({
      ...(duration !== undefined ? { duration } : finished !== null ? { end: finished } : {}),
      id: turn.id,
      kind: "turn",
      label: `${turn.harness} turn`,
      payload: { turn, type: "turn" },
      start,
      status: turn.status,
    });

    const phases = [
      ["model", turn.modelMs],
      ["tools", turn.toolMs],
    ] as const;
    let phaseStart = start;
    for (const [kind, value] of phases) {
      const phaseDuration = reported(value);
      if (phaseDuration === undefined) continue;
      items.push({
        duration: phaseDuration,
        id: `${turn.id}-phase-${kind}`,
        kind: `${kind} phase`,
        label: `${kind === "model" ? "Model" : "Tool"} time`,
        parent: turn.id,
        payload: { turn, type: "phase" },
        start: phaseStart,
        status: turn.status,
      });
      phaseStart += phaseDuration;
    }
    const firstToken = reported(turn.timeToFirstTokenMs);
    if (firstToken !== undefined) {
      items.push({
        id: `${turn.id}-first-token`,
        kind: "first token",
        label: "First token",
        parent: turn.id,
        payload: { turn, type: "phase" },
        start: start + firstToken,
        status: turn.status,
      });
    }

    for (const invocation of pairToolEvents(turn.tools)) {
      const invocationStart = instant(invocation.startedAt) ?? start;
      const invocationDuration = reported(invocation.durationMs);
      const invocationEnd = instant(invocation.finishedAt);
      items.push({
        ...(invocationDuration !== undefined
          ? { duration: invocationDuration }
          : invocationEnd !== null
            ? { end: invocationEnd }
            : {}),
        id: `${turn.id}-${invocation.id}`,
        kind: invocation.kind,
        label: invocation.name,
        parent: turn.id,
        payload: { turn, type: "tool" },
        start: invocationStart,
        status: invocation.status,
      });
    }
  }
  return items;
}
