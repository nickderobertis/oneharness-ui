import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Timeline, type TimelineItem } from "../src/components/timeline";

afterEach(cleanup);

const items: TimelineItem<{ failure?: string }>[] = [
  {
    duration: 4_000,
    id: "turn",
    kind: "turn",
    label: "Agent turn",
    payload: {},
    start: 1_000,
    status: "completed",
  },
  {
    id: "event",
    kind: "tool",
    label: "Unmeasured tool",
    parent: "turn",
    payload: {},
    start: 2_000,
  },
  {
    duration: 500,
    id: "failed",
    kind: "tool",
    label: "Broken tool",
    payload: { failure: "permission denied" },
    start: 3_000,
    status: "failed",
  },
];

describe("Timeline", () => {
  test("renders spans, points, a kind legend, keyboard detail, and selection", async () => {
    const selected: string[] = [];
    const user = userEvent.setup();
    render(
      <Timeline
        getFailureExcerpt={(item) => item.payload.failure}
        items={items}
        onSelect={(item) => selected.push(item.id)}
      />,
    );

    expect(screen.getByRole("list", { name: "Timeline legend" }).textContent).toContain("turn");
    expect(screen.getByRole("list", { name: "Timeline legend" }).textContent).toContain("tool");
    expect(screen.getByRole("button", { name: "Agent turn, span" }).dataset.timelineShape).toBe(
      "span",
    );
    expect(
      screen.getByRole("button", { name: "Unmeasured tool, point event" }).dataset.timelineShape,
    ).toBe("point");

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Agent turn, span" }));
    expect(screen.getByRole("tooltip").textContent).toContain("Duration: 4.0 s");
    await user.click(screen.getByRole("button", { name: "Broken tool, span" }));
    expect(selected).toEqual(["failed"]);
    expect(screen.getByRole("tooltip").textContent).toContain("Failure: permission denied");
  });

  test("zooms with the wheel and brush, then resets", () => {
    render(<Timeline items={items} />);
    const plot = screen.getByLabelText("Timeline plot. Scroll to zoom or drag to select a range.");
    const reset = screen.getByRole("button", { name: "Reset timeline zoom" });
    expect(reset.hasAttribute("disabled")).toBe(true);
    fireEvent.wheel(plot, { clientX: 500, deltaY: -100 });
    expect(reset.hasAttribute("disabled")).toBe(false);
    fireEvent.click(reset);
    expect(reset.hasAttribute("disabled")).toBe(true);
    fireEvent.pointerDown(plot, { clientX: 100 });
    fireEvent.pointerUp(plot, { clientX: 700 });
    expect(reset.hasAttribute("disabled")).toBe(false);
  });

  test("reports an honest empty state", () => {
    render(<Timeline items={[]} />);
    expect(screen.getByText("No timeline events recorded.")).toBeTruthy();
  });
});
