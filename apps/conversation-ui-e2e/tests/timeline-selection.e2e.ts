import { expect, type Locator, type Page, test } from "@playwright/test";
import { z } from "zod";
import { harnessOrigin } from "../harness/configuration.ts";
import { hostScroll } from "./support/fixtures.ts";

const plotName = "Timeline plot. Scroll to zoom or drag to select a range.";
const hostUrl = (component: "conversation-timeline" | "timeline") =>
  `${harnessOrigin}/?${new URLSearchParams({ component, theme: "light", view: "scrolled-host" })}`;

/** Every scroll offset a selection could move: the page's and each element's, in tree order. */
const offsetsSchema = z.object({
  ancestors: z.array(z.object({ left: z.number(), top: z.number() })),
  /** Elements inside the timeline root, the root too, scrolled vertically at all. */
  insideScrolled: z.array(z.string()),
});
type Offsets = z.infer<typeof offsetsSchema>;

async function offsets(root: Locator): Promise<Offsets> {
  return offsetsSchema.parse(
    await root.evaluate((element) => {
      const ancestors: { left: number; top: number }[] = [];
      for (let node = element.parentElement; node; node = node.parentElement)
        ancestors.push({ left: node.scrollLeft, top: node.scrollTop });
      ancestors.push({ left: window.scrollX, top: window.scrollY });
      const insideScrolled = [element, ...element.querySelectorAll("*")]
        .filter((node) => node.scrollTop !== 0)
        .map((node) => `${node.tagName} ${node.getAttribute("aria-label") ?? ""}`);
      return { ancestors, insideScrolled };
    }),
  );
}

/** The host scrolled both ways, as a reader leaves it before anything is selected. */
async function scrollHost(page: Page): Promise<Locator> {
  const host = page.getByRole("region", { name: "Timeline host" });
  await host.evaluate((element, to) => element.scrollTo(to.left, to.top), hostScroll);
  await expect
    .poll(() => host.evaluate((element) => [element.scrollLeft, element.scrollTop]))
    .toEqual([hostScroll.left, hostScroll.top]);
  return host;
}

/** A consumer selects in place; the harness takes the selection from the hash. */
async function select(page: Page, url: string, hash: string) {
  await page.goto(`${url}#${hash}`);
  // A scroll the selection caused lands within a frame or two; give it far longer than that.
  await page.waitForTimeout(500);
}

/** The plot's horizontal offset, and whether `entry` lies wholly within its visible width. */
async function plotView(plot: Locator, entry: Locator) {
  const box = await entry.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  });
  return await plot.evaluate((element, target) => {
    const left = element.getBoundingClientRect().left + element.clientLeft;
    return {
      inView: target.left >= left - 0.5 && target.right <= left + element.clientWidth + 0.5,
      scrollLeft: element.scrollLeft,
    };
  }, box);
}

/** The ring the selected state draws, read from the computed box shadow's spreads. */
async function ringSpreads(entry: Locator): Promise<string[]> {
  const shadow = await entry.evaluate((element) => getComputedStyle(element).boxShadow);
  return [...shadow.matchAll(/0px 0px 0px (\d+(?:\.\d+)?)px/g)].map((match) => match[1] ?? "");
}

test("selecting in a timeline scrolls no container around it, nor anything inside it vertically", async ({
  page,
}) => {
  const url = hostUrl("timeline");
  await page.goto(url);
  const root = page.getByRole("region", { name: "Timeline", exact: true });
  await expect(root.getByRole("button", { name: "Ship it, point event" })).toBeVisible();
  await scrollHost(page);
  const before = await offsets(root);
  expect(before.insideScrolled).toEqual([]);
  expect(before.ancestors).toContainEqual({ left: hostScroll.left, top: hostScroll.top });

  for (const id of ["merged", "plan", "ship", "checkpoint"]) {
    await test.step(`selected ${id}`, async () => {
      await select(page, url, id);
      await expect(root.locator('[data-selected="true"]')).toHaveCount(1);
      const after = await offsets(root);
      expect(after.ancestors).toEqual(before.ancestors);
      expect(after.insideScrolled).toEqual(before.insideScrolled);
    });
  }
});

