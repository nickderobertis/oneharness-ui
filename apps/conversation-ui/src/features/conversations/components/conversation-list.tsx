import type { ConversationSummary } from "@oneharness-ui/ipc-contract";
import { RefreshIcon, TerminalIcon } from "@/components/ui/icons";
import { StatusBadge } from "./status-badge";

export function ConversationList({
  conversations,
  onRefresh,
  onSelect,
  refreshing,
  selectedId,
}: {
  conversations: ConversationSummary[];
  onRefresh: () => void;
  onSelect: (id: string) => void;
  refreshing: boolean;
  selectedId: string | null;
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
      <nav aria-label="Conversation history" className="conversation-nav">
        <p className="conversation-nav__label">
          History <span>{conversations.length}</span>
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
                  aria-current={selectedId === conversation.id ? "page" : undefined}
                  className="conversation-link"
                  onClick={() => onSelect(conversation.id)}
                  type="button"
                >
                  <span className="conversation-link__top">
                    <strong>{conversation.name}</strong>
                    <StatusBadge state={conversation.state} />
                  </span>
                  <span className="conversation-link__preview">
                    {conversation.preview || "No prompt captured"}
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
      </nav>
      <footer className="sidebar__footer">Runs stay on this machine</footer>
    </aside>
  );
}
