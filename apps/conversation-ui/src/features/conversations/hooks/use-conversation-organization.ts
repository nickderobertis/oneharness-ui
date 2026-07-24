import type { ConversationSummary } from "@oneharness/ui";
import { useMemo, useState } from "react";

export const conversationGroupingOptions = [
  { label: "Recent", value: "none" },
  { label: "Label", value: "label" },
  { label: "Project", value: "project" },
] as const;
export type ConversationGrouping = (typeof conversationGroupingOptions)[number]["value"];

export function useConversationOrganization(conversations: ConversationSummary[]) {
  const [grouping, setGrouping] = useState<ConversationGrouping>("none");
  const [filter, setFilter] = useState("all");
  const choices = useMemo(() => {
    const values = new Set<string>();
    for (const conversation of conversations) {
      const labels = conversation.labels ?? [];
      if (grouping === "project") values.add(conversation.project || "Project not recorded");
      if (grouping === "label") {
        for (const label of labels) values.add(label);
        if (labels.length === 0) values.add("Unlabeled");
      }
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [conversations, grouping]);
  const grouped = useMemo(() => {
    const result = new Map<string, ConversationSummary[]>();
    for (const conversation of conversations) {
      const labels = conversation.labels ?? [];
      const groups =
        grouping === "project"
          ? [conversation.project || "Project not recorded"]
          : grouping === "label"
            ? labels.length > 0
              ? labels
              : ["Unlabeled"]
            : ["History"];
      for (const group of groups) {
        if (filter !== "all" && group !== filter) continue;
        result.set(group, [...(result.get(group) ?? []), conversation]);
      }
    }
    return result;
  }, [conversations, filter, grouping]);
  return {
    choices,
    filter,
    grouped,
    grouping,
    setFilter,
    setGrouping,
  };
}
