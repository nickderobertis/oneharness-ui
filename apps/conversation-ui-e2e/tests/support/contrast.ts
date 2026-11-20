import { readFile, writeFile } from "node:fs/promises";
import type { Locator } from "@playwright/test";
import {
  type ContrastReading,
  contrastTelemetryPath,
  contrastTelemetrySchema,
} from "../../contrast-telemetry.ts";

export type Rgba = { alpha: number; blue: number; green: number; red: number };

const number = String.raw`(-?[\d.]+(?:e-?\d+)?)(%?)`;
const separator = String.raw`[\s,/]+`;

function channel([value, percent]: [string, string], scale: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`unreadable colour channel ${value}`);
  return percent ? (parsed / 100) * scale : parsed;
}

function components(body: string, count: number): [string, string][] {
  const pattern = new RegExp(
    `^${Array(count).fill(number).join(separator)}(?:${separator}${number})?$`,
  );
  const match = body.trim().match(pattern);
  if (!match) throw new Error(`unreadable colour components "${body}"`);
  const values: [string, string][] = [];
  for (let index = 1; index < match.length; index += 2)
    if (match[index] !== undefined) values.push([match[index] ?? "", match[index + 1] ?? ""]);
  return values;
}

const toSrgb = (linear: number) =>
  255 *
  Math.min(
    1,
    Math.max(0, linear <= 0.003_130_8 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055),
  );

function fromOklab(lightness: number, a: number, b: number, alpha: number): Rgba {
  const l = (lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m = (lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s = (lightness - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
  return {
    alpha,
    blue: toSrgb(-0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s),
    green: toSrgb(-1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s),
    red: toSrgb(4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s),
  };
}

/**
 * Parses a computed CSS colour into sRGB channels (0–255) and alpha. Browsers serialise computed
 * colours as hex, `rgb()`, `color(srgb …)` or, for Tailwind's `oklab` mixes, `oklab()`/`oklch()`;
 * anything else is refused rather than guessed.
 */
export function parseColor(value: string): Rgba {
  const text = value.trim().toLowerCase();
  const hex = text.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (hex?.[1])
    return {
      alpha: hex[2] ? Number.parseInt(hex[2], 16) / 255 : 1,
      blue: Number.parseInt(hex[1].slice(4, 6), 16),
      green: Number.parseInt(hex[1].slice(2, 4), 16),
      red: Number.parseInt(hex[1].slice(0, 2), 16),
    };
  if (text === "transparent") return { alpha: 0, blue: 0, green: 0, red: 0 };
  const call = text.match(/^([a-z]+)\((.*)\)$/);
  if (!call?.[1] || call[2] === undefined) throw new Error(`cannot resolve colour "${value}"`);
  const [name, body] = [call[1], call[2]];
  if (name === "rgb" || name === "rgba") {
    const [red, green, blue, alpha] = components(body, 3);
    if (!red || !green || !blue) throw new Error(`cannot resolve colour "${value}"`);
    return {
      alpha: alpha ? channel(alpha, 1) : 1,
      blue: channel(blue, 255),
      green: channel(green, 255),
      red: channel(red, 255),
    };
  }
  if (name === "color" && body.trim().startsWith("srgb ")) {
    const [red, green, blue, alpha] = components(body.trim().slice(5), 3);
    if (!red || !green || !blue) throw new Error(`cannot resolve colour "${value}"`);
    return {
      alpha: alpha ? channel(alpha, 1) : 1,
      blue: channel(blue, 1) * 255,
      green: channel(green, 1) * 255,
      red: channel(red, 1) * 255,
    };
  }
  if (name === "oklab" || name === "oklch") {
    const [first, second, third, alpha] = components(body, 3);
    if (!first || !second || !third) throw new Error(`cannot resolve colour "${value}"`);
    const lightness = channel(first, 1);
    const opacity = alpha ? channel(alpha, 1) : 1;
    if (name === "oklab")
      return fromOklab(lightness, channel(second, 0.4), channel(third, 0.4), opacity);
    const chroma = channel(second, 0.4);
    const hue = (channel(third, 360) * Math.PI) / 180;
    return fromOklab(lightness, chroma * Math.cos(hue), chroma * Math.sin(hue), opacity);
  }
  throw new Error(`cannot resolve colour "${value}"`);
}

/** Paints `top` over the opaque `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const mix = (front: number, back: number) => front * top.alpha + back * (1 - top.alpha);
  return {
    alpha: 1,
    blue: mix(top.blue, bottom.blue),
    green: mix(top.green, bottom.green),
    red: mix(top.red, bottom.red),
  };
}

/**
 * The opaque colour rendered behind `element`: every ancestor's background, from the root
 * down, composited. Throws when nothing behind it is painted.
 */
export async function backgroundBehind(element: Locator): Promise<Rgba> {
  const layers = await element.evaluate((node) => {
    const colors: string[] = [];
    for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement)
      colors.push(getComputedStyle(ancestor).backgroundColor);
    return colors.reverse();
  });
  let painted: Rgba | null = null;
  for (const layer of layers.map(parseColor)) {
    if (layer.alpha === 0) continue;
    if (!painted && layer.alpha < 1) continue;
    painted = painted ? composite(layer, painted) : layer;
  }
  if (!painted) throw new Error("nothing opaque is painted behind the element");
  return painted;
}

function luminance({ blue, green, red }: Rgba): number {
  const linear = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.040_45 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** The WCAG 2.x contrast ratio of `foreground`, composited over `background`, against it. */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const front = luminance(composite(foreground, background));
  const back = luminance(background);
  return (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
}

/** A colour that must be painted: refuses a transparent one rather than recording it. */
export function paintedColor(value: string, part: string): Rgba {
  const color = parseColor(value);
  if (color.alpha === 0) throw new Error(`the ${part} is transparent, so its contrast is unknown`);
  return color;
}

/** Appends one reading to this run's contrast telemetry. Journeys run on one worker. */
export async function recordReading(reading: ContrastReading): Promise<void> {
  const telemetry = contrastTelemetrySchema.parse(
    JSON.parse(await readFile(contrastTelemetryPath, "utf8")),
  );
  telemetry.readings.push(reading);
  await writeFile(contrastTelemetryPath, `${JSON.stringify(telemetry, null, 2)}\n`);
}
