import { afterEach, describe, expect, test } from "bun:test";
import type { ConversationTurn } from "@oneharness-ui/ipc-contract";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConversationTimeline } from "../src/features/conversations/components/conversation-timeline-view";

afterEach(cleanup);

const turn: ConversationTurn = {
  assistant: "Done",
  failureKind: null,
  harness: "worker",
  id: "turn-1",
  model: null,
  reasoning: null,
  status: "completed",
  timestamp: "2026-08-04T12:00:00Z",
  tools: [{ index: 0, kind: "tool_call", name: "Read" }],
  unknown: {},
  usage: {},
  user: "Inspect it",
};

describe("ConversationTimeline", () => {
  test("starts on one line, expands, and selects the owning turn from tool activity", async () => {
    const selected: string[] = [];
    const user = userEvent.setup();
    render(<ConversationTimeline onSelectTurn={(id) => selected.push(id)} turns={[turn]} />);

    expect(screen.getAllByTestId("timeline-lane")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Expand timeline" }));
    expect(screen.getAllByTestId("timeline-lane")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Read, point event" }));
    expect(selected).toEqual(["turn-1"]);
  });
});

test("focus selects and scrolls the tool locally, including paired result indices", () => {
  const scrolled: Element[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {
    scrolled.push(this);
  };
  const turns = [
    {
      ...turn,
      tools: [
        { index: 0, kind: "tool_call", name: "Read" },
        { index: 3, kind: "tool_result", output: "Done" },
      ],
    },
  ];
  try {
    const { rerender } = render(
      <ConversationTimeline
        focus={{ turnId: turn.id, eventIndex: 3 }}
        onSelectTurn={() => {}}
        turns={turns}
      />,
    );
    const tool = screen.getByRole("button", { name: "Read, point event" });
    expect(tool.getAttribute("aria-current")).toBe("true");
    expect(tool.getAttribute("data-event-index")).toBe("0");
    expect(scrolled).toContain(tool);
    expect(screen.getAllByTestId("timeline-lane")).toHaveLength(2);
    rerender(
      <ConversationTimeline focus={{ turnId: turn.id }} onSelectTurn={() => {}} turns={turns} />,
    );
    expect(tool.hasAttribute("aria-current")).toBe(false);
    expect(
      screen.getByRole("button", { name: "worker turn, point event" }).getAttribute("aria-current"),
    ).toBe("true");
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});
