"use client";

import { Terminal } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/utils";
import { useFocusPlacement } from "../hooks/use-focus-placement";
import type { ConversationFocus, ConversationTurn } from "../presentational-types";
import { pairToolEvents, type ToolInvocation } from "../tool-invocations";
import { compactJsonText, JsonCode, parseJsonText } from "./json-code";
import { Message, MessageAvatar, MessageContent } from "./message";
import { MessageResponse } from "./message-response";

type Turn = ConversationTurn;

const previewMaxLength = 200;
const payloadClassName = "mt-0 max-h-72 whitespace-pre-wrap rounded-none border-0 text-[11px]";
/** The class that draws a focused item's highlight in `--conversation-focus-highlight`. */
const focusHighlightClassName = "conversation-focus-highlight";
const statusTones: Readonly<Record<string, string>> = {
  completed: "text-success",
  failed: "text-destructive",
  interrupted: "text-warning",
  timeout: "text-warning",
};

function StructuredDetail({ label, value }: { label: string; value: unknown }) {
  return (
    <JsonCode
      className="mt-0 max-h-90 whitespace-pre-wrap rounded-none border-0 text-[11px]"
      label={label}
      value={value}
    />
  );
}

function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)} s`;
  return `${(durationMs / 60_000).toFixed(1)} min`;
}

function previewSource(invocation: ToolInvocation): string {
  if (invocation.input === undefined || invocation.input === null) return invocation.output ?? "";
  return typeof invocation.input === "string"
    ? invocation.input
    : compactJsonText(invocation.input);
}

function previewOf(invocation: ToolInvocation): string {
  return previewSource(invocation).split("\n", 1)[0]?.trim().slice(0, previewMaxLength) ?? "";
}

function ToolStatus({ status }: { status: string | null }) {
  if (!status) return null;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 text-[9px] uppercase tracking-[.08em]",
        statusTones[status] ?? "text-subtle",
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

function ToolTiming({ invocation }: { invocation: ToolInvocation }) {
  const entries: ReadonlyArray<readonly [string, string | null]> = [
    ["Call ID", invocation.toolCallId],
    ["Started", invocation.startedAt],
    ["Finished", invocation.finishedAt],
    ["Timing", invocation.timingSource],
  ];
  const present = entries.filter(([, value]) => value !== null);
  if (present.length === 0) return null;
  return (
    <dl aria-label={`${invocation.name} tool timing`} className="flex flex-wrap gap-2 px-3.5 py-2">
      {present.map(([label, value]) => (
        <div className="flex gap-1.5" key={label}>
          <dt className="text-[9px] uppercase text-subtle">{label}</dt>
          <dd className="m-0 font-mono text-[10px] text-muted-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ToolSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div>
      <h4 className="m-0 px-3.5 pt-2 text-[9px] font-bold uppercase tracking-[.08em] text-subtle">
        {title}
      </h4>
      {children}
    </div>
  );
}

function ToolInvocationBlock({
  invocation,
  current,
}: {
  invocation: ToolInvocation;
  current: boolean;
}) {
  const duration = formatDuration(invocation.durationMs);
  const preview = previewOf(invocation);
  const hasInput = invocation.input !== undefined && invocation.input !== null;
  const outputJson = invocation.output === null ? undefined : parseJsonText(invocation.output);
  return (
    <AccordionItem
      aria-current={current ? "true" : undefined}
      data-tool-call-id={invocation.toolCallId ?? undefined}
      data-event-index={invocation.id.slice(5)}
      className={cn("rounded-[10px] border px-3", current ? focusHighlightClassName : "bg-card")}
      value={invocation.id}
    >
      <AccordionTrigger
        aria-label={`${invocation.name} tool details`}
        className="items-center gap-2 py-1.5 text-xs text-muted-foreground"
      >
        <Terminal aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
        <span className="shrink-0 font-medium text-foreground">{invocation.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-normal text-subtle">
          {preview}
        </span>
        {duration ? (
          <span className="shrink-0 text-[10px] tabular-nums text-subtle">{duration}</span>
        ) : null}
        <ToolStatus status={invocation.status} />
      </AccordionTrigger>
      <AccordionContent className="-mx-3 border-t p-0">
        <ToolTiming invocation={invocation} />
        {hasInput ? (
          <ToolSection title="Input">
            <JsonCode
              className={payloadClassName}
              label={`${invocation.name} tool input`}
              value={invocation.input}
            />
          </ToolSection>
        ) : null}
        {invocation.output !== null ? (
          <ToolSection title="Output">
            {outputJson === undefined ? (
              <pre
                aria-label={`${invocation.name} tool output`}
                className={cn("message-json", payloadClassName)}
              >
                {invocation.output}
              </pre>
            ) : (
              <JsonCode
                className={payloadClassName}
                label={`${invocation.name} tool output`}
                value={outputJson}
              />
            )}
          </ToolSection>
        ) : null}
        {!hasInput && invocation.output === null ? (
          <p className="m-0 px-3.5 py-2 text-[11px] italic text-muted-foreground">
            This {invocation.kind} event carried no input or output.
          </p>
        ) : null}
      </AccordionContent>
    </AccordionItem>
  );
}

const usageKeys = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "costUsd",
] as const satisfies ReadonlyArray<keyof Turn["usage"]>;

const hasUsage = (usage: Turn["usage"]) => usageKeys.some((key) => Object.hasOwn(usage, key));

function Usage({ usage }: { usage: Turn["usage"] }) {
  const entries: ReadonlyArray<readonly [string, keyof Turn["usage"], number | null | undefined]> =
    [
      ["Input", "inputTokens", usage.inputTokens],
      ["Output", "outputTokens", usage.outputTokens],
      ["Cache read", "cacheReadTokens", usage.cacheReadTokens],
      ["Cache write", "cacheWriteTokens", usage.cacheWriteTokens],
      ["Cost", "costUsd", usage.costUsd],
    ];
  const present = entries.filter(([, key]) => Object.hasOwn(usage, key));
  if (present.length === 0) return null;
  return (
    <dl aria-label="Usage" className="mt-4.5 flex flex-wrap gap-2">
      {present.map(([label, key, value]) => (
        <div className="flex gap-1.5 rounded-md bg-muted px-2 py-1" key={key}>
          <dt className="text-[9px] uppercase text-subtle">{label}</dt>
          <dd className="m-0 text-[10px] text-muted-foreground">
            {value === null
              ? "Not reported"
              : key === "costUsd" && typeof value === "number"
                ? `$${value.toFixed(4)}`
                : (value ?? "Not reported")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ReasoningBlock({
  current,
  eventIndex,
  onOpenChange,
  open,
  text,
  value,
}: {
  current: boolean;
  eventIndex: number;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  text: string;
  value: string;
}) {
  return (
    <Accordion
      collapsible
      onValueChange={(next) => onOpenChange(next === value)}
      type="single"
      value={open ? value : ""}
    >
      <AccordionItem
        aria-current={current ? "true" : undefined}
        className={cn(
          "rounded-[10px] border border-dashed px-3",
          current ? focusHighlightClassName : "bg-card",
        )}
        data-event-index={eventIndex}
        value={value}
      >
        <AccordionTrigger className="py-1.5 text-xs text-muted-foreground">
          Reasoning
        </AccordionTrigger>
        <AccordionContent className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
          {text}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

/** The focused item's key: a paired tool invocation's id, or `agent-<index>` for its text. */
const agentEventKey = (index: number) => `agent-${index}`;
/** A streamed reasoning item's key among the turn's open items. */
const reasoningKey = (index: number) => `reasoning-${index}`;
type TurnPart = NonNullable<ConversationFocus["part"]>;

/** The element a focus names in its turn, decided by `toolCallId`, then `eventIndex`, then `part`. */
type FocusTarget =
  | { key: string; kind: "item"; openKey: string | undefined }
  | { kind: "part"; part: TurnPart }
  | { kind: "turn" };

function resolveFocus(
  turn: Turn,
  focus: ConversationFocus,
  invocations: readonly ToolInvocation[],
  hasEnd: boolean,
): FocusTarget {
  const item = (key: string, openKey?: string): FocusTarget => ({ key, kind: "item", openKey });
  if (focus.toolCallId !== undefined) {
    const tool = invocations.find((invocation) => invocation.toolCallId === focus.toolCallId);
    return tool ? item(tool.id, tool.id) : { kind: "turn" };
  }
  if (focus.eventIndex !== undefined) {
    const index = focus.eventIndex;
    const tool = invocations.find((invocation) => invocation.eventIndices.includes(index));
    if (tool) return item(tool.id, tool.id);
    const event = turn.agentEvents?.find((agentEvent) => agentEvent.index === index);
    if (!event) return { kind: "turn" };
    return item(agentEventKey(index), event.kind === "reasoning" ? reasoningKey(index) : undefined);
  }
  if (focus.part === "end" && !hasEnd) return { kind: "turn" };
  return focus.part ? { kind: "part", part: focus.part } : { kind: "turn" };
}

/** The open items a focus adds, so a focused item is open on the render that carries it. */
function withFocusOpen(open: readonly string[], target: FocusTarget | undefined): string[] {
  const key = target?.kind === "item" ? target.openKey : undefined;
  return key === undefined || open.includes(key) ? [...open] : [...open, key];
}

/** The mark a focused part carries, beside the `data-turn-part` every part carries. */
function partMark(target: FocusTarget | undefined, part: TurnPart) {
  const current = target?.kind === "part" && target.part === part;
  return { current, props: { "aria-current": current ? ("true" as const) : undefined } };
}

type ActivityEntry =
  | { at: number; event: NonNullable<Turn["agentEvents"]>[number]; type: "agent" }
  | { at: number; invocation: ToolInvocation; type: "tool" };

/**
 * The agent's text, reasoning and tool calls as one stream in recorded order: `index` is the
 * run-wide position agent events share with tool events, and a call sits where it was made.
 */
function activityStream(
  events: NonNullable<Turn["agentEvents"]>,
  invocations: readonly ToolInvocation[],
): ActivityEntry[] {
  return [
    ...events.map((event): ActivityEntry => ({ at: event.index, event, type: "agent" })),
    ...invocations.map(
      (invocation): ActivityEntry => ({
        at: invocation.eventIndices[0] ?? Number.POSITIVE_INFINITY,
        invocation,
        type: "tool",
      }),
    ),
  ].sort((left, right) => left.at - right.at);
}

function AgentActivity({
  current,
  entries,
  onOpenItemsChange,
  openItems,
}: {
  current: string | undefined;
  entries: readonly ActivityEntry[];
  onOpenItemsChange: (value: string[]) => void;
  openItems: string[];
}) {
  const setReasoningOpen = (value: string, open: boolean) =>
    onOpenItemsChange(
      open ? [...openItems, value] : openItems.filter((openValue) => openValue !== value),
    );
  return (
    <section aria-label="Agent activity" className="my-3">
      <Accordion
        className="space-y-2"
        onValueChange={onOpenItemsChange}
        type="multiple"
        value={openItems}
      >
        {entries.map((entry) =>
          entry.type === "tool" ? (
            <ToolInvocationBlock
              current={current === entry.invocation.id}
              invocation={entry.invocation}
              key={entry.invocation.id}
            />
          ) : entry.event.kind === "reasoning" ? (
            <ReasoningBlock
              current={current === agentEventKey(entry.event.index)}
              eventIndex={entry.event.index}
              key={reasoningKey(entry.event.index)}
              onOpenChange={(open) => setReasoningOpen(reasoningKey(entry.event.index), open)}
              open={openItems.includes(reasoningKey(entry.event.index))}
              text={entry.event.text}
              value={reasoningKey(entry.event.index)}
            />
          ) : (
            <div
              aria-current={current === agentEventKey(entry.event.index) ? "true" : undefined}
              aria-label="Agent message"
              className={cn(
                "border-l-2 border-primary pl-3",
                current === agentEventKey(entry.event.index) && focusHighlightClassName,
              )}
              data-event-index={entry.event.index}
              key={`message-${entry.event.index}`}
              role="group"
            >
              <MessageResponse label="Agent message">{entry.event.text}</MessageResponse>
            </div>
          ),
        )}
      </Accordion>
    </section>
  );
}

export interface TurnAuthor {
  avatar?: string;
  label: string;
}

export function TurnCard({
  author,
  focus,
  turn,
}: {
  author?: TurnAuthor;
  focus?: ConversationFocus;
  turn: Turn;
}) {
  const root = useRef<HTMLElement>(null);
  const invocations = pairToolEvents(turn.tools);
  const hasEnd = Boolean(turn.failureKind) || hasUsage(turn.usage);
  const focused = focus?.turnId === turn.id;
  const target = focused ? resolveFocus(turn, focus, invocations, hasEnd) : undefined;
  const focusKey = focused ? JSON.stringify(focus) : undefined;
  const [collapsed, setCollapsed] = useState(false);
  const [openItems, setOpenItems] = useState(() => withFocusOpen([], target));
  // A new focus opens its item and its turn during this render, before anything is painted.
  const [openedFor, setOpenedFor] = useState(focusKey);
  if (openedFor !== focusKey) {
    setOpenedFor(focusKey);
    if (target) {
      setCollapsed(false);
      setOpenItems((open) => withFocusOpen(open, target));
    }
  }
  useFocusPlacement(root, focusKey);
  const currentKey = target?.kind === "item" ? target.key : undefined;
  const prompt = partMark(target, "prompt");
  const answer = partMark(target, "answer");
  const end = partMark(target, "end");
  const hasUnknown = Object.keys(turn.unknown).length > 0;
  const activity = turn.agentEvents?.length ? activityStream(turn.agentEvents, invocations) : null;
  const streamReasons = activity?.some(
    (entry) => entry.type === "agent" && entry.event.kind === "reasoning",
  );
  const inFlight = turn.status === "running";
  return (
    <article
      ref={root}
      data-turn-id={turn.id}
      aria-current={target?.kind === "turn" ? "true" : undefined}
      aria-label={`Turn ${turn.id} from ${turn.harness}`}
      className={cn(
        "mx-auto mb-10.5 max-w-[850px]",
        target?.kind === "turn" && focusHighlightClassName,
      )}
    >
      <button
        className="mb-2 text-[10px] text-muted-foreground hover:text-foreground"
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? "Expand" : "Collapse"} turn {turn.id}
      </button>
      <div hidden={collapsed}>
        <Message from="user">
          <MessageContent
            {...prompt.props}
            className={cn(
              "mb-8 ml-auto max-w-[min(680px,88%)] rounded-[22px_22px_5px_22px] border",
              prompt.current ? focusHighlightClassName : "bg-popover",
              "px-5 py-4.5",
            )}
            data-turn-part="prompt"
          >
            <div className="text-[10px] font-bold uppercase tracking-[.08em] text-subtle">You</div>
            {inFlight && !turn.user ? (
              <p className="text-[13px] italic text-muted-foreground">
                The prompt is recorded when this run finishes.
              </p>
            ) : (
              <MessageResponse label="User message">{turn.user}</MessageResponse>
            )}
          </MessageContent>
        </Message>
        <Message from="assistant">
          <MessageAvatar {...(author?.avatar ? { src: author.avatar } : {})}>
            {author ? author.label.slice(0, 2).toUpperCase() : "OH"}
          </MessageAvatar>
          <MessageContent className="pt-1">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.08em] text-subtle">
              <span>{author?.label ?? turn.harness}</span>
              {turn.model ? (
                <Badge variant="secondary" className="font-medium normal-case tracking-normal">
                  {turn.model}
                </Badge>
              ) : null}
            </div>
            {turn.reasoning && !streamReasons ? (
              <Accordion className="mt-2.5" collapsible type="single">
                <AccordionItem
                  className="rounded-[10px] border border-dashed bg-card px-3"
                  value="reasoning"
                >
                  <AccordionTrigger className="text-xs text-muted-foreground">
                    Reasoning
                  </AccordionTrigger>
                  <AccordionContent className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
                    {turn.reasoning}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ) : null}
            {activity ? (
              <AgentActivity
                current={currentKey}
                entries={activity}
                onOpenItemsChange={setOpenItems}
                openItems={openItems}
              />
            ) : invocations.length > 0 ? (
              <section aria-label="Tool calls" className="my-3">
                <Accordion
                  className="space-y-1"
                  type="multiple"
                  value={openItems}
                  onValueChange={setOpenItems}
                >
                  {invocations.map((invocation) => (
                    <ToolInvocationBlock
                      current={currentKey === invocation.id}
                      invocation={invocation}
                      key={invocation.id}
                    />
                  ))}
                </Accordion>
              </section>
            ) : null}
            <div
              {...answer.props}
              className={answer.current ? focusHighlightClassName : undefined}
              data-turn-part="answer"
            >
              {turn.assistant ? (
                <MessageResponse label="Assistant message">{turn.assistant}</MessageResponse>
              ) : inFlight ? (
                <p className="text-[13px] italic text-muted-foreground" role="status">
                  Still running. Its final answer appears when the run finishes.
                </p>
              ) : (
                <p className="text-[13px] italic text-muted-foreground">
                  No assistant text was captured for this run.
                </p>
              )}
            </div>
            {hasEnd ? (
              <div
                {...end.props}
                className={end.current ? focusHighlightClassName : undefined}
                data-turn-part="end"
              >
                {turn.failureKind ? (
                  <p
                    aria-label={`Failure: ${turn.failureKind}`}
                    className="border-l-2 border-destructive pl-2.5 text-xs text-destructive"
                    role="note"
                  >
                    Failure: {turn.failureKind}
                  </p>
                ) : null}
                <Usage usage={turn.usage} />
              </div>
            ) : null}
            {hasUnknown ? (
              <Accordion className="mt-2.5" collapsible type="single">
                <AccordionItem className="rounded-[10px] border bg-card px-3" value="unknown">
                  <AccordionTrigger className="text-xs text-muted-foreground">
                    Additional upstream data
                  </AccordionTrigger>
                  <AccordionContent className="-mx-3 border-t p-0">
                    <StructuredDetail
                      label="Additional upstream data detail"
                      value={turn.unknown}
                    />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ) : null}
          </MessageContent>
        </Message>
      </div>
    </article>
  );
}
