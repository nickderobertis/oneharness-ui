"use client";

import { useState } from "react";
import { Timeline } from "@/components/timeline";
import { conversationTimeline } from "../conversation-timeline";
import type { Conversation, ConversationFocus } from "../presentational-types";
import { pairToolEvents } from "../tool-invocations";

export interface ConversationTimelineProps {
  cursor?: number;
  focus?: ConversationFocus;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onSelectTurn: (id: string) => void;
  selectedTurnId?: string;
  turns: Conversation["turns"];
}

export function ConversationTimeline({
  cursor,
  focus,
  expanded,
  onExpandedChange,
  onSelectTurn,
  selectedTurnId,
  turns,
}: ConversationTimelineProps) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const renderedExpanded = expanded ?? internalExpanded;
  const timeline = conversationTimeline({ turns });
  const focusedTurn = turns.find((turn) => turn.id === focus?.turnId);
  const focusedTool =
    focusedTurn && focus
      ? pairToolEvents(focusedTurn.tools).find((invocation) =>
          focus.toolCallId !== undefined
            ? invocation.toolCallId === focus.toolCallId
            : focus.eventIndex !== undefined && invocation.eventIndices.includes(focus.eventIndex),
        )
      : undefined;
  const focusedItem = focus
    ? timeline.items.find(
        (item) =>
          item.turnId === focus.turnId &&
          item.id === (focusedTool ? `${focus.turnId}-${focusedTool.id}` : focus.turnId),
      )
    : undefined;
  return (
    <Timeline
      {...(cursor === undefined ? {} : { cursor })}
      expanded={focus ? true : renderedExpanded}
      onExpandedChange={(value) => {
        if (expanded === undefined) setInternalExpanded(value);
        onExpandedChange?.(value);
      }}
      getFailureExcerpt={(item) => item.payload.turn.failureKind}
      items={timeline.items}
      label="Conversation timeline"
      lanes={timeline.lanes}
      markers={timeline.markers}
      onSelect={(entry) => onSelectTurn(entry.payload.turn.id)}
      {...(focusedItem
        ? { selectedId: focusedItem.id }
        : selectedTurnId
          ? { selectedId: selectedTurnId }
          : {})}
    />
  );
}