test("focusing a conversation timeline scrolls no container around it, nor anything inside it vertically", async ({
  page,
}) => {
  const url = hostUrl("conversation-timeline");
  await page.goto(url);
  const root = page.getByRole("region", { name: "Conversation timeline" });
  await expect(root.getByLabel(plotName)).toBeVisible();
  await scrollHost(page);
  const before = await offsets(root);

  for (const kind of ["tool", "message", "reasoning"]) {
    await test.step(`focused on its ${kind}`, async () => {
      await select(page, url, kind);
      await expect(root.locator('[data-selected="true"]')).toHaveCount(1);
      const after = await offsets(root);
      expect(after.ancestors).toEqual(before.ancestors);
      expect(after.insideScrolled).toEqual(before.insideScrolled);
    });
  }
});

test("a selection outside the plot's horizontal view pans it into view, and one in view moves nothing", async ({
  page,
}) => {
  const url = hostUrl("timeline");
  await page.goto(url);
  const plot = page.getByLabel(plotName);
  const ship = plot.getByRole("button", { name: "Ship it, point event" });
  const checkpoint = plot.getByRole("button", { name: "Checkpoint, marker" });
  const planBar = plot.getByRole("button", { name: "Plan the run, span" });
  await expect(ship).toBeVisible();
  const unselected = await plotView(plot, ship);
  expect(unselected.scrollLeft).toBe(0);
  expect(unselected.inView, "the last instant's glyph straddles the plot's right edge").toBe(false);

  await test.step("past the right edge", async () => {
    await select(page, url, "ship");
    const view = await plotView(plot, ship);
    expect(view.inView).toBe(true);
    expect(view.scrollLeft).toBeGreaterThan(0);
  });
  const panned = (await plotView(plot, ship)).scrollLeft;

  await test.step("already in view", async () => {
    await select(page, url, "checkpoint");
    const view = await plotView(plot, checkpoint);
    expect(view.inView).toBe(true);
    expect(view.scrollLeft).toBe(panned);
  });

  await test.step("past the left edge", async () => {
    expect(
      (await plotView(plot, planBar)).inView,
      "the panned plot hides the first bar's start",
    ).toBe(false);
    await select(page, url, "plan");
    const view = await plotView(plot, planBar);
    expect(view.inView).toBe(true);
    expect(view.scrollLeft).toBe(0);
  });
});

test("a selected entry keeps its selection state and selected styling", async ({ page }) => {
  const url = hostUrl("timeline");
  await page.goto(url);
  const plot = page.getByLabel(plotName);
  const ship = plot.getByRole("button", { name: "Ship it, point event" });
  const plan = plot.getByRole("button", { name: "Plan the run, span" });
  const merged = plot.getByRole("button", { name: "Merged, marker" });
  await expect(ship).toBeVisible();
  const unselectedRing = await ringSpreads(ship);
  expect(unselectedRing.filter((spread) => spread !== "0")).toEqual([]);

  await select(page, url, "ship");
  await expect(ship).toHaveAttribute("data-selected", "true");
  await expect(ship).toHaveAttribute("aria-pressed", "true");
  await expect(ship).toHaveAttribute("aria-current", "true");
  // ring-2 drawn outside a 1px ring offset.
  expect((await ringSpreads(ship)).filter((spread) => spread !== "0")).toEqual(["1", "3"]);
  await expect(plan).toHaveAttribute("data-selected", "false");
  await expect(plan).toHaveAttribute("aria-pressed", "false");
  await expect(plan).not.toHaveAttribute("aria-current", /.*/);

  await select(page, url, "merged");
  await expect(merged).toHaveAttribute("data-selected", "true");
  await expect(merged).toHaveAttribute("aria-pressed", "true");
  await expect(merged).not.toHaveAttribute("aria-current", /.*/);
  expect((await ringSpreads(merged)).filter((spread) => spread !== "0")).toEqual(["2"]);
  await expect(ship).toHaveAttribute("data-selected", "false");
  await expect(ship).toHaveAttribute("aria-pressed", "false");
  await expect(ship).not.toHaveAttribute("aria-current", /.*/);
  expect((await ringSpreads(ship)).filter((spread) => spread !== "0")).toEqual([]);
});
