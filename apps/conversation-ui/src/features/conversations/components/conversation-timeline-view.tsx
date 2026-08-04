"use client";

import { useState } from "react";
import { Timeline } from "@/components/timeline";
import { conversationTimeline } from "../conversation-timeline";
import type { Conversation } from "../presentational-types";

export interface ConversationTimelineProps {
  cursor?: number;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onSelectTurn: (id: string) => void;
  selectedTurnId?: string;
  turns: Conversation["turns"];
}

export function ConversationTimeline({
  cursor,
  expanded,
  onExpandedChange,
  onSelectTurn,
  selectedTurnId,
  turns,
}: ConversationTimelineProps) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const renderedExpanded = expanded ?? internalExpanded;
  const timeline = conversationTimeline({ turns });
  return (
    <Timeline
      {...(cursor === undefined ? {} : { cursor })}
      expanded={renderedExpanded}
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
      {...(selectedTurnId ? { selectedId: selectedTurnId } : {})}
    />
  );
}
