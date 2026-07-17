"use client";

import type {
  BridgeResponse,
  Conversation,
  ConversationCursor,
  ConversationPage,
  ConversationSummary,
} from "@oneharness-ui/ipc-contract";
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { dataOrThrow, invokeBridge } from "../api/bridge-client";

export const conversationKeys = {
  all: ["conversations"] as const,
  detail: (id: string) => ["conversations", id] as const,
};

type SuccessfulBridgeData = Extract<BridgeResponse, { ok: true }>["data"];
type ConversationListPage = Extract<SuccessfulBridgeData, { kind: "list" }>;
type ConversationListData = {
  conversations: ConversationSummary[];
  totalCount: number;
};

export function useConversationList() {
  const client = useQueryClient();
  const query = useInfiniteQuery<
    ConversationListPage,
    Error,
    ConversationListData,
    typeof conversationKeys.all,
    ConversationCursor | undefined
  >({
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    initialPageParam: undefined as ConversationCursor | undefined,
    queryFn: async ({ pageParam }) => {
      const data = dataOrThrow(
        await invokeBridge({
          ...(pageParam ? { cursor: pageParam } : {}),
          kind: "list",
        }),
      );
      if (data.kind !== "list") throw new Error("Local bridge returned the wrong response");
      return data;
    },
    queryKey: conversationKeys.all,
    select: (data) => ({
      conversations: data.pages.flatMap((page) => page.conversations),
      totalCount: data.pages.at(-1)?.totalCount ?? 0,
    }),
  });
  return {
    ...query,
    refresh: async () => {
      await client.resetQueries({ exact: true, queryKey: conversationKeys.all });
    },
  };
}

export function useConversation(sessionId: string | null) {
  return useInfiniteQuery<
    ConversationPage,
    Error,
    Conversation,
    ReturnType<(typeof conversationKeys)["detail"]>,
    number
  >({
    enabled: Boolean(sessionId),
    getNextPageParam: (page) => page.nextTurnOffset ?? undefined,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (!sessionId) throw new Error("A conversation must be selected");
      const data = dataOrThrow(
        await invokeBridge({
          kind: "get",
          sessionId,
          ...(pageParam > 0 ? { turnOffset: pageParam } : {}),
        }),
      );
      if (data.kind !== "get") throw new Error("Local bridge returned the wrong response");
      return data.conversation;
    },
    queryKey: conversationKeys.detail(sessionId ?? "none"),
    select: (data): Conversation => {
      const first = data.pages[0];
      if (!first) throw new Error("Local bridge returned no conversation pages");
      return {
        ...first,
        turns: data.pages.flatMap((page) => page.turns),
      };
    },
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
      client.setQueryData<InfiniteData<ConversationPage, number>>(
        conversationKeys.detail(selectedSessionId),
        { pageParams: [0], pages: [conversation] },
      );
      onSelected(selectedSessionId);
      await client.resetQueries({ exact: true, queryKey: conversationKeys.all });
    },
  });
}
