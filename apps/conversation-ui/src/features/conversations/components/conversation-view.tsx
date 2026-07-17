"use client";

import type { Conversation } from "@oneharness-ui/ipc-contract";
import { useEffect, useRef } from "react";
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
  loadingMoreTurns,
  onContinue,
  onLoadMoreTurns,
  pending,
}: {
  conversation: Conversation;
  continueError: Error | null;
  hasMoreTurns: boolean;
  loadingMoreTurns: boolean;
  onContinue: (message: string) => Promise<void>;
  onLoadMoreTurns: () => void;
  pending: boolean;
}) {
  const state = pending ? "running" : conversation.state;
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
      <section aria-busy={loadingMoreTurns} aria-label="Conversation turns" className="turns">
        {conversation.turns.map((turn) => (
          <TurnCard key={turn.id} turn={turn} />
        ))}
        {hasMoreTurns ? (
          <button
            className="load-more"
            disabled={loadingMoreTurns}
            onClick={onLoadMoreTurns}
            type="button"
          >
            {loadingMoreTurns ? "Loading more turns…" : "Load more turns"}
          </button>
        ) : null}
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
