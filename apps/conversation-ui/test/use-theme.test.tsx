import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import { themeStorageKey } from "../src/components/theme";
import { ThemeToggle } from "../src/components/theme-toggle";
import { TooltipProvider } from "../src/components/ui/tooltip";

class ColorSchemeQuery extends EventTarget {
  matches = false;
  readonly media = "(prefers-color-scheme: dark)";
  onchange: ((event: MediaQueryListEvent) => void) | null = null;

  setMatches(matches: boolean): void {
    this.matches = matches;
    this.dispatchEvent(new Event("change"));
  }
}

const colorScheme = new ColorSchemeQuery();
const originalMatchMedia = window.matchMedia;

afterEach(() => {
  cleanup();
  colorScheme.matches = false;
  document.documentElement.classList.remove("dark");
  delete document.documentElement.dataset.theme;
  localStorage.clear();
  window.matchMedia = originalMatchMedia;
});

describe("ThemeToggle", () => {
  test("tracks operating-system color-scheme changes while using the system theme", async () => {
    window.matchMedia = (() => colorScheme) as typeof window.matchMedia;
    localStorage.setItem(themeStorageKey, "system");
    render(
      <TooltipProvider>
        <ThemeToggle />
      </TooltipProvider>,
    );

    expect(
      await screen.findByRole("button", { name: "Theme: system. Switch to light" }),
    ).toBeTruthy();
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => colorScheme.setMatches(true));
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    act(() => colorScheme.setMatches(false));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
