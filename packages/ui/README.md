# @oneharness/ui

Presentational React components and hooks for rendering oneharness conversation history.

```tsx
import { ConversationView } from "@oneharness/ui";
import "@oneharness/ui/styles.css";
```

The stylesheet uses Tailwind CSS v4 and includes the theme tokens, transcript markdown,
formatted JSON, and syntax-highlight styles used by the components. Add the Inter and
JetBrains Mono variable fonts in the consumer when matching the desktop app typography.

React, Radix primitives, form/markdown dependencies, and Tailwind utilities remain peer
dependencies so consumers keep one runtime copy. The exported conversation types are
structural TypeScript interfaces and do not depend on the desktop app's Zod validators.

The components stay presentational, so a consumer that follows a session live owns the
transport itself: keep re-rendering `ConversationView` with the grown `conversation.turns`
and pass `live` to show its live indicator.

`ConversationView` and `ConversationTimeline` accept
`focus?: { turnId: string; toolCallId?: string; eventIndex?: number }`.
Setting or changing it scrolls to the turn, opens a collapsed turn and its tool details,
and marks the target with `aria-current="true"`. An event index matches a tool call, an
agent message or a reasoning item. A tool call ID takes precedence over an event index;
an unknown target falls back to its turn in the transcript. The focused item is outlined,
with a faint tint, in `--conversation-focus-highlight`, which both themes set to their
`--primary`; set it on any ancestor of the conversation to recolour the highlight. Focus waits
for a missing turn to arrive in the supplied data; the consumer owns loading it.
Every transcript turn has `data-turn-id`; tool, agent message and reasoning entries have
`data-event-index`, and tool entries, when reported, `data-tool-call-id`. Paired call/result entries use the call's index.
Selectors and scrolling are scoped to each rendered instance.

`Timeline` accepts `ticks?: { minSpacingPx?: number }` (default spacing: 80 px).
Axis markers use round second, minute or hour intervals and adapt to plot width and
zoom. `crosshair?: boolean` defaults to `true`: hovering the plot shows a vertical
line labeled with absolute ISO time and elapsed time since `axis.origin` (or the
first recorded time). Set `crosshair={false}` to hide it.

`onHover?: (hover: { entry; element } | null) => void` reports what the pointer resolves to
anywhere over the plot, whenever that changes: the item or marker under the pointer, or
else the one nearest it horizontally, so a marker past the last bar is found from the
marker row. `element` is that entry's bar or marker glyph, which carries
`data-timeline-hovered="true"` while it is resolved. It is called with `null` once the
pointer leaves the plot.
