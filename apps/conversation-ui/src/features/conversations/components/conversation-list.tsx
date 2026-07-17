import type { ConversationSummary } from "@oneharness-ui/ipc-contract";
import { RefreshIcon, TerminalIcon } from "@/components/ui/icons";
import { useInfiniteScroll } from "../hooks/use-infinite-scroll";

export function ConversationList({
  conversations,
  hasMore,
  loadMoreError,
  loadingMore,
  onLoadMore,
  onRefresh,
  onSelect,
  refreshing,
  selectedId,
  totalCount,
}: {
  conversations: ConversationSummary[];
  hasMore: boolean;
  loadMoreError: Error | null;
  loadingMore: boolean;
  onLoadMore: () => Promise<unknown>;
  onRefresh: () => void;
  onSelect: (id: string) => void;
  refreshing: boolean;
  selectedId: string | null;
  totalCount: number;
}) {
  const infiniteScroll = useInfiniteScroll({
    automatic: loadMoreError === null,
    hasMore,
    loading: loadingMore,
    onLoadMore,
  });
  return (
    <aside className="sidebar">
      <header className="sidebar__header">
        <div className="brand">
          <span className="brand__mark">
            <TerminalIcon />
          </span>
          <div>
            <strong>oneharness</strong>
            <span>Local sessions</span>
          </div>
        </div>
        <button
          aria-label="Refresh conversations"
          className="icon-button"
          disabled={refreshing}
          onClick={onRefresh}
          type="button"
        >
          <RefreshIcon className={refreshing ? "spin" : undefined} />
        </button>
      </header>
      <nav
        aria-busy={loadingMore}
        aria-label="Conversation history"
        className="conversation-nav"
        ref={infiniteScroll.rootRef}
      >
        <p className="conversation-nav__label">
          History
          <span
            aria-label={`${conversations.length} of ${totalCount} conversations loaded`}
            role="status"
          >
            {conversations.length < totalCount
              ? `${conversations.length} of ${totalCount}`
              : conversations.length}
          </span>
        </p>
        {conversations.length === 0 ? (
          <div className="sidebar-empty">
            <p>No recorded sessions yet.</p>
            <span>Enable history in oneharness, then refresh.</span>
          </div>
        ) : (
          <ul>
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  aria-label={`Open conversation ${conversation.name}`}
                  aria-current={selectedId === conversation.id ? "page" : undefined}
                  className="conversation-link"
                  data-session-id={conversation.id}
                  onClick={() => onSelect(conversation.id)}
                  type="button"
                >
                  <span className="conversation-link__top">
                    <strong>{conversation.name}</strong>
                  </span>
                  <span className="conversation-link__project" title={conversation.project}>
                    {conversation.project || "Project not recorded"}
                  </span>
                  <span className="conversation-link__meta">
                    {conversation.harnesses.join(", ")} · {conversation.turnCount}{" "}
                    {conversation.turnCount === 1 ? "turn" : "turns"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="pagination">
          {hasMore ? (
            <button
              className="load-more"
              disabled={loadingMore}
              onClick={infiniteScroll.loadMore}
              type="button"
            >
              {loadingMore
                ? "Loading more conversations…"
                : loadMoreError
                  ? "Retry loading conversations"
                  : "Load more conversations"}
            </button>
          ) : conversations.length > 0 ? (
            <p className="pagination__status" role="status">
              All {totalCount} conversations loaded
            </p>
          ) : null}
          {loadMoreError ? (
            <p className="pagination__error" role="alert">
              Couldn’t load more conversations. {loadMoreError.message}
            </p>
          ) : null}
          <div
            aria-hidden="true"
            className="pagination__sentinel"
            ref={infiniteScroll.sentinelRef}
          />
        </div>
      </nav>
      <footer className="sidebar__footer">Runs stay on this machine</footer>
    </aside>
  );
}
