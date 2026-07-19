"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, type ErrorInfo, type ReactNode, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  useContinueConversation,
  useConversation,
  useConversationList,
  useSetConversationLabels,
} from "../hooks/use-conversations";
import { useSessionUrl } from "../hooks/use-session-url";
import { ConversationList } from "./conversation-list";
import { ConversationView } from "./conversation-view";
import { ErrorState } from "./error-state";

function LoadingState({ label }: { label: string }) {
  return (
    <div aria-label={label} className="flex gap-2" role="status">
      <Skeleton className="size-2 rounded-full bg-primary" />
      <Skeleton className="size-2 rounded-full bg-primary [animation-delay:120ms]" />
      <Skeleton className="size-2 rounded-full bg-primary [animation-delay:240ms]" />
    </div>
  );
}

function Workspace() {
  const [selectedId, select] = useSessionUrl();
  const list = useConversationList();
  const selected = useConversation(selectedId);
  const continuation = useContinueConversation(select);
  const labels = useSetConversationLabels();

  if (list.isLoading)
    return (
      <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_52%_40%,#1d2118_0,var(--background)_48%)] p-10">
        <LoadingState label="Loading conversations" />
      </div>
    );
  if (list.error && !list.data)
    return (
      <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_52%_40%,#1d2118_0,var(--background)_48%)] p-10">
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      </div>
    );
  const conversations = list.data?.conversations ?? [];

  return (
    <div className="grid h-full min-h-0 grid-cols-[330px_minmax(0,1fr)] overflow-hidden max-[820px]:grid-cols-[260px_minmax(0,1fr)] max-[680px]:min-h-[100dvh] max-[680px]:grid-cols-1">
      <div className={selectedId ? "contents max-[680px]:hidden" : "contents"}>
        <ConversationList
        conversations={conversations}
        hasMore={list.hasNextPage}
        loadMoreError={list.isFetchNextPageError ? list.error : null}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={list.fetchNextPage}
        onRefresh={() => void list.refresh()}
        onSetLabels={async (sessionId, nextLabels) => {
          await labels.mutateAsync({ labels: nextLabels, sessionId });
        }}
        onSelect={select}
        refreshing={list.isFetching}
        selectedId={selectedId}
        totalCount={list.data?.totalCount ?? 0}
        labelError={labels.error}
        labeling={labels.isPending}
        />
      </div>
      {!selectedId ? (
        <main className="flex min-h-0 items-center justify-center bg-[radial-gradient(circle_at_52%_40%,#1d2118_0,var(--background)_48%)] p-10 max-[680px]:min-h-[58vh]">
          <Card className="max-w-xl border-0 bg-transparent text-center shadow-none">
            <CardContent>
              <p className="text-[10px] font-bold uppercase tracking-[.13em] text-primary">
                Conversation archive
              </p>
              <h1 className="my-4 text-[clamp(34px,6vw,58px)] leading-none tracking-[-.055em]">
                {conversations.length === 0 ? "No history yet" : "Pick up where you left off"}
              </h1>
              <p className="mx-auto max-w-lg text-[15px] leading-relaxed text-muted-foreground">
                {conversations.length === 0
                  ? "Run oneharness with history enabled. Your local sessions will appear here."
                  : "Select a local session to read its turns, inspect tool activity, and continue when supported."}
              </p>
            </CardContent>
          </Card>
        </main>
      ) : selected.isLoading ? (
        <main className="flex min-h-0 items-center justify-center p-10">
          <LoadingState label="Loading selected conversation" />
        </main>
      ) : selected.error && !selected.data ? (
        <main className="flex min-h-0 items-center justify-center p-10">
          <ErrorState error={selected.error} onRetry={() => void selected.refetch()} />
        </main>
      ) : selected.data ? (
        <ConversationView
          onBack={() => select(null)}
          conversation={selected.data}
          continueError={continuation.error}
          hasMoreTurns={selected.hasNextPage}
          loadMoreTurnsError={selected.isFetchNextPageError ? selected.error : null}
          loadingMoreTurns={selected.isFetchingNextPage}
          onContinue={async (message) => {
            await continuation.mutateAsync({ message, sessionId: selected.data.id });
          }}
          onLoadMoreTurns={selected.fetchNextPage}
          pending={continuation.isPending}
          totalTurnCount={selected.data.totalTurnCount}
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
        <div className="flex h-full items-center justify-center p-10">
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
        <TooltipProvider>
          <Workspace />
        </TooltipProvider>
      </QueryClientProvider>
    </FeatureErrorBoundary>
  );
}
