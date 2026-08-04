import type { TimelineItem, TimelineLane, TimelineMarker } from "../../components/timeline";
import type { Conversation, ConversationTurn } from "./presentational-types";
import { pairToolEvents } from "./tool-invocations";

export type ConversationTimelinePayload =
  | { type: "milestone"; turn: ConversationTurn }
  | { type: "phase"; turn: ConversationTurn }
  | { type: "tool"; turn: ConversationTurn }
  | { type: "turn"; turn: ConversationTurn };

export interface ConversationTimeline {
  items: TimelineItem<ConversationTimelinePayload>[];
  lanes: TimelineLane[];
  markers: TimelineMarker<ConversationTimelinePayload>[];
  origin?: number;
}

/** Rendered in this order when expanded; lanes without recorded items are omitted. */
const conversationLanes: readonly TimelineLane[] = [
  { id: "turns", label: "Turns" },
  { id: "phases", label: "Phases" },
  { id: "tools", label: "Tools" },
];

function instant(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function reported(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function conversationTimeline(
  conversation: Pick<Conversation, "turns"> & Partial<Pick<Conversation, "startedAt">>,
): ConversationTimeline {
  const items: TimelineItem<ConversationTimelinePayload>[] = [];
  const markers: TimelineMarker<ConversationTimelinePayload>[] = [];
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
      laneId: "turns",
      payload: { turn, type: "turn" },
      start,
      status: turn.status,
    });

    const phases: ReadonlyArray<readonly [string, number | null | undefined]> = [
      ["model", turn.modelMs],
      ["tools", turn.toolMs],
    ];
    let phaseStart = start;
    for (const [kind, value] of phases) {
      const phaseDuration = reported(value);
      if (phaseDuration === undefined) continue;
      items.push({
        duration: phaseDuration,
        id: `${turn.id}-phase-${kind}`,
        kind: `${kind} phase`,
        label: `${kind === "model" ? "Model" : "Tool"} time`,
        laneId: "phases",
        parent: turn.id,
        payload: { turn, type: "phase" },
        start: phaseStart,
        status: turn.status,
      });
      phaseStart += phaseDuration;
    }
    const firstToken = reported(turn.timeToFirstTokenMs);
    if (firstToken !== undefined) {
      markers.push({
        at: start + firstToken,
        id: `${turn.id}-first-token`,
        label: "First token",
        payload: { turn, type: "milestone" },
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
        laneId: "tools",
        parent: turn.id,
        payload: { turn, type: "tool" },
        start: invocationStart,
        status: invocation.status,
      });
    }
  }
  const origin = instant(conversation.startedAt);
  return {
    items,
    lanes: conversationLanes.filter((lane) => items.some((item) => item.laneId === lane.id)),
    markers,
    ...(origin === null ? {} : { origin }),
  };
}
