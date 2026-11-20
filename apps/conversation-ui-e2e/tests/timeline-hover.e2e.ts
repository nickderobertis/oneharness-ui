import { expect, type Locator, type Page, test } from "@playwright/test";
import { harnessOrigin } from "../harness/configuration.ts";
import {
  backgroundBehind,
  composite,
  contrastRatio,
  paintedColor,
  parseColor,
  recordReading,
} from "./support/contrast.ts";
import { timelineRangeSeconds } from "./support/fixtures.ts";

type Row = "agent" | "markers" | "tools";
type Reading = { id: string; label: string };

const plan = { id: "plan", label: "Plan the run, span" };
const tests = { id: "tests", label: "Run the tests, span" };
const patch = { id: "patch", label: "Write the patch, span" };
const checkpoint = { id: "checkpoint", label: "Checkpoint, marker" };
const reviewRequested = { id: "review-requested", label: "Review requested, marker" };
const reviewPassed = { id: "review-passed", label: "Review passed, marker" };
const merged = { id: "merged", label: "Merged, marker" };

/**
 * Where the pointer goes, in recorded seconds and plot row, and what the timeline must resolve
 * there. The bars end at 60 s; every marker after that has no bar beneath it.
 */
const positions: readonly { name: string; reading: Reading; row: Row; seconds: number }[] = [
  { name: "over the first bar", reading: plan, row: "agent", seconds: 10 },
  { name: "further along the same bar", reading: plan, row: "agent", seconds: 15 },
  { name: "over the tools lane where it has no bar", reading: patch, row: "tools", seconds: 50 },
  { name: "between bars, nearer the tools bar", reading: tests, row: "agent", seconds: 37 },
  { name: "on a marker glyph over a bar", reading: checkpoint, row: "markers", seconds: 10 },
  {
    name: "on the marker row past the last bar",
    reading: reviewRequested,
    row: "markers",
    seconds: 72,
  },
  { name: "over a lane past the last bar", reading: reviewPassed, row: "agent", seconds: 82 },
  { name: "on the last marker glyph", reading: merged, row: "markers", seconds: 90 },
];

async function openTimeline(page: Page, theme: "dark" | "light") {
  await page.goto(`${harnessOrigin}/?view=timeline&theme=${theme}`);
  const timeline = page.getByRole("region", { name: "Timeline", exact: true });
  const plot = timeline.getByLabel("Timeline plot. Scroll to zoom or drag to select a range.");
  await expect(plot).toBeVisible();
  // The plot's padding box is what the bars and the crosshair are laid out in.
  const area = await plot.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      bottom: bounds.bottom,
      left: bounds.left + element.clientLeft,
      top: bounds.top,
      width: element.clientWidth,
    };
  });
  const middle = async (name: string) => {
    const bounds = await timeline.getByRole("button", { name }).boundingBox();
    if (!bounds) throw new Error(`expected ${name} to be rendered`);
    return bounds.y + bounds.height / 2;
  };
  const rows: Record<Row, number> = {
    agent: await middle(plan.label),
    markers: await middle(merged.label),
    tools: await middle(tests.label),
  };
  return {
    crosshair: timeline.getByLabel("Timeline crosshair"),
    hovered: plot.locator('[data-timeline-hovered="true"]'),
    plot,
    point: (seconds: number, row: Row) => ({
      x: area.left + (seconds / timelineRangeSeconds) * area.width,
      y: rows[row],
    }),
    area,
    reading: page.getByRole("status", { name: "Hover reading" }),
    reports: page.getByRole("status", { name: "Hover reports" }),
  };
}

async function centre(element: Locator): Promise<number> {
  const bounds = await element.boundingBox();
  if (!bounds) throw new Error("expected a rendered crosshair");
  return bounds.x + bounds.width / 2;
}

test("reports the entry nearest the pointer anywhere on the plot and a crosshair that follows it", async ({
  page,
}) => {
  const timeline = await openTimeline(page, "light");
  let reports = 0;
  let previous: Reading | null = null;
  for (const position of positions) {
    await test.step(position.name, async () => {
      const { x, y } = timeline.point(position.seconds, position.row);
      await page.mouse.move(x, y);
      if (previous?.id !== position.reading.id) reports += 1;
      await expect(timeline.reading).toHaveText(
        `${position.reading.id} · ${position.reading.label}`,
      );
      await expect(timeline.reports).toHaveText(String(reports));
      await expect(timeline.hovered).toHaveCount(1);
      await expect(timeline.hovered).toHaveAttribute("aria-label", position.reading.label);
      await expect(timeline.crosshair).toBeVisible();
      await expect.poll(() => centre(timeline.crosshair)).toBeGreaterThanOrEqual(x - 1);
      expect(await centre(timeline.crosshair)).toBeLessThanOrEqual(x + 1);
      previous = position.reading;
    });
  }

  await test.step("off the plot", async () => {
    await page.mouse.move(timeline.area.left + timeline.area.width / 2, timeline.area.bottom + 80);
    await expect(timeline.reading).toHaveText("none");
    await expect(timeline.reports).toHaveText(String(reports + 1));
    await expect(timeline.hovered).toHaveCount(0);
    await expect(timeline.crosshair).toHaveCount(0);
  });
});

for (const theme of ["light", "dark"] as const) {
  test(`records the crosshair's contrast against the plot in the ${theme} theme`, async ({
    page,
  }) => {
    const timeline = await openTimeline(page, theme);
    const { x, y } = timeline.point(50, "tools");
    await page.mouse.move(x, y);
    await expect(timeline.crosshair).toBeVisible();
    const readout = timeline.crosshair.locator(":scope > *");
    const styles = await Promise.all([
      timeline.crosshair.evaluate((element) => getComputedStyle(element).backgroundColor),
      readout.evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, text: style.color };
      }),
    ]);
    const [lineColor, readoutStyle] = styles;
    // The crosshair is the readout's parent, so the plot behind both is read from the line.
    const plotBackground = await backgroundBehind(timeline.crosshair);
    const line = paintedColor(lineColor, "crosshair line");
    const readoutBackground = composite(parseColor(readoutStyle.background), plotBackground);
    const text = paintedColor(readoutStyle.text, "crosshair readout text");
    for (const [part, foreground, background] of [
      ["crosshair-line", line, plotBackground],
      ["crosshair-readout", text, readoutBackground],
    ] as const) {
      await recordReading({
        background,
        browser: test.info().project.name,
        foreground,
        part,
        ratio: contrastRatio(foreground, background),
        theme,
      });
    }
  });
}
