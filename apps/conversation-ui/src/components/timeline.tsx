"use client";

import { ChevronDown, ChevronUp, Circle, MapPin, RotateCcw } from "lucide-react";
import {
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { cn } from "./utils";

export interface TimelineLane {
  id: string;
  label: string;
}

export interface TimelineItem<Payload = unknown> {
  duration?: number | null;
  end?: number | null;
  id: string;
  /** Legacy category name. Prefer laneId for new consumers. */
  kind?: string;
  label: string;
  laneId?: string;
  /** Retained for compatibility with v1 items. */
  parent?: string | null;
  payload: Payload;
  start: number;
  status?: string | null;
}

export interface TimelineMarker<Payload = unknown> {
  at: number;
  icon?: ReactNode;
  id: string;
  label: string;
  payload: Payload;
  status?: string | null;
}

export interface TimelineProps<Payload> {
  axis?: { origin: number };
  cursor?: number | null;
  expanded?: boolean;
  getFailureExcerpt?: (item: TimelineItem<Payload>) => string | null | undefined;
  items: readonly TimelineItem<Payload>[];
  label?: string;
  lanes?: readonly TimelineLane[];
  markers?: readonly TimelineMarker<Payload>[];
  onExpandedChange?: (expanded: boolean) => void;
  onRangeChange?: (range: [number, number]) => void;
  onSelect?: (entry: TimelineItem<Payload> | TimelineMarker<Payload>) => void;
  range?: readonly [number, number];
  selectedId?: string | null;
}

type Range = { end: number; start: number };
type TimelineView = {
  axis: RefObject<HTMLDivElement | null>;
  brushStart: (clientX: number) => void;
  finishBrush: (clientX: number) => void;
  range: Range;
  reset: () => void;
  viewChanged: boolean;
  zoom: (clientX: number, deltaY: number) => void;
};
const laneColors = [
  "bg-spectrum-blue",
  "bg-spectrum-green",
  "bg-spectrum-orange",
  "bg-spectrum-violet",
  "bg-spectrum-red",
  "bg-spectrum-indigo",
  "bg-spectrum-yellow",
] as const;
const implicitLaneId = "__timeline_implicit_lane__";

/** Stable FNV-1a hashing makes color independent of render and item order. */
export function timelineLaneColor(laneId: string): (typeof laneColors)[number] {
  let hash = 2_166_136_261;
  for (const character of laneId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return laneColors[(hash >>> 0) % laneColors.length] ?? laneColors[0];
}

function itemLane(item: TimelineItem): string {
  return item.laneId ?? implicitLaneId;
}

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

function formatElapsed(value: number): string {
  return `+${formatDuration(value)}`;
}

function formatTime(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toISOString();
}

function formatTick(value: number, origin: number): string {
  const date = new Date(value);
  const local = Number.isNaN(date.valueOf())
    ? String(value)
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${local} ${formatElapsed(value - origin)}`;
}

function detailText<Payload>(item: TimelineItem<Payload>, failure?: string | null): string {
  const end = itemEnd(item);
  const parts = [
    item.label,
    `Lane: ${itemLane(item)}`,
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

function useTimelineView(
  fullRange: Range,
  controlledRange: readonly [number, number] | undefined,
  onRangeChange: ((range: [number, number]) => void) | undefined,
): TimelineView {
  const [view, setView] = useState<Range | null>(null);
  const [brushOrigin, setBrushOrigin] = useState<number | null>(null);
  const axis = useRef<HTMLDivElement>(null);
  const controlled =
    controlledRange && controlledRange[1] > controlledRange[0]
      ? { end: controlledRange[1], start: controlledRange[0] }
      : null;
  const range = controlled ?? view ?? fullRange;
  const rangeDuration = Math.max(1, range.end - range.start);
  const change = (next: Range) => {
    onRangeChange?.([next.start, next.end]);
    if (!controlledRange) setView(next);
  };
  const coordinate = (clientX: number) => {
    const bounds = axis.current?.getBoundingClientRect();
    const width = bounds?.width || 1_000;
    return (
      range.start +
      Math.min(1, Math.max(0, (clientX - (bounds?.left ?? 0)) / width)) * rangeDuration
    );
  };

  return {
    axis,
    brushStart: (clientX) => setBrushOrigin(coordinate(clientX)),
    finishBrush: (clientX) => {
      if (brushOrigin === null) return;
      const end = coordinate(clientX);
      if (Math.abs(end - brushOrigin) >= rangeDuration * 0.02)
        change({ end: Math.max(end, brushOrigin), start: Math.min(end, brushOrigin) });
      setBrushOrigin(null);
    },
    range,
    reset: () => {
      onRangeChange?.([fullRange.start, fullRange.end]);
      if (!controlledRange) setView(null);
    },
    viewChanged: range.start !== fullRange.start || range.end !== fullRange.end,
    zoom: (clientX, deltaY) => {
      const anchor = coordinate(clientX);
      const factor = deltaY < 0 ? 0.75 : 1.25;
      const fullDuration = Math.max(1, fullRange.end - fullRange.start);
      const nextDuration = Math.min(
        fullDuration,
        Math.max(fullDuration / 100, rangeDuration * factor),
      );
      const ratio = (anchor - range.start) / rangeDuration;
      let start = anchor - nextDuration * ratio;
      start = Math.max(fullRange.start, Math.min(start, fullRange.end - nextDuration));
      change({ end: start + nextDuration, start });
    },
  };
}

export function Timeline<Payload>({
  axis: axisOptions,
  cursor,
  expanded = false,
  getFailureExcerpt,
  items,
  label = "Timeline",
  lanes,
  markers = [],
  onExpandedChange,
  onRangeChange,
  onSelect,
  range: controlledRange,
  selectedId,
}: TimelineProps<Payload>) {
  const [active, setActive] = useState<string | null>(null);
  const validItems = useMemo(() => items.filter((item) => Number.isFinite(item.start)), [items]);
  const validMarkers = useMemo(
    () => markers.filter((marker) => Number.isFinite(marker.at)),
    [markers],
  );
  const renderedLanes = useMemo<TimelineLane[]>(() => {
    if (lanes) return [...lanes];
    const ids = [...new Set(validItems.map(itemLane))];
    return ids.map((id) => ({ id, label: id === implicitLaneId ? "Events" : id }));
  }, [lanes, validItems]);
  const fullRange = useMemo<Range>(() => {
    const times = [
      ...validItems.flatMap((item) => [item.start, itemEnd(item)]),
      ...validMarkers.map((marker) => marker.at),
    ];
    if (times.length === 0) return { end: 1, start: 0 };
    const start = Math.min(...times);
    const rawEnd = Math.max(...times);
    return { end: rawEnd > start ? rawEnd : start + 1, start };
  }, [validItems, validMarkers]);
  const timelineView = useTimelineView(fullRange, controlledRange, onRangeChange);
  const { axis, range } = timelineView;
  const rangeDuration = Math.max(1, range.end - range.start);
  const position = (value: number) => ((value - range.start) / rangeDuration) * 100;
  const rows = expanded ? renderedLanes : [{ id: "overlay", label: "All events" }];
  const origin = axisOptions?.origin ?? fullRange.start;

  const renderItem = (item: TimelineItem<Payload>) => {
    const end = itemEnd(item);
    if (end < range.start || item.start > range.end) return null;
    const left = Math.max(0, position(Math.max(item.start, range.start)));
    const width = Math.max(0.8, position(Math.min(end, range.end)) - left);
    const point = end <= item.start;
    const tooltipId = `timeline-detail-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const color = timelineLaneColor(itemLane(item));
    return (
      <div className="absolute inset-y-0" key={item.id} style={{ left: `${left}%` }}>
        <button
          aria-describedby={tooltipId}
          aria-label={`${item.label}, ${point ? "point event" : "span"}`}
          aria-pressed={selectedId === item.id}
          className={cn(
            "absolute top-0 h-5 border-2 border-card shadow-sm hover:opacity-80 focus-visible:z-20",
            point ? "w-5 -translate-x-1/2 rounded-full" : "min-w-1 rounded-md",
            selectedId === item.id && "ring-2 ring-foreground ring-offset-1",
            color,
          )}
          data-lane-color={color}
          data-selected={selectedId === item.id ? "true" : "false"}
          data-timeline-shape={point ? "point" : "span"}
          onBlur={() => setActive(null)}
          onClick={(event) => {
            event.stopPropagation();
            setActive(item.id);
            onSelect?.(item);
          }}
          onFocus={() => setActive(item.id)}
          onMouseEnter={() => setActive(item.id)}
          onMouseLeave={() => setActive(null)}
          style={{ width: point ? undefined : `${width}cqw` }}
          type="button"
        >
          {point ? (
            <Circle aria-hidden="true" className="m-auto size-2 fill-current text-white" />
          ) : null}
        </button>
        <span
          className={cn(
            "pointer-events-none absolute z-30 w-80 rounded-md bg-popover px-2.5 py-2 text-[10px] text-popover-foreground shadow-lg",
            active === item.id ? "block" : "sr-only",
          )}
          id={tooltipId}
          role={active === item.id ? "tooltip" : undefined}
          style={{ top: "1.4rem" }}
        >
          {detailText(item, getFailureExcerpt?.(item))}
        </span>
      </div>
    );
  };

  return (
    <section aria-label={label} className="timeline rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div aria-label="Timeline legend" className="flex flex-wrap gap-3" role="list">
          {renderedLanes.map((lane) => (
            <span
              className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
              key={lane.id}
              role="listitem"
            >
              <span
                aria-hidden="true"
                className={cn("size-2 rounded-full", timelineLaneColor(lane.id))}
              />
              {lane.label}
            </span>
          ))}
        </div>
        <div className="flex gap-1">
          <button
            aria-label={expanded ? "Collapse timeline" : "Expand timeline"}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted"
            onClick={() => onExpandedChange?.(!expanded)}
            type="button"
          >
            {expanded ? (
              <ChevronUp aria-hidden="true" className="size-3" />
            ) : (
              <ChevronDown aria-hidden="true" className="size-3" />
            )}
            {expanded ? "Collapse" : "Expand"}
          </button>
          <button
            aria-label="Reset timeline zoom"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted disabled:opacity-40"
            disabled={!timelineView.viewChanged}
            onClick={timelineView.reset}
            type="button"
          >
            <RotateCcw aria-hidden="true" className="size-3" /> Reset zoom
          </button>
        </div>
      </div>
      {validItems.length === 0 && validMarkers.length === 0 ? (
        <p className="m-0 text-xs text-muted-foreground">No timeline events recorded.</p>
      ) : (
        <div
          aria-label="Timeline plot. Scroll to zoom or drag to select a range."
          className="relative touch-none select-none overflow-hidden rounded-lg border bg-muted/40 px-2 pb-3 pt-7"
          onPointerDown={(event: PointerEvent<HTMLDivElement>) =>
            timelineView.brushStart(event.clientX)
          }
          onPointerUp={(event: PointerEvent<HTMLDivElement>) =>
            timelineView.finishBrush(event.clientX)
          }
          onWheel={(event: WheelEvent<HTMLDivElement>) => {
            event.preventDefault();
            timelineView.zoom(event.clientX, event.deltaY);
          }}
          ref={axis}
        >
          <div className="relative grid gap-2" style={{ containerType: "inline-size" }}>
            {rows.map((lane) => (
              <div
                className="relative h-6 border-b border-border/60"
                data-lane-id={lane.id}
                data-testid="timeline-lane"
                key={lane.id}
              >
                {expanded ? <span className="sr-only">{lane.label}</span> : null}
                {(expanded
                  ? validItems.filter((item) => itemLane(item) === lane.id)
                  : validItems
                ).map(renderItem)}
              </div>
            ))}
            {validMarkers.map((marker) => {
              if (marker.at < range.start || marker.at > range.end) return null;
              return (
                <div
                  className="pointer-events-none absolute inset-y-0 z-20"
                  key={marker.id}
                  style={{ left: `${position(marker.at)}%` }}
                >
                  <span
                    className="absolute inset-y-0 w-px bg-foreground/60"
                    data-testid="timeline-marker-line"
                  />
                  <button
                    aria-label={`${marker.label}, marker`}
                    aria-pressed={selectedId === marker.id}
                    className={cn(
                      "pointer-events-auto absolute bottom-full left-1/2 mb-1 flex size-5 -translate-x-1/2 items-center justify-center rounded-full bg-card text-foreground shadow",
                      selectedId === marker.id && "ring-2 ring-foreground",
                    )}
                    data-selected={selectedId === marker.id ? "true" : "false"}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect?.(marker);
                    }}
                    type="button"
                  >
                    {marker.icon ?? <MapPin aria-hidden="true" className="size-3" />}
                  </button>
                </div>
              );
            })}
            {typeof cursor === "number" &&
            Number.isFinite(cursor) &&
            cursor >= range.start &&
            cursor <= range.end ? (
              <span
                aria-label="Timeline cursor"
                className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary"
                data-testid="timeline-cursor"
                style={{ left: `${position(cursor)}%` }}
              />
            ) : null}
          </div>
          <div
            className="mt-2 flex justify-between font-mono text-[9px] text-subtle"
            data-testid="timeline-axis"
            data-timeline-axis
          >
            <span>{formatTick(range.start, origin)}</span>
            <span>{formatTick(range.end, origin)}</span>
          </div>
        </div>
      )}
    </section>
  );
}
