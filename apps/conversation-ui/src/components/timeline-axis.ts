const second = 1_000;
const minute = 60 * second;
const hour = 60 * minute;
const day = 24 * hour;

/** Round steps for the tick grid; no step is more than 2.5 times the one before it. */
const tickIntervals: readonly number[] = [
  1,
  2,
  5,
  10,
  20,
  50,
  100,
  200,
  500,
  second,
  2 * second,
  5 * second,
  10 * second,
  15 * second,
  20 * second,
  30 * second,
  minute,
  2 * minute,
  5 * minute,
  10 * minute,
  15 * minute,
  20 * minute,
  30 * minute,
  hour,
  2 * hour,
  3 * hour,
  6 * hour,
  12 * hour,
  day,
  2 * day,
  7 * day,
  14 * day,
  30 * day,
  60 * day,
  90 * day,
  180 * day,
  365 * day,
];

/**
 * Axis labels are 9px monospace, whose advance is 0.6em; the estimate rounds up so a label is
 * never placed closer to its neighbour than it really is.
 */
const labelCharacterPx = 5.6;
const labelGapPx = 8;
/** The axis keeps at least one labelled tick per this many pixels of its width, and never fewer than two. */
const labelledTickWidthPx = 160;

export type AxisTickAlignment = "center" | "end" | "start";

export interface AxisTick {
  /** Where the label box sits: centred on its tick, or held inside the axis at either edge. */
  alignment: AxisTickAlignment;
  clock: string;
  offset: string;
  value: number;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** Local wall-clock time that shows seconds, and then fractions of one, only when the instant needs them. */
export function formatClockTime(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value);
  const hoursAndMinutes = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const milliseconds = date.getMilliseconds();
  if (date.getSeconds() === 0 && milliseconds === 0) return hoursAndMinutes;
  const seconds = `${hoursAndMinutes}:${pad(date.getSeconds())}`;
  if (milliseconds === 0) return seconds;
  const digits = milliseconds % 100 === 0 ? 1 : milliseconds % 10 === 0 ? 2 : 3;
  return `${seconds}.${pad(milliseconds, 3).slice(0, digits)}`;
}

/**
 * Elapsed time rounded to `precisionMs` (a power of ten below a second, a second, or a minute)
 * and written in the largest units that hold it exactly: `+3 min`, `+1 h 30 min`, `+12.5 s`.
 */
export function formatElapsedOffset(elapsedMs: number, precisionMs: number): string {
  const sign = elapsedMs < 0 ? "-" : "+";
  const total = Math.round(Math.abs(elapsedMs) / precisionMs) * precisionMs;
  const hours = Math.floor(total / hour);
  const minutes = Math.floor((total % hour) / minute);
  const secondsMs = Math.round(total % minute);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (secondsMs > 0) {
    const decimals = precisionMs < second ? Math.round(Math.log10(second / precisionMs)) : 0;
    parts.push(`${Number((secondsMs / second).toFixed(decimals))} s`);
  }
  if (parts.length === 0) return `+0 ${precisionMs >= minute ? "min" : "s"}`;
  return `${sign}${parts.join(" ")}`;
}

/** The finest offset unit a tick grid of this interval needs. */
function offsetPrecision(interval: number): number {
  if (interval >= minute) return minute;
  if (interval >= second) return second;
  return 10 ** Math.floor(Math.log10(interval));
}

/** The finest of 1, 10 or 100 ms, a second or a minute that one pixel of the plot can resolve. */
export function readoutPrecision(msPerPixel: number): number {
  return [1, 10, 100, second].find((precision) => precision >= msPerPixel) ?? minute;
}

export function crosshairReadout(
  time: number,
  origin: number,
  msPerPixel: number,
): { clock: string; offset: string } {
  const precision = readoutPrecision(msPerPixel);
  const rounded = Math.round(time / precision) * precision;
  return {
    clock: formatClockTime(rounded),
    offset: formatElapsedOffset(rounded - origin, precision),
  };
}

function labelWidth(clock: string, offset: string): number {
  return Math.max(clock.length, offset.length) * labelCharacterPx;
}

/** Hour-and-longer grids align to local midnight so a 3 h grid reads 09:00, 12:00, 15:00. */
function firstTick(start: number, interval: number): number {
  const zone = interval >= hour ? -new Date(start).getTimezoneOffset() * minute : 0;
  return Math.ceil((start + zone) / interval) * interval - zone;
}

/**
 * Places the labels of one grid left to right, holding edge labels inside the axis and leaving
 * out any label that would touch the one before it.
 */
function placeTicks(
  interval: number,
  range: { end: number; start: number },
  origin: number,
  width: number,
): { regular: boolean; ticks: AxisTick[] } {
  const duration = range.end - range.start;
  const precision = offsetPrecision(interval);
  const ticks: AxisTick[] = [];
  let widest = 0;
  let previousRight = Number.NEGATIVE_INFINITY;
  for (let value = firstTick(range.start, interval); value <= range.end; value += interval) {
    const clock = formatClockTime(value);
    const offset = formatElapsedOffset(value - origin, precision);
    const labelPx = labelWidth(clock, offset);
    widest = Math.max(widest, labelPx);
    const center = ((value - range.start) / duration) * width;
    let left = center - labelPx / 2;
    let alignment: AxisTickAlignment = "center";
    if (left < 0) {
      left = 0;
      alignment = "start";
    } else if (left + labelPx > width) {
      left = width - labelPx;
      alignment = "end";
    }
    if (left < previousRight + labelGapPx) continue;
    previousRight = left + labelPx;
    ticks.push({ alignment, clock, offset, value });
  }
  return { regular: (interval / duration) * width >= widest + labelGapPx, ticks };
}

/**
 * Chooses the coarsest round grid that still labels one tick per 160px of the axis, among the
 * grids whose labels fit side by side; a narrow axis that cannot reach that density gets the
 * densest grid that fits. No two returned labels overlap.
 */
export function timelineAxisTicks({
  minSpacingPx = 0,
  origin,
  range,
  width,
}: {
  minSpacingPx?: number;
  origin: number;
  range: { end: number; start: number };
  width: number;
}): AxisTick[] {
  const duration = range.end - range.start;
  if (!(duration > 0) || !(width > 0)) return [];
  const wanted = Math.max(2, Math.floor(width / labelledTickWidthPx));
  const narrowestLabelPx = 5 * labelCharacterPx + labelGapPx;
  let densestFitting: AxisTick[] | null = null;
  let coarsestDenseEnough: AxisTick[] | null = null;
  let coarsest: AxisTick[] = [];
  for (const interval of tickIntervals) {
    const spacing = (interval / duration) * width;
    if (spacing < Math.max(minSpacingPx, narrowestLabelPx)) continue;
    const { regular, ticks } = placeTicks(interval, range, origin, width);
    coarsest = ticks;
    if (!regular) continue;
    densestFitting ??= ticks;
    if (ticks.length >= wanted) coarsestDenseEnough = ticks;
  }
  return coarsestDenseEnough ?? densestFitting ?? coarsest;
}
