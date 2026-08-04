import { Terminal } from "lucide-react";
import type { ReactNode } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/utils";
import type { ConversationTurn } from "../presentational-types";
import { pairToolEvents, type ToolInvocation } from "../tool-invocations";
import { compactJsonText, JsonCode, parseJsonText } from "./json-code";
import { Message, MessageAvatar, MessageContent } from "./message";
import { MessageResponse } from "./message-response";

type Turn = ConversationTurn;

const previewMaxLength = 200;
const payloadClassName = "mt-0 max-h-72 whitespace-pre-wrap rounded-none border-0 text-[11px]";
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

function ToolInvocationBlock({ invocation }: { invocation: ToolInvocation }) {
  const duration = formatDuration(invocation.durationMs);
  const preview = previewOf(invocation);
  const hasInput = invocation.input !== undefined && invocation.input !== null;
  const outputJson = invocation.output === null ? undefined : parseJsonText(invocation.output);
  return (
    <AccordionItem className="rounded-[10px] border bg-card px-3" value={invocation.id}>
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

export interface TurnAuthor {
  avatar?: string;
  label: string;
}

export function TurnCard({ author, turn }: { author?: TurnAuthor; turn: Turn }) {
  const hasUnknown = Object.keys(turn.unknown).length > 0;
  const invocations = pairToolEvents(turn.tools);
  return (
    <article
      aria-label={`Turn ${turn.id} from ${turn.harness}`}
      className="mx-auto mb-10.5 max-w-[850px]"
    >
      <Message from="user">
        <MessageContent className="mb-8 ml-auto max-w-[min(680px,88%)] rounded-[22px_22px_5px_22px] border bg-popover px-5 py-4.5">
          <div className="text-[10px] font-bold uppercase tracking-[.08em] text-subtle">You</div>
          <MessageResponse label="User message">{turn.user}</MessageResponse>
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
          {turn.reasoning ? (
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
          {invocations.length > 0 ? (
            <section aria-label="Tool calls" className="my-3">
              <Accordion className="space-y-1" type="multiple">
                {invocations.map((invocation) => (
                  <ToolInvocationBlock invocation={invocation} key={invocation.id} />
                ))}
              </Accordion>
            </section>
          ) : null}
          {turn.assistant ? (
            <MessageResponse label="Assistant message">{turn.assistant}</MessageResponse>
          ) : (
            <p className="text-[13px] italic text-muted-foreground">
              No assistant text was captured for this run.
            </p>
          )}
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
          {hasUnknown ? (
            <Accordion className="mt-2.5" collapsible type="single">
              <AccordionItem className="rounded-[10px] border bg-card px-3" value="unknown">
                <AccordionTrigger className="text-xs text-muted-foreground">
                  Additional upstream data
                </AccordionTrigger>
                <AccordionContent className="-mx-3 border-t p-0">
                  <StructuredDetail label="Additional upstream data detail" value={turn.unknown} />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          ) : null}
        </MessageContent>
      </Message>
    </article>
  );
}
