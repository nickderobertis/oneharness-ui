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
