import type { ConversationSummary } from "@oneharness-ui/ipc-contract";
import { useState } from "react";

export function useLabelEditor(onSetLabels: (id: string, labels: string[]) => Promise<unknown>) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState("");

  function openEditor(conversation: ConversationSummary) {
    setEditingId(conversation.id);
    setLabelInput((conversation.labels ?? []).join(", "));
  }

  function closeEditor() {
    setEditingId(null);
  }

  async function saveLabels(sessionId: string) {
    const labels = labelInput
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    await onSetLabels(sessionId, labels);
    closeEditor();
  }

  return { closeEditor, editingId, labelInput, openEditor, saveLabels, setLabelInput };
}
