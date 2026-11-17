import { seedE2eHistory, seedTimedE2eSession } from "@oneharness-ui/bridge/test/e2e-history.ts";
import { expect, type Locator, type Page, test } from "@playwright/test";

type Box = { bottom: number; left: number; right: number; top: number };
type Line = { box: Box; text: string };

/**
 * Runs whose recorded span the axis must label. Every span but the 30 s one starts and ends on
 * a whole minute, so all its ticks do too; the 30 s span holds no whole minute at all.
 */
const spans = [
  {
    durationMs: 30_000,
    name: "span-30-seconds",
    offset: /^\+\d+ s$/,
    readoutOffset: /^\+\d+(\.\d)? s$/,
    startedAt: "2026-11-17T09:12:20Z",
    wholeMinutes: false,
  },
  {
    durationMs: 7 * 60_000,
    name: "span-7-minutes",
    offset: /^\+\d+ min$/,
    readoutOffset: /^\+(\d+ min( \d+ s)?|\d+ s)$/,
    startedAt: "2026-11-17T09:12:00Z",
    wholeMinutes: true,
  },
  {
    durationMs: 45 * 60_000,
    name: "span-45-minutes",
    offset: /^\+\d+ min$/,
    readoutOffset: /^\+\d+ min$/,
    startedAt: "2026-11-17T09:15:00Z",
    wholeMinutes: true,
  },
  {
    durationMs: 5 * 3_600_000,
    name: "span-5-hours",
    offset: /^\+(\d+ h( \d+ min)?|\d+ min)$/,
    readoutOffset: /^\+(\d+ h( \d+ min)?|\d+ min)$/,
    startedAt: "2026-11-17T09:00:00Z",
    wholeMinutes: true,
  },
] as const;
const widths = [
  { height: 800, name: "narrow", width: 390 },
  { height: 800, name: "wide", width: 1280 },
] as const;
const clockPattern = /^\d\d:\d\d(:\d\d(\.\d{1,3})?)?$/;
const secondsPattern = /^\d\d:\d\d:\d\d/;
const needlessDecimals = /\.(\d*0)?(\D|$)/;

// A worker that restarts after a failure runs this again, so it starts from the baseline rather
// than recording each span a second time beside the first.
test.beforeAll(async () => {
  await seedE2eHistory();
  for (const span of spans) await seedTimedE2eSession(span);
});

async function lines(element: Locator): Promise<Line[]> {
  return await element.evaluate((node) =>
    [...node.children].map((line) => {
      const { bottom, left, right, top } = line.getBoundingClientRect();
      return { box: { bottom, left, right, top }, text: line.textContent ?? "" };
    }),
  );
}

async function box(element: Locator): Promise<Box> {
  const bounds = await element.boundingBox();
  if (!bounds) throw new Error("expected a rendered element");
  return {
    bottom: bounds.y + bounds.height,
    left: bounds.x,
    right: bounds.x + bounds.width,
    top: bounds.y,
  };
}

function intersects(first: Box, second: Box): boolean {
  return (
    first.left < second.right &&
    second.left < first.right &&
    first.top < second.bottom &&
    second.top < first.bottom
  );
}

/** The offset sits on its own line under the time, centred on it. */
function expectOffsetUnderTime([clock, offset]: Line[]) {
  if (!clock || !offset) throw new Error("expected a time line and an offset line");
  expect(offset.box.top).toBeGreaterThanOrEqual(clock.box.bottom - 0.5);
  expect(
    Math.abs((offset.box.left + offset.box.right) / 2 - (clock.box.left + clock.box.right) / 2),
  ).toBeLessThanOrEqual(1);
}

async function openSpan(page: Page, name: string): Promise<Locator> {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(`Open conversation ${name}`) }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  const timeline = page.getByRole("region", { name: "Conversation timeline" });
  await expect(timeline).toBeVisible();
  return timeline;
}

for (const viewport of widths) {
  test.describe(`${viewport.name} timeline axis`, () => {
    test.use({ viewport: { height: viewport.height, width: viewport.width } });

    for (const span of spans) {
      test(`labels a ${span.name} run legibly and reads the crosshair the same way`, async ({
        page,
      }) => {
        const timeline = await openSpan(page, span.name);
        const plot = timeline.getByLabel(
          "Timeline plot. Scroll to zoom or drag to select a range.",
        );
        const plotBox = await box(plot);
        const ticks = timeline.getByRole("list", { name: "Timeline axis" }).getByRole("listitem");
        const wanted = Math.max(2, Math.floor((plotBox.right - plotBox.left) / 160));
        await expect.poll(() => ticks.count()).toBeGreaterThanOrEqual(wanted);

        const labels = await Promise.all(
          (await ticks.all()).map(async (tick) => ({
            box: await box(tick),
            lines: await lines(tick),
          })),
        );
        const texts = labels.map(({ lines: [clock, offset] }) => `${clock?.text} ${offset?.text}`);
        expect(new Set(texts).size).toBe(texts.length);
        for (const [index, label] of labels.entries()) {
          expect(label.box.left).toBeGreaterThanOrEqual(plotBox.left);
          expect(label.box.right).toBeLessThanOrEqual(plotBox.right);
          for (const other of labels.slice(index + 1))
            expect(intersects(label.box, other.box)).toBe(false);
          expectOffsetUnderTime(label.lines);
          const [clock, offset] = label.lines.map((line) => line.text);
          expect(clock).toMatch(clockPattern);
          expect(clock).toMatch(span.wholeMinutes ? /^\d\d:\d\d$/ : secondsPattern);
          expect(offset).toMatch(span.offset);
          expect(offset).not.toMatch(needlessDecimals);
        }
        if (span.name === "span-5-hours") expect(texts.join(" ")).toMatch(/\+\d+ h/);

        const crosshair = timeline.getByLabel("Timeline crosshair");
        const middle = (plotBox.top + plotBox.bottom) / 2;
        for (const fraction of [0.23, 0.61, 0.87]) {
          await page.mouse.move(plotBox.left + (plotBox.right - plotBox.left) * fraction, middle);
          await expect(crosshair).toBeVisible();
          const readout = await lines(crosshair.locator(":scope > *"));
          expectOffsetUnderTime(readout);
          const [clock, offset] = readout.map((line) => line.text);
          expect(clock).toMatch(clockPattern);
          expect(offset).toMatch(span.readoutOffset);
          expect(offset).not.toMatch(needlessDecimals);
          // These runs start on a whole minute, so the readout lands on one exactly when its
          // offset does: the time carries seconds only then.
          if (span.wholeMinutes)
            expect(secondsPattern.test(clock ?? "")).toBe(/ s$/.test(offset ?? ""));
          else expect(clock).toMatch(secondsPattern);
        }
      });
    }
  });
}
