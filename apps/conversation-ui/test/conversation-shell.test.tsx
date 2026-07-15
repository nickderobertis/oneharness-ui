import { afterEach, describe, expect, test } from "bun:test";
import type { Conversation, ConversationSummary } from "@oneharness-ui/ipc-contract";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConversationShell } from "../src/features/conversations/components/conversation-shell";

const summary: ConversationSummary = {
  canContinue: true,
  harnesses: ["claude-code"],
  id: "session-1",
  name: "inspect-login",
  preview: "Inspect the login issue",
  project: "/workspace/product",
  startedAt: "2026-07-15T10:00:00Z",
  state: "completed",
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
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json(await handler(request));
  }) as typeof fetch;
}

function success(data: unknown) {
  return { data, ok: true };
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
      return listCalls === 1 ? firstList : success({ conversations: [], kind: "list" });
    });
    const user = userEvent.setup();
    render(<ConversationShell />);

    expect(screen.getByRole("status", { name: "Loading conversations" })).toBeTruthy();
    finishFirstList(success({ conversations: [], kind: "list" }));
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
          reasoning: "Checked the redirect boundary before answering.",
          unknown: { future_payload: { preserved: true } },
        },
      ],
    };
    installBridge((request) =>
      request.kind === "list"
        ? success({ conversations: [summary], kind: "list" })
        : success({ conversation: detailedConversation, kind: "get" }),
    );
    const user = userEvent.setup();
    render(<ConversationShell />);

    const item = await screen.findByRole("button", { name: /inspect-login/i });
    await user.click(item);
    expect(await screen.findByRole("heading", { name: "inspect-login" })).toBeTruthy();
    expect(screen.getByText("The redirect drops the return path.")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("Not reported")).toBeTruthy();

    await user.click(screen.getByText("Bash"));
    expect(screen.getByText(/rg redirect/)).toBeTruthy();
    await user.click(screen.getByText("Reasoning"));
    expect(screen.getByText("Checked the redirect boundary before answering.")).toBeTruthy();
    await user.click(screen.getByText("Additional upstream data"));
    expect(screen.getByText(/future_payload/)).toBeTruthy();
    expect(window.location.search).toBe("?session=session-1");
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
      if (request.kind === "list") return success({ conversations: [summary], kind: "list" });
      if (request.kind === "continue") return continuation;
      return success({ conversation, kind: "get" });
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
        conversation: continued,
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
      if (request.kind === "list") return success({ conversations: [summary], kind: "list" });
      if (request.kind === "continue") {
        return {
          error: {
            code: "ONEHARNESS_ERROR",
            message: "The provider is temporarily unavailable",
          },
          ok: false,
        };
      }
      return success({ conversation: { ...conversation, state: "future-paused" }, kind: "get" });
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
      if (request.kind === "list") return success({ conversations: [summary], kind: "list" });
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
      return success({ conversation, kind: "get" });
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
      if (fail) throw new Error("connection refused");
      if (request.kind === "list") {
        return success({
          conversations: [{ ...summary, canContinue: false, state: "failed" }],
          kind: "list",
        });
      }
      return success({
        conversation: { ...conversation, canContinue: false, state: "failed" },
        kind: "get",
      });
    });
    const user = userEvent.setup();
    render(<ConversationShell />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Couldn't load conversations/)).toBeTruthy();
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
