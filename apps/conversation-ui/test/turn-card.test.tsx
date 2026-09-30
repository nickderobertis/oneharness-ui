import { afterEach, describe, expect, test } from "bun:test";
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
  test("keeps default rendered markup byte-for-byte compatible", async () => {
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

  test("shows the agent's messages and reasoning in recorded order, apart from its tool calls", async () => {
    const user = userEvent.setup();
    render(
      <TurnCard
        turn={{
          ...turnWith([{ index: 1, input: { command: "pwd" }, kind: "tool_call", name: "Bash" }]),
          agentEvents: [
            { index: 2, kind: "message", text: "The repository is at **/repo**." },
            { index: 0, kind: "reasoning", text: "Check the working directory first." },
          ],
        }}
      />,
    );
    const activity = screen.getByRole("region", { name: "Agent activity" });
    const reasoning = within(activity).getByRole("button", { name: "Reasoning" });
    const message = within(activity).getByRole("group", { name: "Agent message" });
    expect(
      reasoning.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(message.querySelector("strong")?.textContent).toBe("/repo");
    await user.click(reasoning);
    expect(within(activity).getByText("Check the working directory first.")).toBeTruthy();
    const tools = screen.getByRole("region", { name: "Tool calls" });
    expect(within(tools).getAllByRole("button")).toHaveLength(1);
    expect(within(tools).getByLabelText("Bash tool details")).toBeTruthy();
    expect(within(activity).queryByLabelText("Bash tool details")).toBeNull();
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
