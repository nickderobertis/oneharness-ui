import type { Conversation } from "@oneharness-ui/ipc-contract";
import { Terminal } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Message, MessageAvatar, MessageContent, MessageResponse } from "@/components/ui/message";

type Turn = Conversation["turns"][number];

function StructuredDetail({ label, value }: { label: string; value: unknown }) {
  return (
    <pre
      aria-label={label}
      className="max-h-90 overflow-auto whitespace-pre-wrap p-3.5 font-mono text-[11px] leading-relaxed text-[#c8ccbc]"
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Usage({ usage }: { usage: Turn["usage"] }) {
  const entries = [
    ["Input", "inputTokens", usage.inputTokens],
    ["Output", "outputTokens", usage.outputTokens],
    ["Cache read", "cacheReadTokens", usage.cacheReadTokens],
    ["Cache write", "cacheWriteTokens", usage.cacheWriteTokens],
    ["Cost", "costUsd", usage.costUsd],
  ] as const;
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

export function TurnCard({ turn }: { turn: Turn }) {
  const hasUnknown = Object.keys(turn.unknown).length > 0;
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
        <MessageAvatar>OH</MessageAvatar>
        <MessageContent className="pt-1">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.08em] text-subtle">
            <span>{turn.harness}</span>
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
          {turn.tools.length > 0 ? (
            <section aria-label="Tool calls" className="my-3.5 space-y-2">
              {turn.tools.map((tool) => (
                <Accordion collapsible key={`${tool.index}-${tool.kind}`} type="single">
                  <AccordionItem className="rounded-[10px] border bg-card px-3" value="tool">
                    <AccordionTrigger
                      aria-label={`${tool.name ?? tool.kind} tool details`}
                      className="text-xs text-muted-foreground"
                    >
                      <Terminal className="text-primary" />
                      <span>{tool.name ?? tool.kind}</span>
                      <span className="ml-auto text-[9px] uppercase tracking-[.08em] text-subtle">
                        {tool.kind}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="-mx-3 border-t p-0">
                      <StructuredDetail
                        label={`${tool.name ?? tool.kind} tool input and output`}
                        value={{ input: tool.input ?? null, output: tool.output ?? null }}
                      />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              ))}
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
