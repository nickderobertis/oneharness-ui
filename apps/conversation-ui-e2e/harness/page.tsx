import {
  type Conversation,
  type ConversationFocus,
  type ConversationTurn,
  ConversationView,
  Timeline,
  type TimelineHover,
  TooltipProvider,
  TurnCard,
} from "@oneharness/ui";
import { type CSSProperties, memo, type ReactNode, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import {
  focusEventIndex,
  focusedTurnIds,
  type PinnedFocusName,
  pinnedFocuses,
  pinnedOffsetPx,
  pinnedTurnCount,
  tallTurnIds,
  timelineFixture,
  turnCount,
} from "../tests/support/fixtures.ts";

const query = z
  .object({
    highlight: z
      .string()
      .regex(/^#[0-9a-f]{6}$/)
      .optional(),
    theme: z.enum(["dark", "light"]),
    view: z.enum(["conversation", "pinned-list", "timeline", "turn-list"]),
  })
  .parse(Object.fromEntries(new URLSearchParams(window.location.search)));

function turn(index: number): ConversationTurn {
  return {
    agentEvents: [
      { index: focusEventIndex.reasoning, kind: "reasoning", text: `Plan step ${index}.` },
      { index: focusEventIndex.message, kind: "message", text: `Checked step ${index}.` },
    ],
    assistant: `Finished step ${index}.`,
    failureKind: null,
    harness: "claude-code",
    id: `turn-${index}`,
    model: "fixture-model",
    reasoning: null,
    status: "completed",
    timestamp: new Date(Date.UTC(2026, 10, 20, 9, 0, index)).toISOString(),
    tools: [
      {
        index: focusEventIndex.tool,
        input: { command: `ls step-${index}` },
        kind: "tool_call",
        name: "Bash",
        toolCallId: `call-${index}`,
      },
      {
        index: focusEventIndex.tool + 1,
        kind: "tool_result",
        output: "ok",
        toolCallId: `call-${index}`,
      },
    ],
    unknown: {},
    usage: { inputTokens: 1_200 + index, outputTokens: 80 },
    user: `Run step ${index}.`,
  };
}

const turns = Array.from({ length: turnCount }, (_, index) => turn(index));
const screens = (line: string) => Array.from({ length: 160 }, (_, at) => `${line} ${at}.`);
/** The pinned list's turns, two of them with a prompt or a reasoning item of several screens. */
const pinnedTurns = Array.from({ length: pinnedTurnCount }, (_, index): ConversationTurn => {
  const entry = turn(index);
  if (entry.id === tallTurnIds.prompt)
    return { ...entry, user: screens("Read the long brief, paragraph").join("\n\n") };
  if (entry.id === tallTurnIds.reasoning)
    return {
      ...entry,
      agentEvents: entry.agentEvents?.map((event) =>
        event.kind === "reasoning"
          ? { ...event, text: screens("Weigh the next option, line").join("\n") }
          : event,
      ),
    };
  return entry;
});
const focusKind = z.enum(["message", "reasoning", "tool"]).optional();
const hashFocusKind = () => focusKind.parse(window.location.hash.slice(1) || undefined);

/** The focus the URL's hash names, e.g. `#reasoning`; a consumer changes it in place. */
function useHashFocus(): ConversationFocus | undefined {
  const [kind, setKind] = useState(hashFocusKind);
  useEffect(() => {
    const update = () => setKind(hashFocusKind());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return kind ? { eventIndex: focusEventIndex[kind], turnId: focusedTurnIds[kind] } : undefined;
}
// `Object.keys` widens to string[]; the keys are exactly the fixture's focus names.
const pinnedFocusName = z.enum(Object.keys(pinnedFocuses) as [PinnedFocusName]).optional();

const hashPinnedFocusName = () => pinnedFocusName.parse(window.location.hash.slice(1) || undefined);

/** The pinned list's focus, named by the URL's hash, e.g. `#tall-prompt`. */
function usePinnedHashFocus(): ConversationFocus | undefined {
  const [name, setName] = useState(hashPinnedFocusName);
  useEffect(() => {
    const update = () => setName(hashPinnedFocusName());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return name ? pinnedFocuses[name] : undefined;
}

/**
 * A consumer's scroll container that pins a summary over its top and tells the package how tall
 * that is through `--conversation-focus-offset`.
 */
function PinnedList() {
  const focus = usePinnedHashFocus();
  // React's style type has no entry for custom properties, so the offset is cast in.
  const offset = { "--conversation-focus-offset": `${pinnedOffsetPx}px` } as CSSProperties;
  return (
    <section
      aria-label="Pinned turn list"
      style={{ ...offset, height: "100vh", overflowY: "auto" }}
    >
      <aside
        aria-label="Pinned summary"
        className="border-b bg-background"
        style={{ height: pinnedOffsetPx, position: "sticky", top: 0, zIndex: 1 }}
      >
        Pinned run summary
      </aside>
      <div style={{ padding: "0 24px" }}>
        {pinnedTurns.map((entry) => (
          <MemoizedTurnCard
            key={entry.id}
            turn={entry}
            {...(focus && entry.id === focus.turnId ? { focus } : {})}
          />
        ))}
      </div>
    </section>
  );
}

const conversation: Conversation = {
  canContinue: false,
  harnesses: ["claude-code"],
  id: "harness-conversation",
  name: "Two hundred turns",
  project: "/workspace/harness",
  startedAt: turns[0]?.timestamp ?? "",
  state: "completed",
  turns,
};

// A list consumer memoizes its cards the way ConversationView does, so a focus change re-renders
// only the turn it moves to or from.
const MemoizedTurnCard = memo(TurnCard);

function TurnList() {
  const focus = useHashFocus();
  return (
    <section aria-label="Turn list" style={{ height: "100vh", overflowY: "auto", padding: 24 }}>
      {turns.map((entry) => (
        <MemoizedTurnCard
          key={entry.id}
          turn={entry}
          {...(focus && entry.id === focus.turnId ? { focus } : {})}
        />
      ))}
    </section>
  );
}

function ConversationHarness() {
  const focus = useHashFocus();
  return (
    <div style={{ display: "grid", height: "100vh" }}>
      <ConversationView
        continueError={null}
        conversation={conversation}
        hasMoreTurns={false}
        loadMoreTurnsError={null}
        loadingMoreTurns={false}
        onBack={() => undefined}
        onContinue={async () => undefined}
        onLoadMoreTurns={async () => undefined}
        pending={false}
        totalTurnCount={turnCount}
        {...(focus ? { focus } : {})}
      />
    </div>
  );
}

/** Shows what `onHover` last reported, so a journey reads it the way a consumer would. */
function TimelineHarness() {
  const [reading, setReading] = useState({ calls: 0, label: "none" });
  const describe = (hover: TimelineHover<null> | null) =>
    hover
      ? `${hover.entry.id} · ${hover.element.getAttribute("aria-label") ?? "unlabelled"}`
      : "none";
  return (
    <div style={{ padding: 24 }}>
      <Timeline
        expanded
        items={timelineFixture.items}
        lanes={timelineFixture.lanes}
        markers={timelineFixture.markers}
        onHover={(hover) =>
          setReading((last) => ({ calls: last.calls + 1, label: describe(hover) }))
        }
        range={timelineFixture.range}
      />
      <p aria-label="Hover reading" role="status">
        {reading.label}
      </p>
      <p aria-label="Hover reports" role="status">
        {reading.calls}
      </p>
    </div>
  );
}

const views: Record<typeof query.view, () => ReactNode> = {
  conversation: ConversationHarness,
  "pinned-list": PinnedList,
  timeline: TimelineHarness,
  "turn-list": TurnList,
};
const View = views[query.view];
document.documentElement.classList.toggle("dark", query.theme === "dark");
const root = document.getElementById("root");
if (!root) throw new Error("component harness: the page has no #root element");
// A consumer recolours the focus highlight by setting the token on an ancestor; React's style
// type has no entry for custom properties, so the one this harness sets is cast in.
const highlight = (
  query.highlight ? { "--conversation-focus-highlight": query.highlight } : {}
) as CSSProperties;
createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <div style={highlight}>
        <View />
      </div>
    </TooltipProvider>
  </StrictMode>,
);
