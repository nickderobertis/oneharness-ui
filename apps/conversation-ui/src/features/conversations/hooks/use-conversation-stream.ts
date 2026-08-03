"use client";

import type {
  BridgeStreamFrame,
  ConversationPage,
  ConversationTurn,
} from "@oneharness-ui/ipc-contract";
import { type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BridgeError, watchBridge } from "../api/bridge-client";
import { conversationKeys } from "./use-conversations";

/// How often the reader falls back to re-reading the whole conversation when
/// the live stream is unavailable.
export const CONVERSATION_POLL_INTERVAL_MS = 2_000;

type ConversationCache = InfiniteData<ConversationPage, number>;

function withTurn(current: ConversationCache | undefined, turn: ConversationTurn) {
  if (!current) return current;
  const known = current.pages.some((page) => page.turns.some(({ id }) => id === turn.id));
  const lastPage = current.pages.length - 1;
  return {
    ...current,
    pages: current.pages.map((page, index) => ({
      ...page,
      // The closing record supersedes whatever the stream showed for that turn;
      // a genuinely new turn extends both the newest page and the total.
      ...(index === 0 && !known ? { totalTurnCount: page.totalTurnCount + 1 } : {}),
      turns: known
        ? page.turns.map((existing) => (existing.id === turn.id ? turn : existing))
        : index === lastPage
          ? [...page.turns, turn]
          : page.turns,
    })),
  };
}

function withToolEvent(
  current: ConversationCache | undefined,
  turnId: string,
  tool: ConversationTurn["tools"][number],
) {
  if (!current) return current;
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      turns: page.turns.map((turn) =>
        turn.id === turnId &&
        !turn.tools.some((known) => known.index === tool.index && known.kind === tool.kind)
          ? { ...turn, tools: [...turn.tools, tool] }
          : turn,
      ),
    })),
  };
}

/// Follow the selected conversation while it is on screen. Frames land in the
/// same cache the paged reader uses, so the view simply re-renders as its turns
/// and tool events grow.
// llmlint: ignore-block[changed_behavior_has_e2e] The acceptance contract explicitly permits a component test: conversation-shell.test.tsx renders and drives the public UI while recorded NDJSON-equivalent frames add turns/tool events and prove polling recovery; server/web/native integration suites separately drive the real transport boundaries.
export function useConversationStream(sessionId: string | null, enabled: boolean) {
  const client = useQueryClient();
  const [live, setLive] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!sessionId || !enabled) return;
    const controller = new AbortController();
    const key = conversationKeys.detail(sessionId);
    const fallBackToPolling = (cause: Error) => {
      setLive(false);
      setError(cause);
      // Do not make the reader wait for the first polling interval after a
      // dropped stream. Refresh once immediately, then let the interval keep
      // it current while live updates remain unavailable.
      void client.refetchQueries({ exact: true, queryKey: key, type: "active" });
    };
    const apply = (frame: BridgeStreamFrame) => {
      if (frame.kind === "opened") {
        setLive(true);
        return;
      }
      if (frame.kind === "error") {
        fallBackToPolling(
          new BridgeError(frame.error.message, frame.error.code, frame.error.detail),
        );
        return;
      }
      if (frame.kind === "turn") {
        client.setQueryData<ConversationCache>(key, (current) => withTurn(current, frame.turn));
        return;
      }
      client.setQueryData<ConversationCache>(key, (current) =>
        withToolEvent(current, frame.turnId, frame.tool),
      );
    };
    setError(null);
    watchBridge({ kind: "watch", sessionId }, apply, controller.signal)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        fallBackToPolling(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLive(false);
      });
    return () => {
      controller.abort();
      setLive(false);
    };
  }, [client, enabled, sessionId]);

  return { error, live };
}
// llmlint: ignore-end[changed_behavior_has_e2e]
