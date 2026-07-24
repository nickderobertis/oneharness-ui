import { afterEach, expect, test } from "bun:test";
import {
  type Conversation as IpcConversation,
  type ConversationSummary as IpcConversationSummary,
  type ConversationTurn as IpcConversationTurn,
  conversationLabelMaxLength as ipcConversationLabelMaxLength,
  conversationLabelsMaxCount as ipcConversationLabelsMaxCount,
} from "@oneharness-ui/ipc-contract";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  type Conversation,
  type ConversationSummary,
  type ConversationTurn,
  ConversationView,
  conversationLabelMaxLength,
  conversationLabelsMaxCount,
  ReplyForm,
} from "../src";
import { TooltipProvider } from "../src/primitives";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;

const conversationContractMatches: Equal<Conversation, IpcConversation> = true;
const summaryContractMatches: Equal<ConversationSummary, IpcConversationSummary> = true;
const turnContractMatches: Equal<ConversationTurn, IpcConversationTurn> = true;

afterEach(cleanup);

test("the public conversation surface renders transcript state", () => {
  render(
    <ConversationView
      conversation={{
        canContinue: false,
        harnesses: ["worker"],
        id: "session",
        name: "Worker history",
        project: "oneharness",
        startedAt: "2026-01-01T00:00:00Z",
        state: "completed",
        turns: [],
      }}
      continueError={null}
      hasMoreTurns={false}
      loadMoreTurnsError={null}
      loadingMoreTurns={false}
      onBack={() => undefined}
      onContinue={async () => undefined}
      onLoadMoreTurns={async () => undefined}
      pending={false}
      totalTurnCount={0}
    />,
  );

  expect(screen.getByRole("heading", { name: "Worker history" })).not.toBeNull();
  expect(screen.getByText("Completed")).not.toBeNull();
  expect(screen.getByText("This session can’t be continued.")).not.toBeNull();
});

test("the public reply form validates a user submission", async () => {
  const user = userEvent.setup();
  render(
    <TooltipProvider>
      <ReplyForm error={null} onSubmit={async () => undefined} pending={false} />
    </TooltipProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Send reply" }));

  expect((await screen.findByRole("alert")).textContent).toContain("Write a message first");
});

test("the presentational contract stays aligned with the validated IPC contract", () => {
  expect(conversationContractMatches).toBe(true);
  expect(summaryContractMatches).toBe(true);
  expect(turnContractMatches).toBe(true);
  expect(conversationLabelMaxLength).toBe(ipcConversationLabelMaxLength);
  expect(conversationLabelsMaxCount).toBe(ipcConversationLabelsMaxCount);
});
