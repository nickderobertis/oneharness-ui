"use client";

import { type RefObject, useCallback, useEffect, useRef } from "react";

type InfiniteScrollOptions = {
  automatic: boolean;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => Promise<unknown>;
};

type InfiniteScroll = {
  loadMore: () => void;
  rootRef: RefObject<HTMLElement | null>;
  sentinelRef: RefObject<HTMLDivElement | null>;
};

export function useInfiniteScroll({
  automatic,
  hasMore,
  loading,
  onLoadMore,
}: InfiniteScrollOptions): InfiniteScroll {
  const rootRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestInFlight = useRef(false);
  const latest = useRef({ hasMore, loading, onLoadMore });
  latest.current = { hasMore, loading, onLoadMore };

  const loadMore = useCallback(() => {
    const state = latest.current;
    if (!state.hasMore || state.loading || requestInFlight.current) return;
    requestInFlight.current = true;
    void state.onLoadMore().finally(() => {
      requestInFlight.current = false;
    });
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const sentinel = sentinelRef.current;
    if (!automatic || !hasMore || loading || !root || !sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMore();
      },
      { root, rootMargin: "0px 0px 180px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [automatic, hasMore, loadMore, loading]);

  return { loadMore, rootRef, sentinelRef };
}
