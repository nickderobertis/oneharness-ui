import {
  type ConversationSummary,
  conversationLabelMaxLength,
  conversationLabelsMaxCount,
} from "@oneharness/ui";
import { useState } from "react";

export function useLabelEditor(onSetLabels: (id: string, labels: string[]) => Promise<unknown>) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function openEditor(conversation: ConversationSummary) {
    setEditingId(conversation.id);
    setLabelInput((conversation.labels ?? []).join(", "));
    setValidationError(null);
  }

  function closeEditor() {
    setEditingId(null);
  }

  async function saveLabels(sessionId: string) {
    const labels = labelInput
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (
      labels.length > conversationLabelsMaxCount ||
      labels.some((label) => label.length > conversationLabelMaxLength)
    ) {
      setValidationError(
        `Use no more than ${conversationLabelsMaxCount} labels, with at most ${conversationLabelMaxLength} characters each.`,
      );
      return;
    }
    setValidationError(null);
    await onSetLabels(sessionId, labels);
    closeEditor();
  }

  return {
    closeEditor,
    editingId,
    labelInput,
    openEditor,
    saveLabels,
    setLabelInput,
    validationError,
  };
}
