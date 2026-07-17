import type { ConversationSummary } from "@oneharness-ui/ipc-contract";
import { RefreshIcon, TerminalIcon } from "@/components/ui/icons";

export function ConversationList({
  conversations,
  hasMore,
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
  loadingMore: boolean;
  onLoadMore: () => void;
  onRefresh: () => void;
  onSelect: (id: string) => void;
  refreshing: boolean;
  selectedId: string | null;
  totalCount: number;
}) {
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
      <nav aria-busy={loadingMore} aria-label="Conversation history" className="conversation-nav">
        <p className="conversation-nav__label">
          History
          <span>
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
        {hasMore ? (
          <button className="load-more" disabled={loadingMore} onClick={onLoadMore} type="button">
            {loadingMore ? "Loading more conversations…" : "Load more conversations"}
          </button>
        ) : null}
      </nav>
      <footer className="sidebar__footer">Runs stay on this machine</footer>
    </aside>
  );
}
