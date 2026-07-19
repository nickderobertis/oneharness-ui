import type { ConversationSummary } from "@oneharness-ui/ipc-contract";
import { RefreshIcon, TerminalIcon } from "@/components/ui/icons";
import {
  type ConversationGrouping,
  useConversationOrganization,
} from "../hooks/use-conversation-organization";
import { useInfiniteScroll } from "../hooks/use-infinite-scroll";

export function ConversationList({
  conversations,
  hasMore,
  loadMoreError,
  labelError,
  labeling,
  loadingMore,
  onLoadMore,
  onRefresh,
  onSetLabels,
  onSelect,
  refreshing,
  selectedId,
  totalCount,
}: {
  conversations: ConversationSummary[];
  hasMore: boolean;
  loadMoreError: Error | null;
  labelError: Error | null;
  labeling: boolean;
  loadingMore: boolean;
  onLoadMore: () => Promise<unknown>;
  onRefresh: () => void;
  onSetLabels: (id: string, labels: string[]) => Promise<unknown>;
  onSelect: (id: string) => void;
  refreshing: boolean;
  selectedId: string | null;
  totalCount: number;
}) {
  const {
    choices,
    editingId,
    filter,
    grouped,
    grouping,
    labelInput,
    setEditingId,
    setFilter,
    setGrouping,
    setLabelInput,
  } = useConversationOrganization(conversations);
  const infiniteScroll = useInfiniteScroll({
    automatic: loadMoreError === null,
    hasMore,
    loadedCount: conversations.length,
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
        <div className="conversation-controls">
          <label htmlFor="group-conversations">Organize by</label>
          <select
            id="group-conversations"
            onChange={(event) => {
              setGrouping(event.target.value as ConversationGrouping);
              setFilter("all");
            }}
            value={grouping}
          >
            <option value="none">Recent</option>
            <option value="label">Label</option>
            <option value="project">Project</option>
          </select>
          {grouping !== "none" ? (
            <label>
              Filter {grouping}
              <select onChange={(event) => setFilter(event.target.value)} value={filter}>
                <option value="all">All</option>
                {choices.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
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
          [...grouped].map(([group, items]) => (
            <section aria-labelledby={`group-${group}`} className="conversation-group" key={group}>
              {grouping !== "none" ? <h2 id={`group-${group}`}>{group}</h2> : null}
              <ul>
                {items.map((conversation) => (
                  <li aria-label={`Session ID ${conversation.id}`} key={conversation.id}>
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
                    <button
                      aria-label="Edit labels"
                      className="label-button"
                      onClick={() => {
                        setEditingId(conversation.id);
                        setLabelInput(conversation.labels.join(", "));
                      }}
                      type="button"
                    >
                      {conversation.labels.length > 0
                        ? conversation.labels.join(", ")
                        : "Add labels"}
                    </button>
                    {editingId === conversation.id ? (
                      <form
                        className="label-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const next = labelInput
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean);
                          void onSetLabels(conversation.id, next)
                            .then(() => setEditingId(null))
                            .catch(() => undefined);
                        }}
                      >
                        <label>
                          Labels for {conversation.name}
                          <input
                            maxLength={1300}
                            onChange={(event) => setLabelInput(event.target.value)}
                            value={labelInput}
                          />
                        </label>
                        <button disabled={labeling} type="submit">
                          Save labels
                        </button>
                        <button onClick={() => setEditingId(null)} type="button">
                          Cancel
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        {labelError ? (
          <p className="pagination__error" role="alert">
            Couldn’t save labels. {labelError.message}
          </p>
        ) : null}
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
            <p
              aria-label={`All ${totalCount} conversations loaded`}
              className="pagination__status"
              role="status"
            >
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
