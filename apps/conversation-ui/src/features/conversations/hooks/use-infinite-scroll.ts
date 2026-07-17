"use client";

import { type RefObject, useCallback, useEffect, useRef } from "react";

type InfiniteScrollOptions = {
  automatic: boolean;
  hasMore: boolean;
  loadedCount: number;
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
  loadedCount,
  loading,
  onLoadMore,
}: InfiniteScrollOptions): InfiniteScroll {
  const rootRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestInFlight = useRef(false);
  const latest = useRef({ automatic, hasMore, loadedCount, loading, onLoadMore });
  latest.current = { automatic, hasMore, loadedCount, loading, onLoadMore };

  const loadMore = useCallback(() => {
    const state = latest.current;
    if (!state.hasMore || state.loading || requestInFlight.current) return;
    requestInFlight.current = true;
    void state.onLoadMore().finally(() => {
      requestInFlight.current = false;
    });
  }, []);

  useEffect(() => {
    if (!loading) requestInFlight.current = false;
    const root = rootRef.current;
    const sentinel = sentinelRef.current;
    if (!automatic || !hasMore || loading || !root || !sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (
          entry?.isIntersecting &&
          latest.current.automatic &&
          latest.current.loadedCount === loadedCount
        )
          loadMore();
      },
      { root, rootMargin: "0px 0px 180px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [automatic, hasMore, loadMore, loadedCount, loading]);

  return { loadMore, rootRef, sentinelRef };
}
