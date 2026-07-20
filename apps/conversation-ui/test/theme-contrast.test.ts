import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../src/app/styles.css", import.meta.url), "utf8");
const proof = readFileSync(new URL("../docs/theme-proof/README.md", import.meta.url), "utf8");

const pairings = [
  ["foreground / background", "foreground", "background", 4.5],
  ["card foreground / card", "card-foreground", "card", 4.5],
  ["popover foreground / popover", "popover-foreground", "popover", 4.5],
  ["primary foreground / primary", "primary-foreground", "primary", 4.5],
  ["secondary foreground / secondary", "secondary-foreground", "secondary", 4.5],
  ["muted foreground / muted", "muted-foreground", "muted", 4.5],
  ["accent foreground / accent", "accent-foreground", "accent", 4.5],
  ["destructive / destructive surface", "destructive", "destructive-surface", 4.5],
  ["success / success surface", "success", "success-surface", 4.5],
  ["warning / warning surface", "warning", "warning-surface", 4.5],
  ["info / info surface", "info", "info-surface", 4.5],
  ["border / background", "border", "background", 3],
  ["input / card", "input", "card", 3],
  ["ring / background", "ring", "background", 3],
  ["subtle / background", "subtle", "background", 4.5],
  ["code foreground / code", "code-foreground", "code", 4.5],
] as const;

function tokens(block: string): ReadonlyMap<string, string> {
  return new Map(
    [...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/g)].map((match) => [
      match[1] ?? "",
      match[2] ?? "",
    ]),
  );
}

function luminance(color: string): number {
  const channels = color
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  if (channels?.length !== 3) throw new Error(`Invalid color token: ${color}`);
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function contrast(first: string, second: string): number {
  const values = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

describe("published theme contrast", () => {
  const root = styles.match(/:root\s*{(?<body>[^}]+)}/)?.groups?.body;
  const dark = styles.match(/\.dark\s*{(?<body>[^}]+)}/)?.groups?.body;
  if (!root || !dark) throw new Error("Theme token blocks are missing");
  const themes = [tokens(root), tokens(dark)] as const;

  for (const [label, foreground, background, minimum] of pairings) {
    test(`${label} meets its threshold and matches the PR table`, () => {
      const ratios = themes.map((theme) => {
        const foregroundValue = theme.get(foreground);
        const backgroundValue = theme.get(background);
        if (!foregroundValue || !backgroundValue) {
          throw new Error(`Missing ${foreground} or ${background}`);
        }
        return contrast(foregroundValue, backgroundValue);
      });
      expect(ratios[0]).toBeGreaterThanOrEqual(minimum);
      expect(ratios[1]).toBeGreaterThanOrEqual(minimum);
      expect(proof).toContain(`| ${label} | ${ratios[0]?.toFixed(2)} | ${ratios[1]?.toFixed(2)} |`);
    });
  }
});
