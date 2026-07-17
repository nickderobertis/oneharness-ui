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
  const observerRef = useRef<IntersectionObserver>(null);
  const requestInFlight = useRef(false);
  const rearmedLoadedCount = useRef<number | null>(null);
  const latest = useRef({ automatic, hasMore, loading, onLoadMore });
  latest.current = { automatic, hasMore, loading, onLoadMore };

  const rearmObserver = useCallback(() => {
    const observer = observerRef.current;
    const sentinel = sentinelRef.current;
    if (!observer || !sentinel) return;
    observer.unobserve(sentinel);
    observer.observe(sentinel);
  }, []);

  const loadMore = useCallback(() => {
    const state = latest.current;
    if (!state.hasMore || state.loading || requestInFlight.current) return;
    requestInFlight.current = true;
    void state.onLoadMore().finally(() => {
      requestInFlight.current = false;
    });
  }, []);

  useEffect(() => {
    if (loading || rearmedLoadedCount.current === loadedCount) return;
    rearmedLoadedCount.current = loadedCount;
    requestInFlight.current = false;
    rearmObserver();
  }, [loadedCount, loading, rearmObserver]);

  useEffect(() => {
    const root = rootRef.current;
    const sentinel = sentinelRef.current;
    if (!automatic || !hasMore || !root || !sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && latest.current.automatic) loadMore();
      },
      { root, rootMargin: "0px 0px 180px" },
    );
    observerRef.current = observer;
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
      if (observerRef.current === observer) observerRef.current = null;
    };
  }, [automatic, hasMore, loadMore]);

  return { loadMore, rootRef, sentinelRef };
}
