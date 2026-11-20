import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Timeline, type TimelineItem, type TimelineMarker } from "../src/components/timeline";

afterEach(cleanup);

const items: TimelineItem<{ failure?: string }>[] = [
  {
    duration: 4_000,
    id: "turn",
    kind: "turn",
    label: "Agent turn",
    laneId: "turn",
    payload: {},
    start: 1_000,
    status: "completed",
  },
  {
    id: "event",
    kind: "tool",
    label: "Unmeasured tool",
    laneId: "tool",
    payload: {},
    start: 2_000,
  },
  {
    duration: 500,
    id: "failed",
    kind: "tool",
    label: "Broken tool",
    laneId: "tool",
    payload: { failure: "permission denied" },
    start: 3_000,
    status: "failed",
  },
];
const lanes = [
  { id: "turn", label: "Turns" },
  { id: "tool", label: "Tools" },
];
const markers: TimelineMarker<{ failure?: string }>[] = [
  { at: 2_500, id: "marker", label: "Checkpoint", payload: {} },
];

describe("Timeline", () => {
  test("is one collapsed row by default and expands into ordered lane rows", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Timeline items={items} lanes={lanes} />);
    expect(screen.getAllByTestId("timeline-lane")).toHaveLength(1);
    expect(screen.getByTestId("timeline-lane").getAttribute("data-lane-id")).toBe("overlay");

    rerender(<Timeline expanded items={items} lanes={lanes} />);
    expect(screen.getAllByTestId("timeline-lane").map((row) => row.dataset.laneId)).toEqual([
      "turn",
      "tool",
    ]);

    const changes: boolean[] = [];
    rerender(
      <Timeline items={items} lanes={lanes} onExpandedChange={(value) => changes.push(value)} />,
    );
    await user.click(screen.getByRole("button", { name: "Expand timeline" }));
    expect(changes).toEqual([true]);
  });

  test("renders full-height markers in both modes and selects items and markers", async () => {
    const selected: string[] = [];
    const user = userEvent.setup();
    const { rerender } = render(
      <Timeline
        items={items}
        lanes={lanes}
        markers={markers}
        onSelect={(entry) => selected.push(entry.id)}
        selectedId="turn"
      />,
    );
    expect(screen.getByTestId("timeline-marker-line").className).toContain("inset-y-0");
    expect(screen.getByRole("button", { name: "Agent turn, span" }).dataset.selected).toBe("true");
    await user.click(screen.getByRole("button", { name: "Agent turn, span" }));
    await user.click(screen.getByRole("button", { name: "Checkpoint, marker" }));
    expect(selected).toEqual(["turn", "marker"]);

    rerender(
      <Timeline expanded items={items} lanes={lanes} markers={markers} selectedId="marker" />,
    );
    expect(screen.getByTestId("timeline-marker-line").className).toContain("inset-y-0");
    expect(screen.getByRole("button", { name: "Checkpoint, marker" }).dataset.selected).toBe(
      "true",
    );
  });

  test("shows wall-clock and elapsed axis labels and a controlled cursor", () => {
    render(
      <Timeline
        axis={{ origin: 0 }}
        cursor={3_000}
        items={items}
        lanes={lanes}
        range={[1_000, 5_000]}
      />,
    );
    const ticks = within(screen.getByRole("list", { name: "Timeline axis" }))
      .getAllByRole("listitem")
      .map((tick) => [...tick.children].map((line) => line.textContent));
    // Each tick reads its wall-clock time over its offset, which carries only the decimals it needs.
    expect(ticks.map(([, offset]) => offset)).toContain("+1 s");
    expect(ticks.map(([, offset]) => offset)).toContain("+1.5 s");
    for (const [clock, offset] of ticks) {
      expect(clock).toMatch(/^\d\d:\d\d(:\d\d(\.5)?)?$/);
      expect(offset).not.toMatch(/\.\d*0 s$/);
    }
    expect(screen.getByTestId("timeline-cursor").style.left).toBe("50%");
  });

  test("controlled range synchronizes stacked instances and receives zoom, brush, and reset", () => {
    const changes: Array<[number, number]> = [];
    function StackedTimelines() {
      const [range, setRange] = useState<[number, number]>([1_500, 4_500]);
      return (
        <>
          <Timeline
            items={items}
            lanes={lanes}
            onRangeChange={(nextRange) => {
              changes.push(nextRange);
              setRange(nextRange);
            }}
            range={range}
          />
          <Timeline items={items} lanes={lanes} range={range} />
        </>
      );
    }
    const axisText = () => screen.getAllByTestId("timeline-axis").map((axis) => axis.textContent);
    render(<StackedTimelines />);
    const initialAxis = axisText();
    expect(initialAxis[1]).toBe(initialAxis[0]);
    const [plot] = screen.getAllByLabelText(
      "Timeline plot. Scroll to zoom or drag to select a range.",
    );
    if (!plot) throw new Error("expected the first timeline plot");
    fireEvent.wheel(plot, { clientX: 500, deltaY: -100 });
    expect(changes).toHaveLength(1);
    const zoomedAxis = axisText();
    expect(zoomedAxis[0]).not.toBe(initialAxis[0]);
    expect(zoomedAxis[1]).toBe(zoomedAxis[0]);
    fireEvent.pointerDown(plot, { clientX: 100 });
    fireEvent.pointerUp(plot, { clientX: 700 });
    expect(changes).toHaveLength(2);
    const brushedAxis = axisText();
    expect(brushedAxis[0]).not.toBe(zoomedAxis[0]);
    expect(brushedAxis[1]).toBe(brushedAxis[0]);
    const [reset] = screen.getAllByRole("button", { name: "Reset timeline zoom" });
    if (!reset) throw new Error("expected the first timeline reset button");
    fireEvent.click(reset);
    expect(changes.at(-1)).toEqual([1_000, 5_000]);
    const resetAxis = axisText();
    expect(resetAxis[0]).not.toBe(brushedAxis[0]);
    expect(resetAxis[1]).toBe(resetAxis[0]);
  });

  test("assigns lane color solely from lane id and keeps zero-duration items legible", () => {
    const { rerender } = render(<Timeline expanded items={items} lanes={lanes} />);
    const turnColor = screen.getByRole("button", { name: "Agent turn, span" }).dataset.laneColor;
    const toolColor = screen.getByRole("button", {
      name: "Unmeasured tool, point event",
    }).dataset.laneColor;
    expect(
      screen.getByRole("button", { name: "Unmeasured tool, point event" }).className,
    ).toContain("w-5");
    rerender(<Timeline expanded items={[...items].reverse()} lanes={[...lanes].reverse()} />);
    expect(screen.getByRole("button", { name: "Agent turn, span" }).dataset.laneColor).toBe(
      turnColor,
    );
    expect(
      screen.getByRole("button", { name: "Unmeasured tool, point event" }).dataset.laneColor,
    ).toBe(toolColor);
  });

  test("keeps the legacy items-only shape working with detail and failure excerpts", async () => {
    const legacy = items.map(({ laneId: _laneId, ...item }) => item);
    const user = userEvent.setup();
    render(<Timeline getFailureExcerpt={(item) => item.payload.failure} items={legacy} />);
    await user.click(screen.getByRole("button", { name: "Broken tool, span" }));
    expect(screen.getByRole("tooltip").textContent).toContain("Failure: permission denied");
  });

  test("puts every legacy kind in one implicit expanded lane", () => {
    const legacy = items.map(({ laneId: _laneId, ...item }) => item);
    render(<Timeline expanded items={legacy} />);

    expect(screen.getAllByTestId("timeline-lane")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Agent turn, span" }).dataset.laneColor).toBe(
      screen.getByRole("button", { name: "Unmeasured tool, point event" }).dataset.laneColor,
    );
  });

  test("reports an honest empty state", () => {
    render(<Timeline items={[]} />);
    expect(screen.getByText("No timeline events recorded.")).toBeTruthy();
  });
});

