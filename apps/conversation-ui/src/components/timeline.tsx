"use client";

import { Circle, RotateCcw } from "lucide-react";
import { type PointerEvent, useMemo, useRef, useState, type WheelEvent } from "react";
import { cn } from "./utils";

export interface TimelineItem<Payload = unknown> {
  duration?: number | null;
  end?: number | null;
  id: string;
  kind: string;
  label: string;
  parent?: string | null;
  payload: Payload;
  start: number;
  status?: string | null;
}

export interface TimelineProps<Payload> {
  getFailureExcerpt?: (item: TimelineItem<Payload>) => string | null | undefined;
  items: readonly TimelineItem<Payload>[];
  label?: string;
  onSelect?: (item: TimelineItem<Payload>) => void;
}

type Range = { end: number; start: number };
const kindColors = [
  "bg-spectrum-blue",
  "bg-spectrum-green",
  "bg-spectrum-orange",
  "bg-spectrum-violet",
  "bg-spectrum-red",
  "bg-spectrum-indigo",
  "bg-spectrum-yellow",
] as const;

function itemEnd(item: TimelineItem): number {
  if (typeof item.end === "number" && Number.isFinite(item.end)) return item.end;
  if (typeof item.duration === "number" && Number.isFinite(item.duration))
    return item.start + item.duration;
  return item.start;
}

