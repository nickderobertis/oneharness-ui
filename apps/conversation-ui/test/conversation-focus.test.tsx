import { afterEach, expect, spyOn, test } from "bun:test";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConversationView } from "../src/features/conversations/components/conversation-view";
import type { Conversation } from "../src/features/conversations/presentational-types";

let scrollSpy: { mockRestore(): void } | undefined;

afterEach(() => {
  cleanup();
  scrollSpy?.mockRestore();
  scrollSpy = undefined;
});

const conversation: Conversation = {
  id: "conversation",
  name: "Focus journey",
  project: "/project",
  startedAt: "2026-08-04T12:00:00Z",
  canContinue: false,
  harnesses: ["worker"],
  state: "completed",
  turns: ["early", "later"].map((id) => ({
    id,
    assistant: "Done",
    failureKind: null,
    harness: "worker",
    model: null,
    reasoning: null,
    status: "completed",
    timestamp: "2026-08-04T12:00:00Z",
    unknown: {},
    usage: {},
    user: "Inspect",
    tools: [
      { index: 2, kind: "tool_call", name: "Read", toolCallId: "read" },
      { index: 5, kind: "tool_call", name: "Write", toolCallId: "write" },
    ],
  })),
};
const props = {
  conversation,
  continueError: null,
  hasMoreTurns: false,
  loadMoreTurnsError: null,
  loadingMoreTurns: false,
  onContinue: async () => {},
  onBack: () => {},
  onLoadMoreTurns: async () => {},
  pending: false,
  totalTurnCount: 2,
};

test("focus opens a collapsed later turn, scrolls locally, moves and recovers from missing targets", async () => {
  const user = userEvent.setup();
  const scrolled: Element[] = [];
  // Match the prototype used by the other scroll journeys, which may own this method.
  scrollSpy = spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(function (
    this: HTMLElement,
  ) {
    scrolled.push(this);
  });
  const { rerender } = render(
    <div>
      <ConversationView {...props} />
      <ConversationView {...props} />
    </div>,
  );
  const views = screen.getAllByRole("main");
  const [first, second] = views;
  if (!first || !second) throw new Error("expected two conversations");
  await user.click(within(first).getByRole("button", { name: "Collapse turn later" }));
  expect(within(first).getByRole("button", { name: "Expand turn later" })).toBeTruthy();
  rerender(
    <div>
      <ConversationView
        {...props}
        focus={{ turnId: "later", toolCallId: "write", eventIndex: 2 }}
      />
      <ConversationView {...props} />
    </div>,
  );
  const turn = within(first).getByRole("article", { name: "Turn later from worker" });
  const write = turn.querySelector('[data-tool-call-id="write"]');
  if (!write) throw new Error("expected write tool");
  expect(write.getAttribute("aria-current")).toBe("true");
  expect(
    within(turn).getByRole("button", { name: "Write tool details" }).getAttribute("aria-expanded"),
  ).toBe("true");
  expect(scrolled.includes(turn)).toBe(true);
  expect(scrolled.includes(write)).toBe(true);
  expect(second.querySelector('[aria-current="true"]')).toBeNull();
  rerender(
    <div>
      <ConversationView {...props} focus={{ turnId: "early", eventIndex: 2 }} />
      <ConversationView {...props} />
    </div>,
  );
  expect(write.hasAttribute("aria-current")).toBe(false);
  expect(
    first
      .querySelector('article[data-turn-id="early"] [data-event-index="2"]')
      ?.getAttribute("aria-current"),
  ).toBe("true");
  rerender(<ConversationView {...props} focus={{ turnId: "absent" }} />);
  expect(screen.getByRole("main").querySelector('[aria-current="true"]')).toBeNull();
  rerender(<ConversationView {...props} focus={{ turnId: "later", toolCallId: "missing" }} />);
  expect(
    screen.getByRole("article", { name: "Turn later from worker" }).getAttribute("aria-current"),
  ).toBe("true");
});
