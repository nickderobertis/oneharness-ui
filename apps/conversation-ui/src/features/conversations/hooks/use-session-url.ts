"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

const selectorSchema = z
  .string()
  .regex(/^[\p{L}\p{N}._-]+$/u)
  .max(240);

export function parseSessionSelector(search: string): string | null {
  const value = new URLSearchParams(search).get("session");
  const parsed = selectorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function serializeSessionSelector(sessionId: string | null): string {
  const search = new URLSearchParams();
  if (sessionId) search.set("session", selectorSchema.parse(sessionId));
  const value = search.toString();
  return value ? `?${value}` : "";
}

export function useSessionUrl(): readonly [string | null, (sessionId: string | null) => void] {
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setSessionId(parseSessionSelector(window.location.search));
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const select = useCallback((next: string | null) => {
    window.history.pushState(
      null,
      "",
      `${window.location.pathname}${serializeSessionSelector(next)}`,
    );
    setSessionId(next);
  }, []);
  return [sessionId, select] as const;
}
