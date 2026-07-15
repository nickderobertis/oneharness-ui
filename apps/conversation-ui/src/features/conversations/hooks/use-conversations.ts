"use client";

import type { Conversation } from "@oneharness-ui/ipc-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dataOrThrow, invokeBridge } from "../api/bridge-client";

export const conversationKeys = {
  all: ["conversations"] as const,
  detail: (id: string) => ["conversations", id] as const,
};

export function useConversationList() {
  return useQuery({
    queryFn: async () => {
      const data = dataOrThrow(await invokeBridge({ kind: "list" }));
      if (data.kind !== "list") throw new Error("Local bridge returned the wrong response");
      return data.conversations;
    },
    queryKey: conversationKeys.all,
  });
}

export function useConversation(sessionId: string | null) {
  return useQuery({
    enabled: Boolean(sessionId),
    queryFn: async () => {
      if (!sessionId) throw new Error("A conversation must be selected");
      const data = dataOrThrow(await invokeBridge({ kind: "get", sessionId }));
      if (data.kind !== "get") throw new Error("Local bridge returned the wrong response");
      return data.conversation;
    },
    queryKey: conversationKeys.detail(sessionId ?? "none"),
  });
}

export function useContinueConversation(onSelected: (id: string) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ message, sessionId }: { message: string; sessionId: string }) => {
      const data = dataOrThrow(await invokeBridge({ kind: "continue", message, sessionId }));
      if (data.kind !== "continue") throw new Error("Local bridge returned the wrong response");
      return data;
    },
    onSuccess: async ({ conversation, selectedSessionId }) => {
      client.setQueryData<Conversation>(conversationKeys.detail(selectedSessionId), conversation);
      onSelected(selectedSessionId);
      await client.invalidateQueries({ exact: true, queryKey: conversationKeys.all });
    },
  });
}
