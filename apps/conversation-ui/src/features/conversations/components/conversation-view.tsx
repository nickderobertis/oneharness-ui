"use client";

import type { Conversation } from "@oneharness-ui/ipc-contract";
import { useEffect, useRef } from "react";
import { useInfiniteScroll } from "../hooks/use-infinite-scroll";
import { ReplyForm } from "./reply-form";
import { StatusBadge } from "./status-badge";
import { TurnCard } from "./turn-card";

function ConversationTitle({ name }: { name: string }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);
  return (
    <h1 ref={title} tabIndex={-1}>
      {name}
    </h1>
  );
}

export function ConversationView({
  conversation,
  continueError,
  hasMoreTurns,
  loadMoreTurnsError,
  loadingMoreTurns,
  onContinue,
  onLoadMoreTurns,
  pending,
  totalTurnCount,
}: {
  conversation: Conversation;
  continueError: Error | null;
  hasMoreTurns: boolean;
  loadMoreTurnsError: Error | null;
  loadingMoreTurns: boolean;
  onContinue: (message: string) => Promise<void>;
  onLoadMoreTurns: () => Promise<unknown>;
  pending: boolean;
  totalTurnCount: number;
}) {
  const state = pending ? "running" : conversation.state;
  const infiniteScroll = useInfiniteScroll({
    automatic: loadMoreTurnsError === null,
    hasMore: hasMoreTurns,
    loadedCount: conversation.turns.length,
    loading: loadingMoreTurns,
    onLoadMore: onLoadMoreTurns,
  });
  return (
    <main className="conversation-pane">
      <header className="conversation-header">
        <div>
          <p className="eyebrow">{conversation.harnesses.join(" · ")}</p>
          <ConversationTitle key={conversation.id} name={conversation.name} />
          <p className="project-path" title={conversation.project}>
            {conversation.project}
          </p>
        </div>
        <StatusBadge state={state} />
      </header>
      <section
        aria-busy={loadingMoreTurns}
        aria-label="Conversation turns"
        className="turns"
        ref={infiniteScroll.rootRef}
      >
        <p
          aria-label={`${conversation.turns.length} of ${totalTurnCount} turns loaded`}
          className="turns__count"
          role="status"
        >
          {conversation.turns.length < totalTurnCount
            ? `${conversation.turns.length} of ${totalTurnCount}`
            : conversation.turns.length}
        </p>
        {conversation.turns.map((turn) => (
          <TurnCard key={turn.id} turn={turn} />
        ))}
        <div className="pagination">
          {hasMoreTurns ? (
            <button
              className="load-more"
              disabled={loadingMoreTurns}
              onClick={infiniteScroll.loadMore}
              type="button"
            >
              {loadingMoreTurns
                ? "Loading more turns…"
                : loadMoreTurnsError
                  ? "Retry loading turns"
                  : "Load more turns"}
            </button>
          ) : (
            <p className="pagination__status" role="status">
              All {totalTurnCount} turns loaded
            </p>
          )}
          {loadMoreTurnsError ? (
            <p className="pagination__error" role="alert">
              Couldn’t load more turns. {loadMoreTurnsError.message}
            </p>
          ) : null}
          <div
            aria-hidden="true"
            className="pagination__sentinel"
            ref={infiniteScroll.sentinelRef}
          />
        </div>
      </section>
      <footer className="composer-area">
        {conversation.canContinue ? (
          <ReplyForm error={continueError} onSubmit={onContinue} pending={pending} />
        ) : (
          <div className="ineligible" role="note">
            <strong>This session can’t be continued.</strong>
            <span>The harness did not save an eligible native session handle.</span>
          </div>
        )}
      </footer>
    </main>
  );
}
