import type { ConversationSummary } from "@oneharness-ui/ipc-contract";
import { useMemo, useState } from "react";

export type ConversationGrouping = "none" | "label" | "project";

export function useConversationOrganization(conversations: ConversationSummary[]) {
  const [grouping, setGrouping] = useState<ConversationGrouping>("none");
  const [filter, setFilter] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState("");
  const choices = useMemo(() => {
    const values = new Set<string>();
    for (const conversation of conversations) {
      if (grouping === "project") values.add(conversation.project || "Project not recorded");
      if (grouping === "label") {
        for (const label of conversation.labels) values.add(label);
        if (conversation.labels.length === 0) values.add("Unlabeled");
      }
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [conversations, grouping]);
  const grouped = useMemo(() => {
    const result = new Map<string, ConversationSummary[]>();
    for (const conversation of conversations) {
      const groups =
        grouping === "project"
          ? [conversation.project || "Project not recorded"]
          : grouping === "label"
            ? conversation.labels.length > 0
              ? conversation.labels
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
    editingId,
    filter,
    grouped,
    grouping,
    labelInput,
    setEditingId,
    setFilter,
    setGrouping,
    setLabelInput,
  };
}
