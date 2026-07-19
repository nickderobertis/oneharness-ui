import type { ConversationSummary } from "@oneharness-ui/ipc-contract";
import { Pencil, RefreshCw, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  type ConversationGrouping,
  conversationGroupingOptions,
  useConversationOrganization,
} from "../hooks/use-conversation-organization";
import { useInfiniteScroll } from "../hooks/use-infinite-scroll";
import { useLabelEditor } from "../hooks/use-label-editor";

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
  const { choices, filter, grouped, grouping, setFilter, setGrouping } =
    useConversationOrganization(conversations);
  const { closeEditor, editingId, labelInput, openEditor, saveLabels, setLabelInput } =
    useLabelEditor(onSetLabels);
  const infiniteScroll = useInfiniteScroll({
    automatic: loadMoreError === null,
    hasMore,
    loadedCount: conversations.length,
    loading: loadingMore,
    onLoadMore,
  });
  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-r bg-[#151713] max-[680px]:max-h-[42vh] max-[680px]:border-r-0 max-[680px]:border-b">
      <header className="flex min-h-[86px] items-center justify-between border-b px-4.5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-[9px] bg-primary text-primary-foreground">
            <Terminal />
          </span>
          <div className="flex flex-col gap-0.5">
            <strong className="text-[15px] tracking-tight">oneharness</strong>
            <span className="text-[11px] uppercase tracking-[.06em] text-subtle">
              Local sessions
            </span>
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Refresh conversations"
              disabled={refreshing}
              onClick={onRefresh}
              size="icon"
              type="button"
              variant="ghost"
            >
              <RefreshCw className={refreshing ? "animate-spin" : undefined} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh conversations</TooltipContent>
        </Tooltip>
      </header>
      <nav
        aria-busy={loadingMore}
        aria-label="Conversation history"
        className="min-h-0 flex-1 overflow-y-auto px-2.5 py-4.5"
        ref={infiniteScroll.rootRef}
      >
        <div className="mx-2.5 mb-4 grid gap-2">
          <Label htmlFor="group-conversations">Organize by</Label>
          <Select
            onValueChange={(value) => {
              setGrouping(value as ConversationGrouping);
              setFilter("all");
            }}
            value={grouping}
          >
            <SelectTrigger id="group-conversations">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {conversationGroupingOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {grouping !== "none" ? (
            <div className="grid gap-1.5">
              <Label>Filter {grouping}</Label>
              <Select onValueChange={setFilter} value={filter}>
                <SelectTrigger aria-label={`Filter ${grouping}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {choices.map((choice) => (
                    <SelectItem key={choice} value={choice}>
                      {choice}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
        <p className="mx-2.5 mb-2.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[.1em] text-subtle">
          History
          <Badge
            aria-label={`${conversations.length} of ${totalCount} conversations loaded`}
            role="status"
          >
            {conversations.length < totalCount
              ? `${conversations.length} of ${totalCount}`
              : conversations.length}
          </Badge>
        </p>
        {conversations.length === 0 ? (
          <div className="mx-2 my-4.5 rounded-lg border border-dashed border-input p-4.5">
            <p className="mb-1 text-[13px]">No recorded sessions yet.</p>
            <span className="text-[11px] leading-relaxed text-subtle">
              Enable history in oneharness, then refresh.
            </span>
          </div>
        ) : (
          [...grouped].map(([group, items]) => (
            <section aria-labelledby={`group-${group}`} key={group}>
              {grouping !== "none" ? (
                <h2
                  className="mx-2.5 mb-1.5 mt-3.5 break-words text-[11px] text-muted-foreground"
                  id={`group-${group}`}
                >
                  {group}
                </h2>
              ) : null}
              <ul className="grid list-none gap-1 p-0">
                {items.map((conversation) => (
                  <li aria-label={`Session ID ${conversation.id}`} key={conversation.id}>
                    <Button
                      aria-label={`Open conversation ${conversation.name}`}
                      aria-current={selectedId === conversation.id ? "page" : undefined}
                      className="h-auto w-full flex-col items-stretch gap-1.5 rounded-[11px] border border-transparent px-3 py-3 text-left hover:bg-[#1b1e18] aria-[current=page]:border-input aria-[current=page]:bg-muted aria-[current=page]:shadow-[inset_3px_0_var(--primary)]"
                      onClick={() => onSelect(conversation.id)}
                      type="button"
                    >
                      <span className="flex min-w-0 items-center justify-between">
                        <strong className="truncate text-[13px]">{conversation.name}</strong>
                      </span>
                      <span
                        className="block truncate text-xs text-muted-foreground"
                        title={conversation.project}
                      >
                        {conversation.project || "Project not recorded"}
                      </span>
                      <span className="truncate text-[10px] tracking-[.02em] text-subtle">
                        {conversation.harnesses.join(", ")} · {conversation.turnCount}{" "}
                        {conversation.turnCount === 1 ? "turn" : "turns"}
                      </span>
                    </Button>
                    <Dialog
                      onOpenChange={(open) => {
                        if (open) {
                          openEditor(conversation);
                        } else if (editingId === conversation.id) closeEditor();
                      }}
                      open={editingId === conversation.id}
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            aria-label="Edit labels"
                            className="mx-2 h-auto justify-start px-1 py-0.5 text-[10px] text-primary"
                            onClick={() => {
                              openEditor(conversation);
                            }}
                            type="button"
                            variant="ghost"
                          >
                            <Pencil />
                            {(conversation.labels ?? []).length > 0
                              ? conversation.labels?.join(", ")
                              : "Add labels"}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit labels</TooltipContent>
                      </Tooltip>
                      {editingId === conversation.id ? (
                        <DialogContent>
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              void saveLabels(conversation.id).catch(() => undefined);
                            }}
                          >
                            <DialogHeader>
                              <DialogTitle>Edit labels</DialogTitle>
                              <DialogDescription>
                                Use commas to separate labels for {conversation.name}.
                              </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-2 py-2">
                              <Label htmlFor={`labels-${conversation.id}`}>
                                Labels for {conversation.name}
                              </Label>
                              <Input
                                id={`labels-${conversation.id}`}
                                maxLength={1300}
                                onChange={(event) => setLabelInput(event.target.value)}
                                value={labelInput}
                              />
                              {labelError ? (
                                <p className="text-xs text-destructive" role="alert">
                                  Couldn’t save labels. {labelError.message}
                                </p>
                              ) : null}
                            </div>
                            <DialogFooter>
                              <DialogClose asChild>
                                <Button type="button" variant="secondary">
                                  Cancel
                                </Button>
                              </DialogClose>
                              <Button disabled={labeling} type="submit">
                                Save labels
                              </Button>
                            </DialogFooter>
                          </form>
                        </DialogContent>
                      ) : null}
                    </Dialog>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        {labelError ? (
          <p
            className="mx-auto mt-3.5 max-w-md text-center text-[11px] text-destructive"
            role="alert"
          >
            Couldn’t save labels. {labelError.message}
          </p>
        ) : null}
        <div className="mx-auto max-w-[850px] text-center">
          {hasMore ? (
            <Button
              className="mt-3.5"
              disabled={loadingMore}
              onClick={infiniteScroll.loadMore}
              type="button"
              variant="secondary"
            >
              {loadingMore
                ? "Loading more conversations…"
                : loadMoreError
                  ? "Retry loading conversations"
                  : "Load more conversations"}
            </Button>
          ) : conversations.length > 0 ? (
            <p
              aria-label={`All ${totalCount} conversations loaded`}
              className="mt-3.5 text-[11px] text-subtle"
              role="status"
            >
              All {totalCount} conversations loaded
            </p>
          ) : null}
          {loadMoreError ? (
            <p className="mx-auto mt-3.5 max-w-md text-[11px] text-destructive" role="alert">
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
      <Separator />
      <footer className="px-5 py-3.5 text-[10px] uppercase tracking-[.05em] text-subtle max-[680px]:hidden">
        Runs stay on this machine
      </footer>
    </aside>
  );
}
