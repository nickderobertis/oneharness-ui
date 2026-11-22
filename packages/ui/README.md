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

`ConversationView` and `ConversationTimeline` accept, and `TurnCard` takes for its own turn,
`focus?: { turnId: string; toolCallId?: string; eventIndex?: number; part?: "prompt" | "answer" | "end" }`.
A tool call ID takes precedence over an event index, which takes precedence over a part. An
event index matches a tool call, an agent message or a reasoning item. A part names the turn's
prompt (its "You" block), its answer (the final assistant text, or the note standing in for it)
or its end (the usage chips and any failure note). With none of the three, or one naming nothing
in the turn, the turn's article is focused. The focused element alone carries
`aria-current="true"`; a part also carries `data-turn-part`, which every part has. It is
outlined, with a faint tint, in `--conversation-focus-highlight`, which both themes set to their
`--primary`; set it on any ancestor of the conversation to recolour the highlight.

A focused turn, reasoning item or tool call that starts collapsed is open on the render that
carries the focus. Before that render is painted, and again whenever the focus changes, the
nearest scrollable ancestor is scrolled so the focused element's top sits at the container's
visible top plus `--conversation-focus-offset` (default `0px`): set it on any ancestor to the
height of whatever you pin over the top of that container. An element taller than the space
left has its top there and fills the rest. Until the focus changes or the reader scrolls, the
element's top is held there while content around it settles. `ConversationView` adds its own
sticky timeline to the offset. Focus waits for a missing turn to arrive in the supplied data; the
consumer owns loading it.
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
