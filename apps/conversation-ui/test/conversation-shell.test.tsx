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
  test("lists, selects, and expands safe tool detail through accessible controls", async () => {
    installBridge((request) =>
      request.kind === "list"
        ? success({ conversations: [summary], kind: "list" })
        : success({ conversation, kind: "get" }),
    );
    const user = userEvent.setup();
    render(<ConversationShell />);

    const item = await screen.findByRole("button", { name: /inspect-login/i });
    await user.click(item);
    expect(await screen.findByRole("heading", { name: "inspect-login" })).toBeTruthy();
    expect(screen.queryByText("Reasoning")).toBeNull();
    expect(screen.getByText("The redirect drops the return path.")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("Not reported")).toBeTruthy();

    await user.click(screen.getByText("Bash"));
    expect(screen.getByText(/rg redirect/)).toBeTruthy();
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
    installBridge((request) => {
      if (request.kind === "list") return success({ conversations: [summary], kind: "list" });
      if (request.kind === "continue") {
        return success({
          conversation: continued,
          kind: "continue",
          selectedSessionId: "session-2",
        });
      }
      return success({ conversation, kind: "get" });
    });
    const user = userEvent.setup();
    render(<ConversationShell />);

    const reply = await screen.findByRole("textbox", { name: "Continue this session" });
    await user.type(reply, "Propose the smallest fix");
    await user.click(screen.getByRole("button", { name: "Send reply" }));
    expect(await screen.findByText("The smallest fix preserves the return path.")).toBeTruthy();
    expect(window.location.search).toBe("?session=session-2");
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
