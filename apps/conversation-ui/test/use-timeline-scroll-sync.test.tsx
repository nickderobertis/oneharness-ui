import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useTimelineScrollSync } from "../src/features/conversations/hooks/use-timeline-scroll-sync";

afterEach(cleanup);

function ScrollFixture() {
  const sync = useTimelineScrollSync([
    { id: "first", time: 10 },
    { id: "second", time: 20 },
  ]);
  return (
    <div ref={sync.containerRef} style={{ height: 400 }}>
      <button ref={(element) => sync.register("first", element)}>First</button>
      <button ref={(element) => sync.register("second", element)}>Second</button>
      <output aria-label="Cursor">{sync.cursor}</output>
      <button onClick={() => sync.scrollTo("second")}>Focus second</button>
    </div>
  );
}

describe("useTimelineScrollSync", () => {
  test("maps the reading position to time and scrolls a registered entry into view", () => {
    const original = HTMLElement.prototype.scrollIntoView;
    const scrolled: Element[] = [];
    HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
      scrolled.push(this);
    };
    try {
      render(<ScrollFixture />);
      const first = screen.getByRole("button", { name: "First" });
      const second = screen.getByRole("button", { name: "Second" });
      const root = first.parentElement;
      if (!root) throw new Error("expected the scroll fixture container");
      Object.defineProperty(root, "clientHeight", { configurable: true, value: 400 });
      root.getBoundingClientRect = () => DOMRect.fromRect({ y: 0 });
      first.getBoundingClientRect = () => DOMRect.fromRect({ y: -200 });
      second.getBoundingClientRect = () => DOMRect.fromRect({ y: 20 });
      fireEvent.scroll(root);
      expect(screen.getByLabelText("Cursor").textContent).toBe("20");

      fireEvent.click(screen.getByRole("button", { name: "Focus second" }));
      expect(scrolled).toEqual([second]);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
