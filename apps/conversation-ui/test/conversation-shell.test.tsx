import { afterEach, describe, expect, test } from "bun:test";
import type { Conversation, ConversationSummary } from "@oneharness-ui/ipc-contract";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConversationShell } from "../src/features/conversations/components/conversation-shell";

const summary: ConversationSummary = {
  harnesses: ["claude-code"],
  id: "session-1",
  name: "inspect-login",
  project: "/workspace/product",
  startedAt: "2026-07-15T10:00:00Z",
  turnCount: 1,
};

const conversation: Conversation = {
  canContinue: true,
  harnesses: ["claude-code"],
  id: "session-1",
  name: "inspect-login",
  project: "/workspace/product",
  startedAt: "2026-07-15T10:00:00Z",
  state: "completed",
  turns: [
    {
      assistant: "The redirect drops the return path.",
      failureKind: null,
      harness: "claude-code",
      id: "session-1-0",
      model: null,
      reasoning: null,
      status: "completed",
      timestamp: "2026-07-15T10:00:00Z",
      tools: [{ index: 0, input: { command: "rg redirect" }, kind: "tool_call", name: "Bash" }],
      unknown: {},
      usage: { inputTokens: 0, outputTokens: null },
      user: "Inspect the login issue",
    },
  ],
};

type Handler = (request: Record<string, unknown>) => unknown | Promise<unknown>;

function installBridge(handler: Handler) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/session")) return new Response(null, { status: 204 });
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json(await handler(request));
  }) as typeof fetch;
}

function success(data: unknown) {
  return { data, ok: true };
}

function listPage(
  conversations: ConversationSummary[],
  options: {
    nextCursor?: { sessionId: string; startedAt: string } | null;
    totalCount?: number;
  } = {},
) {
  return success({
    conversations,
    kind: "list",
    nextCursor: options.nextCursor ?? null,
    totalCount: options.totalCount ?? conversations.length,
  });
}

