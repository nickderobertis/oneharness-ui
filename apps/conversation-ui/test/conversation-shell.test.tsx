import { afterEach, describe, expect, test } from "bun:test";
import type { Conversation, ConversationSummary } from "@oneharness-ui/ipc-contract";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConversationShell } from "../src/features/conversations/components/conversation-shell";

class TestIntersectionObserver {
  static intersectingRoots = new Set<Element>();
  static observers = new Set<TestIntersectionObserver>();
  readonly root: Document | Element | null;
  private readonly callback: IntersectionObserverCallback;
  private target: Element | null = null;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.root = options?.root ?? null;
    TestIntersectionObserver.observers.add(this);
  }

  static intersect(root: Element): void {
    TestIntersectionObserver.intersectingRoots.add(root);
    for (const observer of TestIntersectionObserver.observers) {
      if (observer.root === root) observer.notifyIfIntersecting();
    }
  }

  static reset(): void {
    TestIntersectionObserver.intersectingRoots.clear();
    TestIntersectionObserver.observers.clear();
  }

  disconnect(): void {
    TestIntersectionObserver.observers.delete(this);
  }

  observe(target: Element): void {
    this.target = target;
    this.notifyIfIntersecting();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve(target: Element): void {
    if (target === this.target) this.target = null;
  }

  private notifyIfIntersecting(): void {
    if (
      !(this.root instanceof Element) ||
      !TestIntersectionObserver.intersectingRoots.has(this.root) ||
      !this.target
    )
      return;
    this.callback(
      [{ isIntersecting: true, target: this.target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

globalThis.IntersectionObserver =
  TestIntersectionObserver as unknown as typeof IntersectionObserver;

const summary: ConversationSummary = {
  harnesses: ["claude-code"],
  id: "session-1",
  labels: [],
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
  TestIntersectionObserver.reset();
  window.history.replaceState(null, "", "/");
});

describe("ConversationShell", () => {
  test("groups and filters by project and persists accessible labels with failure recovery", async () => {
    const second = {
      ...summary,
      id: "session-2",
      labels: ["backend"],
      name: "ship-api",
      project: "/workspace/api",
    };
    let failSave = true;
    let savedLabels: string[] = [];
    installBridge((request) => {
      if (request.kind === "set-labels") {
        if (failSave) {
          failSave = false;
          return { error: { code: "IO_ERROR", message: "Label storage is busy" }, ok: false };
        }
        savedLabels = request.labels as string[];
        return success({ kind: "set-labels", labels: savedLabels, sessionId: summary.id });
      }
      if (request.kind !== "list") throw new Error("unexpected detail request");
      return listPage([{ ...summary, labels: savedLabels }, second]);
    });
    const user = userEvent.setup();
    render(<ConversationShell />);

    const organize = await screen.findByRole("combobox", { name: "Organize by" });
    await user.selectOptions(organize, "label");
    expect(screen.getByRole("heading", { name: "Unlabeled" })).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter label" }), "Unlabeled");
    expect(screen.getByRole("button", { name: "Open conversation inspect-login" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open conversation ship-api" })).toBeNull();

    await user.selectOptions(organize, "project");
    expect(screen.getByRole("heading", { name: "/workspace/product" })).toBeTruthy();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter project" }),
      "/workspace/api",
    );
    expect(screen.getByRole("button", { name: "Open conversation ship-api" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open conversation inspect-login" })).toBeNull();

    await user.selectOptions(organize, "label");
    await user.click(screen.getAllByRole("button", { name: "Edit labels" })[0] as HTMLElement);
    await user.type(
      screen.getByRole("textbox", { name: "Labels for inspect-login" }),
      "urgent, frontend",
    );
    await user.click(screen.getByRole("button", { name: "Save labels" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Label storage is busy");
    await user.click(screen.getByRole("button", { name: "Save labels" }));
    expect(await screen.findByRole("heading", { name: "frontend" })).toBeTruthy();
    expect(savedLabels).toEqual(["urgent", "frontend"]);
  });
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

  test("renders safe markdown, highlighted code, and whole-message JSON", async () => {
    const richConversation: Conversation = {
      ...conversation,
      turns: [
        {
          ...conversation.turns[0],
          assistant: "**Fixed** with:\n\n```ts\nconst safe = true;\n```",
          user: "Please use *TypeScript*. <img src=x onerror=alert('unsafe')>",
        },
        {
          ...conversation.turns[0],
          assistant: '{"status":"ready","items":[1,2]}',
          id: "session-1-1",
          tools: [],
          user: "Return JSON",
        },
      ],
    };
    installBridge((request) =>
      request.kind === "list"
        ? listPage([summary])
        : success({ conversation: detailPage(richConversation), kind: "get" }),
    );
    const user = userEvent.setup();
    const { container } = render(<ConversationShell />);

    await user.click(
      await screen.findByRole("button", { name: "Open conversation inspect-login" }),
    );
    expect(await screen.findByText("Fixed")).toMatchObject({ tagName: "STRONG" });
    expect(screen.getByText("TypeScript")).toMatchObject({ tagName: "EM" });
    const highlightedCode = screen.getByText("const");
    expect(highlightedCode.classList.contains("hljs-keyword")).toBe(true);
    expect(highlightedCode.closest("pre")).toBeTruthy();
    expect(screen.getByLabelText("Assistant message formatted JSON").textContent).toContain(
      '  "status": "ready"',
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
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
    expect(screen.getByRole("status", { name: "1 of 2 conversations loaded" })).toBeTruthy();
    const loadMore = screen.getByRole("button", { name: "Load more conversations" });
    loadMore.focus();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("button", { name: "Open conversation older-session" }),
    ).toBeTruthy();
    expect(screen.getByText("2", { exact: true })).toBeTruthy();
    expect(screen.getByRole("status", { name: "2 of 2 conversations loaded" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Refresh conversations" }));
    expect(
      await screen.findByRole("button", { name: "Open conversation newest-session" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open conversation older-session" })).toBeNull();
    expect(firstPageCalls).toBe(2);
  });

  test("automatically loads three conversation pages while the sentinel stays near the scroll end", async () => {
    const second = { ...summary, id: "session-2", name: "middle-session" };
    const third = { ...summary, id: "session-3", name: "oldest-session" };
    let resolveSecondPage: (value: unknown) => void = () => {};
    const secondPage = new Promise<unknown>((resolve) => {
      resolveSecondPage = resolve;
    });
    const cursors: unknown[] = [];
    installBridge((request) => {
      if (request.kind !== "list") throw new Error("unexpected detail request");
      cursors.push(request.cursor);
      if (!request.cursor) {
        return listPage([summary], {
          nextCursor: { sessionId: summary.id, startedAt: summary.startedAt },
          totalCount: 3,
        });
      }
      if ((request.cursor as { sessionId: string }).sessionId === summary.id) {
        return secondPage;
      }
      return listPage([third], { totalCount: 3 });
    });
    render(<ConversationShell />);

    expect(await screen.findByText("1 of 3")).toBeTruthy();
    const history = screen.getByRole("navigation", { name: "Conversation history" });
    TestIntersectionObserver.intersect(history);
    TestIntersectionObserver.intersect(history);
    await waitFor(() => expect(cursors).toHaveLength(2));
    resolveSecondPage(
      listPage([second], {
        nextCursor: { sessionId: second.id, startedAt: second.startedAt },
        totalCount: 3,
      }),
    );
    expect(await screen.findByRole("status", { name: "All 3 conversations loaded" })).toBeTruthy();
    expect(
      screen
        .getAllByRole("listitem", { name: /Session ID/ })
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual(["Session ID session-1", "Session ID session-2", "Session ID session-3"]);
    expect(cursors).toHaveLength(3);
  });

  test("keeps loaded conversations visible when automatic pagination fails and retries", async () => {
    let pageCalls = 0;
    installBridge((request) => {
      if (request.kind !== "list") throw new Error("unexpected detail request");
      if (!request.cursor) {
        return listPage([summary], {
          nextCursor: { sessionId: summary.id, startedAt: summary.startedAt },
          totalCount: 2,
        });
      }
      pageCalls += 1;
      return pageCalls === 1
        ? {
            error: { code: "IO_ERROR", message: "History storage is temporarily busy" },
            ok: false,
          }
        : listPage([{ ...summary, id: "session-0", name: "recovered-session" }], {
            totalCount: 2,
          });
    });
    const user = userEvent.setup();
    render(<ConversationShell />);

    await screen.findByText("1 of 2");
    TestIntersectionObserver.intersect(
      screen.getByRole("navigation", { name: "Conversation history" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn’t load more conversations. History storage is temporarily busy",
    );
    expect(screen.getByRole("button", { name: "Open conversation inspect-login" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry loading conversations" }));
    expect(
      await screen.findByRole("button", { name: "Open conversation recovered-session" }),
    ).toBeTruthy();
    expect(screen.getByText("All 2 conversations loaded")).toBeTruthy();
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

  test("automatically loads three turn pages while its sentinel stays near the scroll end", async () => {
    const turns = Array.from({ length: 3 }, (_, index) => ({
      ...conversation.turns[0],
      assistant: `Bounded answer ${index}`,
      id: `session-1-${index}`,
      user: `Prompt ${index}`,
    }));
    const offsets: unknown[] = [];
    installBridge((request) => {
      if (request.kind === "list") return listPage([summary]);
      offsets.push(request.turnOffset);
      const offset = typeof request.turnOffset === "number" ? request.turnOffset : 0;
      return success({
        conversation: detailPage(
          { ...conversation, turns: [turns[offset] ?? turns[0]] },
          { nextTurnOffset: offset < 2 ? offset + 1 : null, totalTurnCount: 3 },
        ),
        kind: "get",
      });
    });
    const user = userEvent.setup();
    render(<ConversationShell />);

    await user.click(
      await screen.findByRole("button", { name: "Open conversation inspect-login" }),
    );
    const turnHistory = await screen.findByRole("region", { name: "Conversation turns" });
    TestIntersectionObserver.intersect(turnHistory);
    expect(await screen.findByRole("status", { name: "All 3 turns loaded" })).toBeTruthy();
    expect(screen.getAllByRole("article").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Turn session-1-0 from claude-code",
      "Turn session-1-1 from claude-code",
      "Turn session-1-2 from claude-code",
    ]);
    expect(offsets).toEqual([undefined, 1, 2]);
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