test("round ticks respect measured spacing over three hours and crosshair reads time", () => {
  const start = Date.parse("2026-08-04T12:00:00Z");
  const end = start + 3 * 3_600_000;
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = () => ({
    width: 1200,
    left: 0,
    right: 1200,
    top: 0,
    bottom: 100,
    height: 100,
    x: 0,
    y: 0,
    toJSON() {},
  });
  try {
    const { rerender } = render(
      <Timeline
        axis={{ origin: start }}
        items={[{ id: "run", label: "Run", payload: {}, start, end }]}
        ticks={{ minSpacingPx: 100 }}
      />,
    );
    const values = [
      ...screen.getByTestId("timeline-axis").querySelectorAll("[data-tick-time]"),
    ].map((element) => Number(element.getAttribute("data-tick-time")));
    expect(values.length).toBeGreaterThan(2);
    for (const [index, value] of values.entries()) {
      expect(value % 60_000).toBe(0);
      const previous = values[index - 1];
      if (previous !== undefined)
        expect(((value - previous) / (end - start)) * 1200).toBeGreaterThanOrEqual(100);
    }
    const plot = screen.getByLabelText("Timeline plot. Scroll to zoom or drag to select a range.");
    fireEvent.pointerMove(plot, { clientX: 600 });
    const [clock, offset] = [
      ...(screen.getByLabelText("Timeline crosshair").firstElementChild?.children ?? []),
    ].map((line) => line.textContent);
    expect(clock).toMatch(/^\d\d:\d\d$/);
    expect(offset).toBe("+1 h 30 min");
    expect(screen.getByLabelText("Timeline crosshair").style.left).toBe("50%");
    fireEvent.pointerLeave(plot);
    expect(screen.queryByLabelText("Timeline crosshair")).toBeNull();
    rerender(
      <Timeline crosshair={false} items={[{ id: "run", label: "Run", payload: {}, start, end }]} />,
    );
    fireEvent.pointerMove(plot, { clientX: 600 });
    expect(screen.queryByLabelText("Timeline crosshair")).toBeNull();
  } finally {
    HTMLElement.prototype.getBoundingClientRect = original;
  }
});