function detailPage(
  value: Conversation,
  options: { nextTurnOffset?: number | null; totalTurnCount?: number } = {},
) {
  return {
    ...value,
    nextTurnOffset: options.nextTurnOffset ?? null,
    totalTurnCount: options.totalTurnCount ?? value.turns.length,
  };
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("ConversationShell", () => {
  test("renders loading and empty states and refreshes discovery", async () => {
    let finishFirstList: (value: unknown) => void = () => {};
    const firstList = new Promise<unknown>((resolve) => {
      finishFirstList = resolve;
    });
    let listCalls = 0;
    installBridge((request) => {
      if (request.kind !== "list") throw new Error("unexpected detail request");
      listCalls += 1;
      return listCalls === 1 ? firstList : listPage([]);
    });
    const user = userEvent.setup();
    render(<ConversationShell />);

    expect(screen.getByRole("status", { name: "Loading conversations" })).toBeTruthy();
    finishFirstList(listPage([]));
    expect(await screen.findByRole("heading", { name: "No history yet" })).toBeTruthy();
    expect(screen.getByText("No recorded sessions yet.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Refresh conversations" }));
    await waitFor(() => expect(listCalls).toBe(2));
  });

  test("lists, selects, and expands safe tool detail through accessible controls", async () => {
    const detailedConversation: Conversation = {
      ...conversation,
      turns: [
        {
          ...conversation.turns[0],
          failureKind: "rate_limit",
          reasoning: "Checked the redirect boundary before answering.",
          unknown: { future_payload: { preserved: true } },
        },
      ],
    };
    installBridge((request) =>
      request.kind === "list"
        ? listPage([summary])
        : success({ conversation: detailPage(detailedConversation), kind: "get" }),
    );
    const user = userEvent.setup();
    render(<ConversationShell />);

    const item = await screen.findByRole("button", {
      name: "Open conversation inspect-login",
    });
    await user.click(item);
    expect(await screen.findByRole("heading", { name: "inspect-login" })).toBeTruthy();
    expect(screen.getByText("The redirect drops the return path.")).toBeTruthy();
    expect(screen.getByRole("note", { name: "Failure: rate_limit" })).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("Not reported")).toBeTruthy();

    await user.click(screen.getByLabelText("Bash tool details"));
    expect(screen.getByText(/rg redirect/)).toBeTruthy();
    await user.click(screen.getByText("Reasoning"));
    expect(screen.getByText("Checked the redirect boundary before answering.")).toBeTruthy();
    await user.click(screen.getByText("Additional upstream data"));
    expect(screen.getByText(/future_payload/)).toBeTruthy();
    expect(window.location.search).toBe("?session=session-1");
  });

  test("loads more conversations by keyboard and resets pagination when history changes", async () => {
    const older = { ...summary, id: "session-0", name: "older-session" };
    const newest = { ...summary, id: "session-2", name: "newest-session" };
    let firstPageCalls = 0;
    installBridge((request) => {
      if (request.kind !== "list") throw new Error("unexpected detail request");
      if (request.cursor) return listPage([older], { totalCount: 2 });
      firstPageCalls += 1;
      return firstPageCalls === 1
        ? listPage([summary], {
            nextCursor: { sessionId: summary.id, startedAt: summary.startedAt },
            totalCount: 2,
          })
        : listPage([newest]);
    });
    const user = userEvent.setup();
    render(<ConversationShell />);

    expect(await screen.findByText("1 of 2")).toBeTruthy();
    const loadMore = screen.getByRole("button", { name: "Load more conversations" });
    loadMore.focus();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("button", { name: "Open conversation older-session" }),
    ).toBeTruthy();
    expect(screen.getByText("2", { exact: true })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Refresh conversations" }));
    expect(
      await screen.findByRole("button", { name: "Open conversation newest-session" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open conversation older-session" })).toBeNull();
    expect(firstPageCalls).toBe(2);
  });

  test("loads additional turns by keyboard for the selected conversation", async () => {
    const secondTurn = {
      ...conversation.turns[0],
      assistant: "The second bounded page.",
      id: "session-1-1",
      user: "Continue reading",
    };
    const offsets: unknown[] = [];
    installBridge((request) => {
      if (request.kind === "list") return listPage([summary]);
      offsets.push(request.turnOffset);
      return success({
        conversation:
          request.turnOffset === 1
            ? detailPage({ ...conversation, turns: [secondTurn] }, { totalTurnCount: 2 })
            : detailPage(conversation, { nextTurnOffset: 1, totalTurnCount: 2 }),
        kind: "get",
      });
    });
    const user = userEvent.setup();
    render(<ConversationShell />);

    await user.click(
      await screen.findByRole("button", { name: "Open conversation inspect-login" }),
    );
    const loadMore = await screen.findByRole("button", { name: "Load more turns" });
    loadMore.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("The second bounded page.")).toBeTruthy();
    expect(screen.getByText("The redirect drops the return path.")).toBeTruthy();
    expect(offsets).toEqual([undefined, 1]);
  });

  test("restores a deep link, continues, and selects the refreshed session", async () => {
    window.history.replaceState(null, "", "/?session=session-1");
    const continued: Conversation = {
      ...conversation,
      id: "session-2",
      turns: [
        {
          ...conversation.turns[0],
          assistant: "The smallest fix preserves the return path.",
          id: "session-2-0",
          user: "Propose the smallest fix",
        },
      ],
    };
    let finishContinuation: (value: unknown) => void = () => {};
    const continuation = new Promise<unknown>((resolve) => {
      finishContinuation = resolve;
    });
    installBridge((request) => {
      if (request.kind === "list") return listPage([summary]);
      if (request.kind === "continue") return continuation;
      return success({ conversation: detailPage(conversation), kind: "get" });
    });
    const user = userEvent.setup();
    render(<ConversationShell />);

    const reply = await screen.findByRole("textbox", { name: "Continue this session" });
    await user.type(reply, "Propose the smallest fix");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(await screen.findByText("Continuing session…")).toBeTruthy();
    expect(screen.getByText("Running", { exact: true })).toBeTruthy();
    expect((reply as HTMLTextAreaElement).disabled).toBe(true);
    finishContinuation(
      success({
        conversation: detailPage(continued),
        kind: "continue",
        selectedSessionId: "session-2",
      }),
    );
    expect(await screen.findByText("The smallest fix preserves the return path.")).toBeTruthy();
    expect(window.location.search).toBe("?session=session-2");
  });

  test("keeps a failed reply visible for recovery", async () => {
    window.history.replaceState(null, "", "/?session=session-1");
    installBridge((request) => {
      if (request.kind === "list") return listPage([summary]);
      if (request.kind === "continue") {
        return {
          error: {
            code: "ONEHARNESS_ERROR",
            message: "The provider is temporarily unavailable",
          },
          ok: false,
        };
      }
      return success({
        conversation: detailPage({ ...conversation, state: "future-paused" }),
        kind: "get",
      });
    });
    const user = userEvent.setup();
    render(<ConversationShell />);

    expect(await screen.findByText("future-paused", { exact: true })).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Continue this session" }), "Retry safely");
    await user.click(screen.getByRole("button", { name: "Send reply" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The provider is temporarily unavailable",
    );
  });

  test("shows selected-session detail errors and retries them", async () => {
    window.history.replaceState(null, "", "/?session=session-1");
    let getCalls = 0;
    installBridge((request) => {
      if (request.kind === "list") return listPage([summary]);
      getCalls += 1;
      if (getCalls === 1) {
        return {
          error: {
            code: "MALFORMED_HISTORY",
            detail: "/history/session-1.jsonl: invalid schema_version",
            message: "The selected history is malformed",
          },
          ok: false,
        };
      }
      return success({ conversation: detailPage(conversation), kind: "get" });
    });
    const user = userEvent.setup();
    render(<ConversationShell />);

    expect(await screen.findByText("The selected history is malformed")).toBeTruthy();
    await user.click(screen.getByText("Technical detail"));
    expect(screen.getByText(/invalid schema_version/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("The redirect drops the return path.")).toBeTruthy();
    expect(getCalls).toBe(2);
  });

  test("shows ineligible and failure/retry states without hiding details", async () => {
    let fail = true;
    installBridge((request) => {
      if (fail) throw "connection refused";
      if (request.kind === "list") {
        return listPage([summary]);
      }
      return success({
        conversation: detailPage({ ...conversation, canContinue: false, state: "failed" }),
        kind: "get",
      });
    });
    const user = userEvent.setup();
    render(<ConversationShell />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Couldn't load conversations/)).toBeTruthy();
    expect(screen.getByText("connection refused")).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole("button", { name: /retry/i }));
    const item = await screen.findByRole("button", { name: /inspect-login/i });
    await user.click(item);
    expect(await screen.findByRole("note")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Continue this session" })).toBeNull();
  });

  test("surfaces malformed bridge responses at the UI boundary", async () => {
    installBridge(() => ({ ok: true, data: { kind: "list", conversations: "bad" } }));
    render(<ConversationShell />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/Couldn't load conversations/)).toBeTruthy();
  });
});
