"use client";

import { type RefObject, useEffect, useLayoutEffect } from "react";

// React 18 warns of a layout effect while rendering on a server, where there is nothing to place.
const useBeforePaintEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const scrollableOverflow = new Set(["auto", "overlay", "scroll"]);
/** Input that means the reader is scrolling for themselves, so placement lets go. */
const readerScrollEvents = ["keydown", "pointerdown", "touchstart", "wheel"] as const;

function scrollContainerOf(element: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (node === document.body || node === document.documentElement) break;
    if (scrollableOverflow.has(getComputedStyle(node).overflowY)) return node;
  }
  const page = document.scrollingElement;
  return page instanceof HTMLElement ? page : document.documentElement;
}

/**
 * Scrolls the nearest scrollable ancestor so the article's `aria-current` element (or the article
 * itself) has its top at the container's visible top plus its `scroll-margin-top`, which the
 * package's stylesheet sets from `--conversation-focus-offset`. It runs as a layout effect so the
 * first painted frame already shows the item placed, and it re-places the item whenever layout
 * around it settles, until the focus changes or the reader scrolls.
 */
export function useFocusPlacement(
  root: RefObject<HTMLElement | null>,
  focusKey: string | undefined,
): void {
  useBeforePaintEffect(() => {
    const article = root.current;
    if (!focusKey || !article) return;
    const target =
      article.getAttribute("aria-current") === "true"
        ? article
        : article.querySelector<HTMLElement>('[aria-current="true"]');
    if (!target) return;
    const container = scrollContainerOf(article);
    const viewport = container === document.scrollingElement;
    const drift = () => {
      const offset = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
      const visibleTop = viewport ? 0 : container.getBoundingClientRect().top + container.clientTop;
      return target.getBoundingClientRect().top - (visibleTop + offset);
    };
    const scrollBy = (distance: number) =>
      container.scrollTo({ behavior: "instant", top: container.scrollTop + distance });
    scrollBy(drift());
    let held = true;
    const release = () => {
      held = false;
    };
    const hold = () => {
      if (!held) return;
      const distance = drift();
      if (Math.abs(distance) >= 0.5) scrollBy(distance);
    };
    // Resize callbacks run after layout and before paint, so a correction never shows as a jump.
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(hold);
    for (const element of new Set([target, article, ...container.children]))
      observer?.observe(element);
    for (const type of readerScrollEvents)
      container.addEventListener(type, release, { passive: true });
    return () => {
      observer?.disconnect();
      for (const type of readerScrollEvents) container.removeEventListener(type, release);
    };
  }, [focusKey, root]);
}

/**
 * Publishes how far a sticky element pinned at the top of its scroll container (its parent)
 * reaches down, as `--conversation-pinned-offset` on that container, so focus placement lands
 * below it. It measures on every render of its caller, before the turns after it place their
 * focus, and again whenever the element resizes.
 */
export function usePinnedOffset(pinned: RefObject<HTMLElement | null>): void {
  useBeforePaintEffect(() => {
    const element = pinned.current;
    if (element) publishPinnedOffset(element);
  });
  useBeforePaintEffect(() => {
    const element = pinned.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => publishPinnedOffset(element));
    observer.observe(element);
    return () => observer.disconnect();
  }, [pinned]);
}

function publishPinnedOffset(element: HTMLElement) {
  const container = element.parentElement;
  if (!container) return;
  // A sticky element sticks its `top` inset below the container's padding edge, not its border.
  const padding = Number.parseFloat(getComputedStyle(container).paddingTop) || 0;
  const inset = Number.parseFloat(getComputedStyle(element).top) || 0;
  container.style.setProperty(
    "--conversation-pinned-offset",
    `${padding + inset + element.offsetHeight}px`,
  );
}
