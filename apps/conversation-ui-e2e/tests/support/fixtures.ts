/** Data the component harness renders and the journeys reason about, shared so they agree. */

export const turnCount = 200;
/** Where each focusable item sits in every fixture turn's recorded event stream. */
export const focusEventIndex = { message: 3, reasoning: 0, tool: 1 } as const;
export type FocusKind = keyof typeof focusEventIndex;
/**
 * The turn each kind is focused in: far enough down the list that each starts below the fold,
 * even of the view the previous focus scrolled to.
 */
export const focusedTurnIds: Readonly<Record<FocusKind, string>> = {
  message: "turn-150",
  reasoning: "turn-160",
  tool: "turn-170",
};

/** The pinned-list view: more turns than the fold by far, under a sticky summary this tall. */
export const pinnedTurnCount = 220;
export const pinnedOffsetPx = 96;
/** Turns whose prompt, or whose reasoning item, runs to several screens. */
export const tallTurnIds = { prompt: "turn-100", reasoning: "turn-110" } as const;
/**
 * Each focus the pinned-list view can open on, by the hash that names it: every focus kind, the
 * two taller than the visible area, and two whose item starts collapsed in a mounted list.
 */
export const pinnedFocuses = {
  answer: { part: "answer", turnId: "turn-130" },
  "collapsed-reasoning": { eventIndex: focusEventIndex.reasoning, turnId: "turn-80" },
  "collapsed-turn-tool": { toolCallId: "call-60", turnId: "turn-60" },
  end: { part: "end", turnId: "turn-140" },
  message: { eventIndex: focusEventIndex.message, turnId: "turn-150" },
  prompt: { part: "prompt", turnId: "turn-120" },
  reasoning: { eventIndex: focusEventIndex.reasoning, turnId: "turn-160" },
  "tall-prompt": { part: "prompt", turnId: tallTurnIds.prompt },
  "tall-reasoning": { eventIndex: focusEventIndex.reasoning, turnId: tallTurnIds.reasoning },
  tool: { toolCallId: "call-170", turnId: "turn-170" },
} as const;
export type PinnedFocusName = keyof typeof pinnedFocuses;

const origin = Date.UTC(2026, 10, 20, 9, 0, 0);
const at = (seconds: number) => origin + seconds * 1_000;

/**
 * Three bars that end at 60 s, a marker over the first, and three markers after the last bar,
 * on a 100 s range so no marker glyph sits on the plot's clipped edge.
 */
export const timelineFixture = {
  items: [
    {
      end: at(20),
      id: "plan",
      label: "Plan the run",
      laneId: "agent",
      payload: null,
      start: at(0),
    },
    {
      end: at(35),
      id: "tests",
      label: "Run the tests",
      laneId: "tools",
      payload: null,
      start: at(25),
    },
    {
      end: at(60),
      id: "patch",
      label: "Write the patch",
      laneId: "agent",
      payload: null,
      start: at(40),
    },
  ],
  lanes: [
    { id: "agent", label: "Agent" },
    { id: "tools", label: "Tools" },
  ],
  markers: [
    { at: at(10), id: "checkpoint", label: "Checkpoint", payload: null },
    { at: at(70), id: "review-requested", label: "Review requested", payload: null },
    { at: at(80), id: "review-passed", label: "Review passed", payload: null },
    { at: at(90), id: "merged", label: "Merged", payload: null },
  ],
  range: [at(0), at(100)] as const,
};
export const timelineRangeSeconds = 100;
