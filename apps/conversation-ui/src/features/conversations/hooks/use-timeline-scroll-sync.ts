"use client";

import { type RefCallback, useCallback, useEffect, useRef, useState } from "react";

export interface TimelineScrollEntry {
  id: string;
  time: number;
}

export interface TimelineScrollSync {
  containerRef: RefCallback<HTMLElement>;
  cursor: number | undefined;
  register: (id: string, element: HTMLElement | null) => void;
  scrollTo: (id: string) => void;
}

export function useTimelineScrollSync(entries: readonly TimelineScrollEntry[]): TimelineScrollSync {
  const container = useRef<HTMLElement | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const [cursor, setCursor] = useState<number>();
  const times = useRef(new Map<string, number>());
  times.current = new Map(entries.map((entry) => [entry.id, entry.time]));

  const updateCursor = useCallback(() => {
    const root = container.current;
    if (!root) return;
    const rootTop = root.getBoundingClientRect().top;
    const readingLine = rootTop + Math.min(root.clientHeight * 0.25, 160);
    const registered = entries
      .map((entry) => ({ element: elements.current.get(entry.id), ...entry }))
      .filter((entry): entry is typeof entry & { element: HTMLElement } => Boolean(entry.element));
    if (registered.length === 0) return;
    const first = registered[0];
    if (!first) return;
    let active = first;
    for (const entry of registered) {
      if (entry.element.getBoundingClientRect().top <= readingLine) active = entry;
      else break;
    }
    setCursor(active.time);
  }, [entries]);

  const containerRef = useCallback<RefCallback<HTMLElement>>(
    (element) => {
      container.current?.removeEventListener("scroll", updateCursor);
      container.current = element;
      element?.addEventListener("scroll", updateCursor, { passive: true });
      updateCursor();
    },
    [updateCursor],
  );

  useEffect(() => {
    updateCursor();
    const root = container.current;
    return () => root?.removeEventListener("scroll", updateCursor);
  }, [updateCursor]);

  const register = useCallback((id: string, element: HTMLElement | null) => {
    if (element) elements.current.set(id, element);
    else elements.current.delete(id);
  }, []);

  const scrollTo = useCallback((id: string) => {
    elements.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    const time = times.current.get(id);
    if (time !== undefined) setCursor(time);
  }, []);

  return { containerRef, cursor, register, scrollTo };
}