function formatDuration(value: number): string {
  if (value < 1_000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1)} s`;
  return `${(value / 60_000).toFixed(1)} min`;
}

function formatTime(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toISOString();
}

function detailText<Payload>(item: TimelineItem<Payload>, failure?: string | null): string {
  const end = itemEnd(item);
  const parts = [
    item.label,
    `Kind: ${item.kind}`,
    `Status: ${item.status ?? "unknown"}`,
    `Start: ${formatTime(item.start)}`,
  ];
  if (end > item.start)
    parts.push(`End: ${formatTime(end)}`, `Duration: ${formatDuration(end - item.start)}`);
  else parts.push("Duration: not recorded");
  if (item.status === "failed" && failure?.trim())
    parts.push(`Failure: ${failure.trim().slice(0, 160)}`);
  return parts.join(" · ");
}

export function Timeline<Payload>({
  getFailureExcerpt,
  items,
  label = "Timeline",
  onSelect,
}: TimelineProps<Payload>) {
  const validItems = useMemo(() => items.filter((item) => Number.isFinite(item.start)), [items]);
  const fullRange = useMemo<Range>(() => {
    if (validItems.length === 0) return { end: 1, start: 0 };
    const start = Math.min(...validItems.map((item) => item.start));
    const rawEnd = Math.max(...validItems.map(itemEnd));
    return { end: rawEnd > start ? rawEnd : start + 1, start };
  }, [validItems]);
  const [view, setView] = useState<Range | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [brushStart, setBrushStart] = useState<number | null>(null);
  const axis = useRef<HTMLDivElement>(null);
  const range = view ?? fullRange;
  const rangeDuration = Math.max(1, range.end - range.start);
  const kinds = [...new Set(validItems.map((item) => item.kind))];
  const colorFor = (kind: string) =>
    kindColors[Math.max(0, kinds.indexOf(kind)) % kindColors.length];
  const position = (value: number) => ((value - range.start) / rangeDuration) * 100;
  const coordinate = (clientX: number) => {
    const bounds = axis.current?.getBoundingClientRect();
    const width = bounds?.width || 1_000;
    return (
      range.start +
      Math.min(1, Math.max(0, (clientX - (bounds?.left ?? 0)) / width)) * rangeDuration
    );
  };
  const finishBrush = (event: PointerEvent<HTMLDivElement>) => {
    if (brushStart === null) return;
    const end = coordinate(event.clientX);
    if (Math.abs(end - brushStart) >= rangeDuration * 0.02)
      setView({ end: Math.max(end, brushStart), start: Math.min(end, brushStart) });
    setBrushStart(null);
  };
  const zoom = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const anchor = coordinate(event.clientX);
    const factor = event.deltaY < 0 ? 0.75 : 1.25;
    const fullDuration = fullRange.end - fullRange.start;
    const nextDuration = Math.min(
      fullDuration,
      Math.max(fullDuration / 100, rangeDuration * factor),
    );
    const ratio = (anchor - range.start) / rangeDuration;
    let start = anchor - nextDuration * ratio;
    start = Math.max(fullRange.start, Math.min(start, fullRange.end - nextDuration));
    setView({ end: start + nextDuration, start });
  };

  return (
    <section aria-label={label} className="timeline rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div aria-label="Timeline legend" className="flex flex-wrap gap-3" role="list">
          {kinds.map((kind) => (
            <span
              className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
              key={kind}
              role="listitem"
            >
              <span aria-hidden="true" className={cn("size-2 rounded-full", colorFor(kind))} />
              {kind}
            </span>
          ))}
        </div>
        <button
          aria-label="Reset timeline zoom"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted disabled:opacity-40"
          disabled={view === null}
          onClick={() => setView(null)}
          type="button"
        >
          <RotateCcw aria-hidden="true" className="size-3" /> Reset zoom
        </button>
      </div>
      {validItems.length === 0 ? (
        <p className="m-0 text-xs text-muted-foreground">No timeline events recorded.</p>
      ) : (
        <div
          aria-label="Timeline plot. Scroll to zoom or drag to select a range."
          className="relative min-h-24 touch-none select-none overflow-hidden rounded-lg border bg-muted/40 px-2 py-3"
          onPointerDown={(event) => setBrushStart(coordinate(event.clientX))}
          onPointerUp={finishBrush}
          onWheel={zoom}
          ref={axis}
        >
          <div aria-hidden="true" className="absolute inset-x-2 top-1/2 h-px bg-border" />
          <div className="relative grid gap-2">
            {validItems.map((item) => {
              const end = itemEnd(item);
              if (end < range.start || item.start > range.end) return null;
              const left = Math.max(0, position(Math.max(item.start, range.start)));
              const width = Math.max(0.8, position(Math.min(end, range.end)) - left);
              const point = end <= item.start;
              const tooltipId = `timeline-detail-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
              return (
                <div className="relative h-6" key={item.id}>
                  <button
                    aria-describedby={tooltipId}
                    aria-label={`${item.label}, ${point ? "point event" : "span"}`}
                    className={cn(
                      "absolute top-0 h-5 border-2 border-card shadow-sm transition-opacity hover:opacity-80 focus-visible:z-20",
                      point ? "w-5 -translate-x-1/2 rounded-full" : "min-w-1 rounded-md",
                      colorFor(item.kind),
                    )}
                    data-timeline-shape={point ? "point" : "span"}
                    onBlur={() => setActive(null)}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect?.(item);
                    }}
                    onFocus={() => setActive(item.id)}
                    onMouseEnter={() => setActive(item.id)}
                    onMouseLeave={() => setActive(null)}
                    style={{ left: `${left}%`, width: point ? undefined : `${width}%` }}
                    type="button"
                  >
                    {point ? (
                      <Circle
                        aria-hidden="true"
                        className="m-auto size-2 fill-current text-white"
                      />
                    ) : null}
                  </button>
                  <span
                    className={cn(
                      "pointer-events-none absolute z-30 max-w-80 rounded-md bg-popover px-2.5 py-2 text-[10px] leading-relaxed text-popover-foreground shadow-lg",
                      active === item.id ? "block" : "sr-only",
                    )}
                    id={tooltipId}
                    role={active === item.id ? "tooltip" : undefined}
                    style={{ left: `${Math.min(75, Math.max(0, left))}%`, top: "1.4rem" }}
                  >
                    {detailText(item, getFailureExcerpt?.(item))}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[9px] text-subtle">
            <span>{formatTime(range.start)}</span>
            <span>{formatTime(range.end)}</span>
          </div>
        </div>
      )}
    </section>
  );
}
