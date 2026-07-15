"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, type ErrorInfo, type ReactNode, useState } from "react";
import {
  useContinueConversation,
  useConversation,
  useConversationList,
} from "../hooks/use-conversations";
import { useSessionUrl } from "../hooks/use-session-url";
import { ConversationList } from "./conversation-list";
import { ConversationView } from "./conversation-view";
import { ErrorState } from "./error-state";

function LoadingState({ label }: { label: string }) {
  return (
    <div aria-label={label} className="loading" role="status">
      <span />
      <span />
      <span />
    </div>
  );
}

function Workspace() {
  const [selectedId, select] = useSessionUrl();
  const list = useConversationList();
  const selected = useConversation(selectedId);
  const continuation = useContinueConversation(select);

  if (list.isLoading)
    return (
      <div className="app-state">
        <LoadingState label="Loading conversations" />
      </div>
    );
  if (list.error)
    return (
      <div className="app-state">
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      </div>
    );
  const conversations = list.data ?? [];

  return (
    <div className="desktop-shell">
      <ConversationList
        conversations={conversations}
        onRefresh={() => void list.refetch()}
        onSelect={select}
        refreshing={list.isFetching}
        selectedId={selectedId}
      />
      {!selectedId ? (
        <main className="welcome">
          <div>
            <p className="eyebrow">Conversation archive</p>
            <h1>{conversations.length === 0 ? "No history yet" : "Pick up where you left off"}</h1>
            <p>
              {conversations.length === 0
                ? "Run oneharness with history enabled. Your local sessions will appear here."
                : "Select a local session to read its turns, inspect tool activity, and continue when supported."}
            </p>
          </div>
        </main>
      ) : selected.isLoading ? (
        <main className="welcome">
          <LoadingState label="Loading selected conversation" />
        </main>
      ) : selected.error ? (
        <main className="welcome">
          <ErrorState error={selected.error} onRetry={() => void selected.refetch()} />
        </main>
      ) : selected.data ? (
        <ConversationView
          conversation={selected.data}
          continueError={continuation.error}
          onContinue={async (message) => {
            await continuation.mutateAsync({ message, sessionId: selected.data.id });
          }}
          pending={continuation.isPending}
        />
      ) : null}
    </div>
  );
}

class FeatureErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(_error: Error, _info: ErrorInfo) {}
  override render() {
    if (this.state.error)
      return (
        <div className="app-state">
          <ErrorState error={this.state.error} onRetry={() => this.setState({ error: null })} />
        </div>
      );
    return this.props.children;
  }
}

export function ConversationShell() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 5_000 },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <FeatureErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Workspace />
      </QueryClientProvider>
    </FeatureErrorBoundary>
  );
}
