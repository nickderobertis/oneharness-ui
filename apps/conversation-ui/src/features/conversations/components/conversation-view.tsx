"use client";

import type { Conversation } from "@oneharness-ui/ipc-contract";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useInfiniteScroll } from "../hooks/use-infinite-scroll";
import { ReplyForm } from "./reply-form";
import { StatusBadge } from "./status-badge";
import { TurnCard } from "./turn-card";

function ConversationTitle({ name }: { name: string }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);
  return (
    <h1
      className="my-1 text-xl font-semibold tracking-[-.025em] focus:outline-none"
      ref={title}
      tabIndex={-1}
    >
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
  onBack,
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
  onBack: () => void;
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
    <main className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden max-[680px]:h-dvh">
      <header className="relative z-2 flex min-h-[86px] items-center justify-between gap-3 border-b bg-background/90 px-[clamp(16px,5vw,70px)] py-3.5 backdrop-blur">
        <Button
          aria-label="Back to conversations"
          className="hidden shrink-0 max-[680px]:inline-flex"
          onClick={onBack}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[10px] font-bold uppercase tracking-[.13em] text-primary">
            {conversation.harnesses.join(" · ")}
          </p>
          <ConversationTitle key={conversation.id} name={conversation.name} />
          <p
            className="m-0 max-w-[50vw] truncate font-mono text-[10px] text-subtle max-[680px]:max-w-full"
            title={conversation.project}
          >
            {conversation.project}
          </p>
        </div>
        <StatusBadge state={state} />
      </header>
      <section
        aria-busy={loadingMoreTurns}
        aria-label="Conversation turns"
        className="min-h-0 overflow-x-hidden overflow-y-auto px-[clamp(16px,7vw,94px)] pb-14 pt-9"
        ref={infiniteScroll.rootRef}
      >
        <p
          aria-label={`${conversation.turns.length} of ${totalTurnCount} turns loaded`}
          className="mx-auto mb-5 max-w-[850px] text-right text-[10px] text-subtle"
          role="status"
        >
          {conversation.turns.length < totalTurnCount
            ? `${conversation.turns.length} of ${totalTurnCount}`
            : conversation.turns.length}
        </p>
        {conversation.turns.map((turn) => (
          <TurnCard key={turn.id} turn={turn} />
        ))}
        <div className="mx-auto max-w-[850px] text-center">
          {hasMoreTurns ? (
            <Button
              className="mt-3.5"
              disabled={loadingMoreTurns}
              onClick={infiniteScroll.loadMore}
              type="button"
              variant="secondary"
            >
              {loadingMoreTurns
                ? "Loading more turns…"
                : loadMoreTurnsError
                  ? "Retry loading turns"
                  : "Load more turns"}
            </Button>
          ) : (
            <p
              aria-label={`All ${totalTurnCount} turns loaded`}
              className="mt-3.5 text-center text-[11px] text-subtle"
              role="status"
            >
              All {totalTurnCount} turns loaded
            </p>
          )}
          {loadMoreTurnsError ? (
            <p
              className="mx-auto mt-3.5 max-w-md text-center text-[11px] text-destructive"
              role="alert"
            >
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
      <footer className="bg-gradient-to-b from-transparent via-background to-background px-[clamp(12px,7vw,94px)] pb-[max(12px,env(safe-area-inset-bottom))] pt-4 sm:pb-6 sm:pt-6">
        {conversation.canContinue ? (
          <ReplyForm error={continueError} onSubmit={onContinue} pending={pending} />
        ) : (
          <Alert className="mx-auto max-w-[850px] bg-card" role="note">
            <AlertTitle>This session can’t be continued.</AlertTitle>
            <AlertDescription>
              The harness did not save an eligible native session handle.
            </AlertDescription>
          </Alert>
        )}
      </footer>
    </main>
  );
}
