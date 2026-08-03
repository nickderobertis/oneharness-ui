import type { ConversationToolEvent } from "./presentational-types";

const toolResultKind = "tool_result";

export interface ToolInvocation {
  call: ConversationToolEvent | null;
  durationMs: number | null;
  finishedAt: string | null;
  id: string;
  input: unknown;
  kind: string;
  name: string;
  output: string | null;
  result: ConversationToolEvent | null;
  startedAt: string | null;
  status: string | null;
  timingSource: string | null;
  toolCallId: string | null;
}

type Pair = { call: ConversationToolEvent | null; result: ConversationToolEvent | null };

function firstReported<Value>(...candidates: Array<Value | null | undefined>): Value | null {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null) return candidate;
  }
  return null;
}

function unpairedCall(pairs: Pair[]): Pair | undefined {
  for (let index = pairs.length - 1; index >= 0; index -= 1) {
    const pair = pairs[index];
    if (pair?.call && !pair.result) return pair;
  }
  return undefined;
}

function toInvocation({ call, result }: Pair): ToolInvocation {
  const anchor = call ?? result;
  const kind = anchor?.kind ?? toolResultKind;
  return {
    call,
    durationMs: firstReported(call?.durationMs, result?.durationMs),
    finishedAt: firstReported(call?.finishedAt, result?.finishedAt),
    id: `tool-${anchor?.index ?? 0}`,
    input: call?.input ?? result?.input,
    kind,
    name: firstReported(call?.name, result?.name) ?? kind,
    output: firstReported(result?.output, call?.output),
    result,
    startedAt: firstReported(call?.startedAt, result?.startedAt),
    status: firstReported(call?.status, result?.status),
    timingSource: firstReported(call?.timingSource, result?.timingSource),
    toolCallId: firstReported(call?.toolCallId, result?.toolCallId),
  };
}

/**
 * Groups a turn's raw action events into one invocation per tool call. Results correlate by
 * `toolCallId` when the harness reports one and otherwise attach to the nearest preceding
 * unanswered call. An event that pairs with nothing stays its own invocation rather than
 * disappearing.
 */
export function pairToolEvents(events: readonly ConversationToolEvent[]): ToolInvocation[] {
  const pairs: Pair[] = [];
  const openCalls = new Map<string, Pair>();
  for (const event of events) {
    if (event.kind === toolResultKind) {
      const correlated = event.toolCallId ? openCalls.get(event.toolCallId) : unpairedCall(pairs);
      if (correlated && !correlated.result) {
        correlated.result = event;
        if (correlated.call?.toolCallId) openCalls.delete(correlated.call.toolCallId);
        continue;
      }
      pairs.push({ call: null, result: event });
      continue;
    }
    const pair: Pair = { call: event, result: null };
    pairs.push(pair);
    if (event.toolCallId) openCalls.set(event.toolCallId, pair);
  }
  return pairs.map(toInvocation);
}
