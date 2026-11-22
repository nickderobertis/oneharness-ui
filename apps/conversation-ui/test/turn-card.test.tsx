import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ConversationToolEvent, ConversationTurn } from "@oneharness-ui/ipc-contract";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { TurnCard } from "../src/features/conversations/components/turn-card";

afterEach(cleanup);

function turnWith(tools: ConversationToolEvent[]): ConversationTurn {
  return {
    assistant: "Inspected the redirect.",
    failureKind: null,
    harness: "claude-code",
    id: "session-1-0",
    model: null,
    reasoning: null,
    status: "completed",
    timestamp: "2026-07-15T10:00:00Z",
    tools,
    unknown: {},
    usage: {},
    user: "Inspect the login issue",
  };
}

describe("TurnCard tool invocations", () => {
  test("keeps the default transcript markup with a turn locator and collapse control", async () => {
    const expected = await readFile(
      resolve(import.meta.dir, "goldens/turn-card-default.html"),
      "utf8",
    );
    expect(renderToStaticMarkup(<TurnCard turn={turnWith([])} />)).toBe(expected.trimEnd());
  });

  test("keeps the default identity and renders a custom author identity when supplied", () => {
    const { rerender } = render(<TurnCard turn={turnWith([])} />);
    expect(screen.getByText("OH")).toBeTruthy();
    expect(screen.getByText("claude-code")).toBeTruthy();

    rerender(
      <TurnCard
        author={{ avatar: "https://example.test/judge.png", label: "Judge" }}
        turn={turnWith([])}
      />,
    );
    expect(screen.getByText("Judge")).toBeTruthy();
    expect(document.querySelector('img[src="https://example.test/judge.png"]')).toBeTruthy();
    expect(screen.queryByText("claude-code")).toBeNull();
  });

  test("interleaves the agent's messages, reasoning and tool calls in recorded order", async () => {
    const user = userEvent.setup();
    render(
      <TurnCard
        turn={{
          ...turnWith([
            {
              index: 1,
              input: { command: "pwd" },
              kind: "tool_call",
              name: "Bash",
              toolCallId: "t1",
            },
            { index: 2, kind: "tool_result", output: "/repo", toolCallId: "t1" },
          ]),
          agentEvents: [
            { index: 3, kind: "message", text: "The repository is at **/repo**." },
            { index: 0, kind: "reasoning", text: "Check the working directory first." },
          ],
          reasoning: "Check the working directory first.",
        }}
      />,
    );
    const activity = screen.getByRole("region", { name: "Agent activity" });
    const reasoning = within(activity).getByRole("button", { name: "Reasoning" });
    const tool = within(activity).getByRole("button", { name: "Bash tool details" });
    const message = within(activity).getByRole("group", { name: "Agent message" });
    const follows = (earlier: Element, later: Element) =>
      Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(reasoning, tool)).toBe(true);
    expect(follows(tool, message)).toBe(true);
    // The stream carries the reasoning, so the turn draws no second copy above it.
    expect(screen.getAllByRole("button", { name: "Reasoning" })).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Tool calls" })).toBeNull();
    expect(message.querySelector("strong")?.textContent).toBe("/repo");
    await user.click(reasoning);
    expect(within(activity).getByText("Check the working directory first.")).toBeTruthy();
    await user.click(tool);
    expect(within(activity).getByLabelText("Bash tool output").textContent).toBe("/repo");
  });

  test("focuses an agent message, a reasoning item or a tool call by event index", () => {
    const turn: ConversationTurn = {
      ...turnWith([{ index: 1, kind: "tool_call", name: "Bash", toolCallId: "t1" }]),
      agentEvents: [
        { index: 0, kind: "reasoning", text: "Plan first." },
        { index: 2, kind: "message", text: "Done." },
      ],
    };
    const { rerender } = render(<TurnCard turn={turn} />);
    const activity = screen.getByRole("region", { name: "Agent activity" });
    const current = () =>
      [...document.querySelectorAll('[aria-current="true"]')].map((element) => [
        element.getAttribute("data-event-index"),
        element.classList.contains("conversation-focus-highlight"),
      ]);
    expect(current()).toEqual([]);
    expect(within(activity).getByRole("group", { name: "Agent message" }).dataset.eventIndex).toBe(
      "2",
    );
    for (const [eventIndex, kind] of [
      [2, "message"],
      [0, "reasoning"],
      [1, "tool call"],
    ] as const) {
      rerender(<TurnCard focus={{ eventIndex, turnId: turn.id }} turn={turn} />);
      expect({ current: current(), kind }).toEqual({ current: [[String(eventIndex), true]], kind });
    }
    rerender(<TurnCard focus={{ eventIndex: 9, turnId: turn.id }} turn={turn} />);
    expect(screen.getByRole("article").getAttribute("aria-current")).toBe("true");
    expect(document.querySelectorAll(".conversation-focus-highlight")).toHaveLength(0);
  });

  test("keeps the turn's reasoning above the stream when no reasoning event carries it", () => {
    render(
      <TurnCard
        turn={{
          ...turnWith([]),
          agentEvents: [{ index: 0, kind: "message", text: "Looking now." }],
          reasoning: "Recorded only on the run.",
        }}
      />,
    );
    const reasoning = screen.getByRole("button", { name: "Reasoning" });
    const activity = screen.getByRole("region", { name: "Agent activity" });
    expect(activity.contains(reasoning)).toBe(false);
    expect(
      reasoning.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("says a running turn's prompt and answer are still to come", () => {
    render(<TurnCard turn={{ ...turnWith([]), assistant: null, status: "running", user: "" }} />);
    expect(screen.getByText("The prompt is recorded when this run finishes.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      "Still running. Its final answer appears when the run finishes.",
    );
    expect(screen.queryByText("No assistant text was captured for this run.")).toBeNull();
  });

  test("pairs a call with its result by tool call id and expands both payloads", async () => {
    const user = userEvent.setup();
    render(
      <TurnCard
        turn={turnWith([
          {
            durationMs: 240,
            finishedAt: "2026-07-15T10:00:01Z",
            index: 0,
            input: { command: "rg redirect" },
            kind: "tool_call",
            name: "Bash",
            startedAt: "2026-07-15T10:00:00Z",
            status: "completed",
            timingSource: "stdout_observed",
            toolCallId: "call-1",
          },
          {
            index: 1,
            kind: "tool_result",
            output: '{"matches":1}',
            toolCallId: "call-1",
          },
        ])}
      />,
    );

    const triggers = screen.getAllByRole("button", { name: /tool details/ });
    expect(triggers).toHaveLength(1);
    expect(screen.getByText("Bash")).toBeTruthy();
    expect(screen.getByText('{"command":"rg redirect"}')).toBeTruthy();
    expect(screen.getByText("240 ms")).toBeTruthy();
    expect(screen.getByText("completed")).toBeTruthy();
    expect(screen.queryByLabelText("Bash tool input")).toBeNull();

    triggers[0]?.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Bash tool input").textContent).toContain(
      '"command": "rg redirect"',
    );
    const output = screen.getByLabelText("Bash tool output");
    expect(output.textContent).toContain('"matches": 1');
    expect(output.querySelector(".hljs-number")?.textContent).toBe("1");
    expect(screen.getByLabelText("Bash tool timing").textContent).toContain("stdout_observed");
  });

  test("pairs adjacent events when the harness reports no tool call id", async () => {
    const user = userEvent.setup();
    render(
      <TurnCard
        turn={turnWith([
          { index: 0, input: { path: "README.md" }, kind: "tool_call", name: "Read" },
          { index: 1, kind: "tool_result", output: "# oneharness-ui" },
          { index: 2, input: { path: "AGENTS.md" }, kind: "tool_call", name: "Read" },
          { index: 3, kind: "tool_result", output: "# agent guide" },
        ])}
      />,
    );

    const triggers = screen.getAllByRole("button", { name: "Read tool details" });
    expect(triggers).toHaveLength(2);
    expect(screen.getByText('{"path":"README.md"}')).toBeTruthy();
    expect(screen.getByText('{"path":"AGENTS.md"}')).toBeTruthy();

    const firstTrigger = triggers[0];
    if (!firstTrigger) throw new Error("expected the first Read tool trigger");
    await user.click(firstTrigger);
    expect(screen.getByLabelText("Read tool output").textContent).toBe("# oneharness-ui");
  });

  test("keeps timing absent and still renders an unpaired result", async () => {
    const user = userEvent.setup();
    render(
      <TurnCard
        turn={turnWith([
          { index: 0, kind: "tool_result", output: "orphaned observation", toolCallId: "call-9" },
        ])}
      />,
    );

    expect(screen.queryByText(/ms$/)).toBeNull();
    expect(screen.queryByText("completed")).toBeNull();
    await user.click(screen.getByRole("button", { name: "tool_result tool details" }));
    expect(screen.getByLabelText("tool_result tool output").textContent).toBe(
      "orphaned observation",
    );
    const timing = screen.getByLabelText("tool_result tool timing");
    expect(timing.textContent).toContain("call-9");
    expect(timing.textContent).not.toContain("Started");
  });

  test("keeps a second result for an already answered call visible", async () => {
    const user = userEvent.setup();
    render(
      <TurnCard
        turn={turnWith([
          {
            index: 0,
            input: { path: "README.md" },
            kind: "tool_call",
            name: "Read",
            toolCallId: "call-1",
          },
          { index: 1, kind: "tool_result", output: "first observation" },
          { index: 2, kind: "tool_result", output: "late observation", toolCallId: "call-1" },
        ])}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Read tool details" }));
    expect(screen.getByLabelText("Read tool output").textContent).toBe("first observation");
    await user.click(screen.getByRole("button", { name: "tool_result tool details" }));
    expect(screen.getByLabelText("tool_result tool output").textContent).toBe("late observation");
  });

  test("reports an event that carries neither input nor output", async () => {
    const user = userEvent.setup();
    render(<TurnCard turn={turnWith([{ index: 0, kind: "tool_call", name: "Task" }])} />);

    await user.click(screen.getByRole("button", { name: "Task tool details" }));
    expect(screen.getByText("This tool_call event carried no input or output.")).toBeTruthy();
  });
});

describe("TurnCard focus", () => {
  const highlightRule = /\.conversation-focus-highlight\s*\{[^}]*\}/.exec(
    readFileSync(resolve(import.meta.dir, "../src/app/styles.css"), "utf8"),
  )?.[0];
  if (!highlightRule) throw new Error("expected the stylesheet's focus highlight rule");
  // The package's own highlight rule, so computed style reads what a consumer's stylesheet draws.
  const styles = `:root { --conversation-focus-highlight: #3557c4; } .scroller { overflow-y: auto; } ${highlightRule}`;
  const focusTurn: ConversationTurn = {
    ...turnWith([
      { index: 1, input: { command: "pwd" }, kind: "tool_call", name: "Bash", toolCallId: "t1" },
      { index: 2, kind: "tool_result", output: "/repo", toolCallId: "t1" },
      { index: 5, input: { path: "a.md" }, kind: "tool_call", name: "Read", toolCallId: "t2" },
      { index: 6, kind: "tool_result", output: "# a", toolCallId: "t2" },
    ]),
    agentEvents: [
      { index: 0, kind: "reasoning", text: "Plan the first step." },
      { index: 3, kind: "message", text: "Checked the repository." },
      { index: 4, kind: "reasoning", text: "Plan the second step." },
    ],
    model: "fixture-model",
    usage: { inputTokens: 1200, outputTokens: 80 },
  };
  type Focus = NonNullable<Parameters<typeof TurnCard>[0]["focus"]>;
  const focusOf = (rest: Omit<Focus, "turnId">): Focus => ({ turnId: focusTurn.id, ...rest });
  /** Each focus kind, and how the element it marks identifies itself. */
  const kinds = [
    { focus: focusOf({ part: "prompt" }), marked: ["data-turn-part", "prompt"] },
    { focus: focusOf({ part: "answer" }), marked: ["data-turn-part", "answer"] },
    { focus: focusOf({ part: "end" }), marked: ["data-turn-part", "end"] },
    { focus: focusOf({ eventIndex: 3 }), marked: ["data-event-index", "3"] },
    { focus: focusOf({ eventIndex: 4 }), marked: ["data-event-index", "4"] },
    { focus: focusOf({ toolCallId: "t2" }), marked: ["data-tool-call-id", "t2"] },
  ] as const;
  const scrolled: Element[] = [];
  let scrollSpy: { mockRestore(): void } | undefined;
  beforeEach(() => {
    scrolled.length = 0;
    // happy-dom has no layout to scroll; this records which container placement scrolls.
    scrollSpy = spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(function (
      this: HTMLElement,
    ) {
      scrolled.push(this);
    });
  });
  afterEach(() => scrollSpy?.mockRestore());

  function renderTurn(focus?: Focus) {
    const view = render(
      <div className="scroller" data-testid="scroller">
        <style>{styles}</style>
        <TurnCard {...(focus ? { focus } : {})} turn={focusTurn} />
      </div>,
    );
    return { ...view, scroller: screen.getByTestId("scroller") };
  }
  const marked = () => [...document.querySelectorAll('[aria-current="true"]')];
  const expanded = () =>
    screen
      .getAllByRole("button", { name: /^(Reasoning|.* tool details)$/ })
      .map((trigger) => [trigger.textContent, trigger.getAttribute("aria-expanded")]);
  /** What the turn shows, by role and text: header, prompt, author, model, tool rows, usage. */
  function shown() {
    const article = screen.getByRole("article", { name: `Turn ${focusTurn.id} from claude-code` });
    const usage = within(article).getByLabelText("Usage");
    return {
      avatar: within(article).getByText("OH").textContent,
      header: within(article).getByRole("button", { name: `Collapse turn ${focusTurn.id}` })
        .textContent,
      model: within(article).getByText("fixture-model").textContent,
      prompt: within(article).getByText("Inspect the login issue").textContent,
      tools: within(article)
        .getAllByRole("button", { name: / tool details$/ })
        .map((row) => row.getAttribute("aria-label")),
      tokens: within(usage)
        .getAllByRole("term")
        .map((term) => `${term.textContent} ${term.nextElementSibling?.textContent}`),
    };
  }

  test("renders unfocused with nothing marked, every item collapsed and no scroll", () => {
    const { scroller } = renderTurn();
    expect(marked()).toEqual([]);
    expect(expanded().every(([, state]) => state === "false")).toBe(true);
    expect(expanded()).toHaveLength(4);
    expect(scrolled).toHaveLength(0);
    expect(scroller.scrollTop).toBe(0);
  });

  for (const {
    focus,
    marked: [attribute, value],
  } of kinds) {
    test(`marks, opens and places only the ${attribute}=${value} element, keeping the rest`, () => {
      const unfocused = renderTurn();
      const before = shown();
      expect(before.tools).toEqual(["Bash tool details", "Read tool details"]);
      expect(before.tokens).toEqual(["Input 1200", "Output 80"]);
      const peer = document.querySelector<HTMLElement>(`[${attribute}="${value}"]`);
      if (!peer) throw new Error(`expected the unfocused ${value} element`);
      const plain = getComputedStyle(peer).outlineStyle;
      unfocused.unmount();
      const { scroller } = renderTurn(focus);
      const current = marked();
      expect(current).toHaveLength(1);
      expect(current[0]?.getAttribute(attribute)).toBe(value);
      expect(shown()).toEqual(before);
      const element = current[0];
      if (!(element instanceof HTMLElement)) throw new Error("expected the marked element");
      expect(getComputedStyle(element).outlineStyle).toBe("solid");
      // Drawn inside the element's box, so a pinned header flush with its top cannot hide it.
      expect(getComputedStyle(element).outlineOffset).toBe("-2px");
      expect(plain).not.toBe("solid");
      const open = element.querySelector('[data-slot="accordion-trigger"]');
      if (attribute !== "data-turn-part" && value !== "3")
        expect(open?.getAttribute("aria-expanded")).toBe("true");
      // Only the focused item opens; every other reasoning and tool row stays collapsed.
      expect(expanded().filter(([, state]) => state === "true")).toHaveLength(open ? 1 : 0);
      expect(scrolled).toEqual([scroller]);
    });
  }

  test("resolves toolCallId over eventIndex over part, and falls back to the turn", () => {
    const { rerender } = renderTurn(focusOf({ eventIndex: 3, part: "prompt", toolCallId: "t1" }));
    const only = () => {
      const current = marked();
      expect(current).toHaveLength(1);
      return current[0];
    };
    expect(only()?.getAttribute("data-tool-call-id")).toBe("t1");
    const again = (focus: Focus) =>
      rerender(
        <div className="scroller" data-testid="scroller">
          <style>{styles}</style>
          <TurnCard focus={focus} turn={focusTurn} />
        </div>,
      );
    again(focusOf({ eventIndex: 0, part: "prompt" }));
    expect(only()?.getAttribute("data-event-index")).toBe("0");
    expect(
      screen.getAllByRole("button", { name: "Reasoning" })[0]?.getAttribute("aria-expanded"),
    ).toBe("true");
    again(focusOf({ part: "answer" }));
    expect(only()?.getAttribute("data-turn-part")).toBe("answer");
    for (const missing of [
      focusOf({ toolCallId: "absent", eventIndex: 3 }),
      focusOf({ eventIndex: 99, part: "prompt" }),
      focusOf({}),
    ]) {
      again(missing);
      expect(only()?.tagName).toBe("ARTICLE");
    }
  });

  test("falls back to the turn for an end part when the turn has no usage or failure", () => {
    render(<TurnCard focus={{ part: "end", turnId: "session-1-0" }} turn={turnWith([])} />);
    expect(document.querySelector('[data-turn-part="end"]')).toBeNull();
    expect(screen.getByRole("article").getAttribute("aria-current")).toBe("true");
  });

  test("marks a running turn's answer note and a failed turn's end", () => {
    const { rerender } = render(
      <TurnCard
        focus={{ part: "answer", turnId: "session-1-0" }}
        turn={{ ...turnWith([]), assistant: null, status: "running" }}
      />,
    );
    expect(
      screen.getByRole("status").closest('[aria-current="true"]')?.getAttribute("data-turn-part"),
    ).toBe("answer");
    rerender(
      <TurnCard
        focus={{ part: "end", turnId: "session-1-0" }}
        turn={{ ...turnWith([]), failureKind: "timeout", status: "failed" }}
      />,
    );
    expect(
      screen
        .getByRole("note", { name: "Failure: timeout" })
        .closest('[aria-current="true"]')
        ?.getAttribute("data-turn-part"),
    ).toBe("end");
  });

  test("opens a collapsed turn on the render that focuses it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TurnCard turn={focusTurn} />);
    await user.click(screen.getByRole("button", { name: `Collapse turn ${focusTurn.id}` }));
    rerender(<TurnCard focus={focusOf({ eventIndex: 4 })} turn={focusTurn} />);
    expect(
      screen
        .getByRole("button", { name: `Collapse turn ${focusTurn.id}` })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByText("Plan the second step.")).toBeTruthy();
  });
});
