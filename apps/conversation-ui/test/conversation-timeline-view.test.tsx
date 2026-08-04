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
