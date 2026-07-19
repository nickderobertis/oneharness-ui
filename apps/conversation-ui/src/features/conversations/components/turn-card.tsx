import type { Conversation } from "@oneharness-ui/ipc-contract";
import { Message, MessageAvatar, MessageContent, MessageResponse } from "@/components/ui/message";

type Turn = Conversation["turns"][number];

function StructuredDetail({ label, value }: { label: string; value: unknown }) {
  return (
    <pre aria-label={label} className="structured-detail">
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
    <dl aria-label="Usage" className="usage">
      {present.map(([label, key, value]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>
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
    <article aria-label={`Turn ${turn.id} from ${turn.harness}`} className="turn">
      <Message from="user">
        <MessageContent>
          <div className="message__label">You</div>
          <MessageResponse label="User message">{turn.user}</MessageResponse>
        </MessageContent>
      </Message>
      <Message from="assistant">
        <MessageAvatar>OH</MessageAvatar>
        <MessageContent>
          <div className="message__label">
            <span>{turn.harness}</span>
            {turn.model ? <span className="model">{turn.model}</span> : null}
          </div>
          {turn.reasoning ? (
            <details className="disclosure reasoning">
              <summary>Reasoning</summary>
              <p>{turn.reasoning}</p>
            </details>
          ) : null}
          {turn.tools.length > 0 ? (
            <section aria-label="Tool calls" className="tool-list">
              {turn.tools.map((tool) => (
                <details className="disclosure tool" key={`${tool.index}-${tool.kind}`}>
                  <summary aria-label={`${tool.name ?? tool.kind} tool details`}>
                    <span className="tool__icon" aria-hidden="true">
                      ›_
                    </span>
                    <span>{tool.name ?? tool.kind}</span>
                    <span className="tool__kind">{tool.kind}</span>
                  </summary>
                  <StructuredDetail
                    label={`${tool.name ?? tool.kind} tool input and output`}
                    value={{ input: tool.input ?? null, output: tool.output ?? null }}
                  />
                </details>
              ))}
            </section>
          ) : null}
          {turn.assistant ? (
            <MessageResponse label="Assistant message">{turn.assistant}</MessageResponse>
          ) : (
            <p className="muted">No assistant text was captured for this run.</p>
          )}
          {turn.failureKind ? (
            <p aria-label={`Failure: ${turn.failureKind}`} className="failure-note" role="note">
              Failure: {turn.failureKind}
            </p>
          ) : null}
          <Usage usage={turn.usage} />
          {hasUnknown ? (
            <details className="disclosure unknown">
              <summary>Additional upstream data</summary>
              <StructuredDetail label="Additional upstream data detail" value={turn.unknown} />
            </details>
          ) : null}
        </MessageContent>
      </Message>
    </article>
  );
}