test("onHover resolves the entry under or nearest the pointer and clears when it leaves", () => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = () => ({
    width: 1000,
    left: 0,
    right: 1000,
    top: 0,
    bottom: 100,
    height: 100,
    x: 0,
    y: 0,
    toJSON() {},
  });
  const hovers: (string | null)[] = [];
  try {
    render(
      <Timeline
        items={[
          { id: "early", label: "Early", payload: {}, start: 0, end: 100 },
          { id: "late", label: "Late", payload: {}, start: 400, end: 500 },
        ]}
        markers={[
          { at: 450, id: "inside", label: "Inside", payload: {} },
          { at: 1000, id: "after", label: "After", payload: {} },
        ]}
        onHover={(hover) => {
          hovers.push(
            hover ? `${hover.entry.id}:${hover.element.getAttribute("aria-label")}` : null,
          );
        }}
      />,
    );
    const plot = screen.getByLabelText("Timeline plot. Scroll to zoom or drag to select a range.");
    const hovered = () =>
      [...plot.querySelectorAll('[data-timeline-hovered="true"]')].map((element) =>
        element.getAttribute("aria-label"),
      );
    fireEvent.pointerMove(plot, { clientX: 50, clientY: 50 });
    expect(hovered()).toEqual(["Early, span"]);
    fireEvent.pointerMove(plot, { clientX: 60, clientY: 50 });
    fireEvent.pointerMove(plot, { clientX: 300, clientY: 50 });
    // A tie between a bar and a marker goes to the bar below the marker row.
    fireEvent.pointerMove(plot, { clientX: 450, clientY: 50 });
    expect(hovered()).toEqual(["Late, span"]);
    // Over the marker row the same tie goes to the marker.
    fireEvent.pointerMove(plot, { clientX: 450, clientY: -10 });
    expect(hovered()).toEqual(["Inside, marker"]);
    fireEvent.pointerMove(plot, { clientX: 1000, clientY: 50 });
    expect(hovered()).toEqual(["After, marker"]);
    // The entry under the pointer wins over the nearer one.
    fireEvent.pointerMove(screen.getByRole("button", { name: "Late, span" }), {
      clientX: 900,
      clientY: 50,
    });
    expect(hovered()).toEqual(["Late, span"]);
    fireEvent.pointerLeave(plot);
    expect(hovered()).toEqual([]);
    expect(hovers).toEqual([
      "early:Early, span",
      "late:Late, span",
      "inside:Inside, marker",
      "after:After, marker",
      "late:Late, span",
      null,
    ]);
  } finally {
    HTMLElement.prototype.getBoundingClientRect = original;
  }
});
