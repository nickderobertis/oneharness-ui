import { expect, type Locator, type Page, test } from "@playwright/test";
import { z } from "zod";
import { harnessOrigin } from "../harness/configuration.ts";
import {
  backgroundBehind,
  contrastRatio,
  paintedColor,
  parseColor,
  type Rgba,
  recordReading,
} from "./support/contrast.ts";
import {
  type FocusKind,
  focusEventIndex,
  focusedTurnIds,
  type PinnedFocusName,
  pinnedFocuses,
} from "./support/fixtures.ts";

type Theme = "dark" | "light";
type View = "conversation" | "turn-list";

/** Each view's scroll container, by the accessible name the package or harness gives it. */
const scrollContainers: Record<View, string> = {
  conversation: "Conversation turns",
  "turn-list": "Turn list",
};
const kinds: readonly FocusKind[] = ["message", "reasoning", "tool"];
/** Only the transcript's items: the conversation view's timeline marks its own selection too. */
const transcriptCurrent = (page: Page) =>
  page.locator('article[aria-current="true"], article [aria-current="true"]');
/** A consumer accent nowhere in the package's themes. */
const consumerHighlight = "#b4235a";

async function open(page: Page, view: View, theme: Theme, highlight?: string) {
  const query = new URLSearchParams({ theme, view, ...(highlight ? { highlight } : {}) });
  const url = `${harnessOrigin}/?${query}`;
  await page.goto(url);
  const container = page.getByRole("region", { name: scrollContainers[view], exact: true });
  const turn = (kind: FocusKind) =>
    container.getByRole("article", { name: `Turn ${focusedTurnIds[kind]} from claude-code` });
  await expect(turn("tool")).toBeAttached();
  return {
    container,
    /** Changes the focus in place, the way a consumer re-renders with a new `focus`. */
    focusOn: async (kind: FocusKind) => await page.goto(`${url}#${kind}`),
    /** The turn holding `kind`'s focus target. */
    turn,
  };
}

async function expectBelowFold(element: Locator, container: Locator) {
  const [inner, outer] = await Promise.all([element.boundingBox(), container.boundingBox()]);
  if (!inner || !outer) throw new Error("expected the item and its list rendered");
  expect(inner.y).toBeGreaterThan(outer.y + outer.height);
}

const triggerNames = { reasoning: "Reasoning", tool: "Bash tool details" } as const;

/** How a user finds each kind of item in a turn: the agent message group or the item's trigger. */
function handle(turn: Locator, kind: FocusKind): Locator {
  return kind === "message"
    ? turn.getByRole("group", { name: "Agent message" })
    : turn.getByRole("button", { name: triggerNames[kind] });
}

/** Exactly one transcript item is current: the `kind` item of `turn`, with its event index. */
async function expectCurrent(page: Page, turn: Locator, kind: FocusKind): Promise<Locator> {
  const current = transcriptCurrent(page);
  await expect(current).toHaveCount(1);
  await expect(turn.locator('[aria-current="true"]')).toHaveCount(1);
  if (kind === "message") await expect(handle(turn, kind)).toHaveAttribute("aria-current", "true");
  else await expect(current.getByRole("button", { name: triggerNames[kind] })).toHaveCount(1);
  await expect(current).toHaveAttribute("data-event-index", String(focusEventIndex[kind]));
  return current;
}

/**
 * The turn's structure as the package renders it — its collapse header, YOU and agent blocks,
 * avatar, model chip, activity items, tool rows and token chips — with each part's labels and
 * horizontal layout. Opened accordion content inside the turn is left out: focusing a tool call
 * has always opened its details, and that content is not part of the turn's structure. Only
 * content within this article is excluded, so a region around the list cannot empty the capture.
 */
async function structure(turn: Locator) {
  return await turn.evaluate((article) => {
    const origin = article.getBoundingClientRect();
    const parts = article.querySelectorAll<HTMLElement>(
      [
        "button",
        '[role="group"]',
        "[data-message-author]",
        "[data-event-index]",
        '[data-slot="avatar"]',
        '[data-slot="badge"]',
        'dl[aria-label="Usage"] > div',
      ].join(","),
    );
    return [...parts]
      .filter((part) => {
        const content = part.closest('[data-slot="accordion-content"]');
        return !(content && article.contains(content));
      })
      .map((part) => {
        const style = getComputedStyle(part);
        const bounds = part.getBoundingClientRect();
        const focused = part.getAttribute("aria-current") === "true";
        return {
          author: part.dataset.messageAuthor ?? null,
          background: focused ? "focus tint" : style.backgroundColor,
          border: `${style.borderLeftWidth} ${style.borderLeftStyle} ${style.borderLeftColor}`,
          color: style.color,
          display: style.display,
          eventIndex: part.dataset.eventIndex ?? null,
          fontSize: style.fontSize,
          label: part.getAttribute("aria-label"),
          left: Math.round(bounds.left - origin.left),
          padding: style.paddingLeft,
          role: part.getAttribute("role") ?? part.tagName.toLowerCase(),
          slot: part.dataset.slot ?? null,
          tokenChip: part.matches('dl[aria-label="Usage"] > div'),
          text: part.matches(
            'button, [data-slot="avatar"], [data-slot="badge"], dl[aria-label="Usage"] > div',
          )
            ? (part.textContent ?? "").trim()
            : null,
          width: Math.round(bounds.width),
        };
      });
  });
}

type TurnStructure = Awaited<ReturnType<typeof structure>>;

/**
 * The capture holds every part a turn must render, so a comparison of two captures can never
 * pass by comparing nothing.
 */
function expectTurnStructure(parts: TurnStructure, turnId: string) {
  const has = (description: string, matches: (part: TurnStructure[number]) => boolean) =>
    expect(parts.some(matches), `the turn renders ${description}`).toBe(true);
  expect(parts.length).toBeGreaterThan(0);
  has("its collapsible turn header", (part) => part.text === `Collapse turn ${turnId}`);
  has("its YOU block", (part) => part.author === "user");
  has("its agent block", (part) => part.author === "assistant");
  has("the agent avatar", (part) => part.slot === "avatar" && part.text === "OH");
  has("the model chip", (part) => part.slot === "badge" && part.text === "fixture-model");
  has("its tool-call row", (part) => part.label === "Bash tool details");
  has("its reasoning row", (part) => part.text === "Reasoning");
  has("its agent message", (part) => part.label === "Agent message");
  has("its input token chip", (part) => part.tokenChip && /^Input\d/.test(part.text ?? ""));
  has("its output token chip", (part) => part.tokenChip && /^Output\d/.test(part.text ?? ""));
}

async function highlight(element: Locator) {
  return await element.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      background: style.backgroundColor,
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      primary: getComputedStyle(document.documentElement).getPropertyValue("--primary"),
      token: style.getPropertyValue("--conversation-focus-highlight"),
    };
  });
}

function expectSameColor(actual: Rgba, expected: Rgba) {
  for (const channel of ["red", "green", "blue"] as const)
    expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(1);
}

/** The indicator is drawn in the token's colour; any tint is that colour at 15% or less. */
async function expectHighlightIn(element: Locator, expected: string) {
  const style = await highlight(element);
  const token = parseColor(style.token);
  expectSameColor(token, parseColor(expected));
  expect(style.outlineStyle).toBe("solid");
  expect(style.outlineWidth).toBe("2px");
  expectSameColor(paintedColor(style.outlineColor, "focus indicator"), token);
  const tint = parseColor(style.background);
  if (tint.alpha > 0) {
    expectSameColor(tint, token);
    expect(tint.alpha).toBeLessThanOrEqual(0.15);
  }
  return style;
}

/** Nothing is painted over the element's top edge: the point just inside it hits the element. */
async function expectUncovered(element: Locator) {
  const hitsItself = await element.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return node.contains(document.elementFromPoint(box.left + box.width / 2, box.top + 1));
  });
  expect(hitsItself, "the element's top edge is not painted over").toBe(true);
}

async function expectWithin(element: Locator, container: Locator) {
  await expect
    .poll(async () => {
      const [inner, outer] = await Promise.all([element.boundingBox(), container.boundingBox()]);
      if (!inner || !outer) return false;
      return inner.y >= outer.y - 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;
    })
    .toBe(true);
}

for (const view of ["turn-list", "conversation"] as const) {
  test(`${view} focused on each item kind below the fold shows it in place and highlighted`, async ({
    page,
  }) => {
    const list = await open(page, view, "light");
    await expect(transcriptCurrent(page)).toHaveCount(0);
    const unfocused = new Map<FocusKind, TurnStructure>();
    for (const kind of kinds) {
      const captured = await structure(list.turn(kind));
      expectTurnStructure(captured, focusedTurnIds[kind]);
      unfocused.set(kind, captured);
    }
    for (const kind of kinds) {
      await test.step(`focused on its ${kind}`, async () => {
        const target = handle(list.turn(kind), kind);
        await expect(target).toHaveCount(1);
        await expectBelowFold(target, list.container);
        await list.focusOn(kind);
        const current = await expectCurrent(page, list.turn(kind), kind);
        await expectWithin(current, list.container);
        // The conversation view's own sticky timeline must not cover the item placed below it.
        await expectUncovered(current);
        const focusedStructure = await structure(list.turn(kind));
        expectTurnStructure(focusedStructure, focusedTurnIds[kind]);
        expect(focusedStructure).toEqual(
          unfocused
            .get(kind)
            ?.map((part) =>
              part.eventIndex === String(focusEventIndex[kind]) && part.role !== "button"
                ? { ...part, background: "focus tint" }
                : part,
            ),
        );
        const style = await expectHighlightIn(current, (await highlight(current)).primary);
        expectSameColor(parseColor(style.token), parseColor(style.primary));
      });
    }
  });

  // Its own test, so each journey loads the 200-turn list once and stays inside the per-test timeout.
  test(`${view} focus highlight follows a consumer's token on each item kind`, async ({ page }) => {
    const themed = await open(page, view, "light", consumerHighlight);
    for (const kind of kinds) {
      await test.step(`recoloured by a consumer's token on its ${kind}`, async () => {
        await themed.focusOn(kind);
        await expectHighlightIn(
          await expectCurrent(page, themed.turn(kind), kind),
          consumerHighlight,
        );
      });
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`records each focus highlight's contrast against its card in the ${theme} theme`, async ({
    page,
  }) => {
    const conversation = await open(page, "conversation", theme);
    for (const kind of kinds) {
      await test.step(kind, async () => {
        await conversation.focusOn(kind);
        const current = await expectCurrent(page, conversation.turn(kind), kind);
        await expectWithin(current, conversation.container);
        const style = await expectHighlightIn(current, (await highlight(current)).primary);
        const foreground = paintedColor(style.outlineColor, "focus indicator");
        const background = await backgroundBehind(current);
        await recordReading({
          background,
          browser: test.info().project.name,
          foreground,
          kind,
          part: "focus-highlight",
          ratio: contrastRatio(foreground, background),
          theme,
        });
      });
    }
  });
}

/** One animation frame of the pinned list: its scroll position and the element marked current. */
const frameSchema = z.object({
  marked: z.number().int(),
  scrollTop: z.number().nullable(),
  target: z.string().nullable(),
  time: z.number(),
  top: z.number().nullable(),
});
type Frame = z.infer<typeof frameSchema>;

/**
 * Installed before the page's own scripts: records every animation frame from the document's
 * start, so the first frame painted with a focus is in the record. A marked element is named
 * `<turn id>|<part, tool call id or event index>`, or `<turn id>|turn` for the article itself.
 */
function recordFrames() {
  const frames: unknown[] = [];
  Reflect.set(window, "focusFrames", frames);
  const name = (element: Element) => {
    const turn = element.closest("article")?.getAttribute("data-turn-id") ?? "none";
    const item =
      element.getAttribute("data-turn-part") ??
      element.getAttribute("data-tool-call-id") ??
      element.getAttribute("data-event-index") ??
      "turn";
    return `${turn}|${item}`;
  };
  const step = (time: number) => {
    const list = document.querySelector('[aria-label="Pinned turn list"]');
    const marked = list?.querySelectorAll('[aria-current="true"]') ?? [];
    const element = marked[0];
    frames.push({
      marked: marked.length,
      scrollTop: list?.scrollTop ?? null,
      target: element ? name(element) : null,
      time,
      top: element ? element.getBoundingClientRect().top : null,
    });
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** The frames recorded from `since` on; only those cross from the page. */
async function recordedFrames(page: Page, since: number): Promise<Frame[]> {
  const frames = await page.evaluate((start) => {
    const recorded: unknown = Reflect.get(window, "focusFrames");
    return Array.isArray(recorded) ? recorded.slice(start) : null;
  }, since);
  return z.array(frameSchema).parse(frames);
}

async function frameCount(page: Page): Promise<number> {
  return z
    .number()
    .parse(await page.evaluate(() => Reflect.get(window, "focusFrames")?.length ?? 0));
}

function targetName(name: PinnedFocusName): string {
  const focus: { turnId: string; part?: string; toolCallId?: string; eventIndex?: number } =
    pinnedFocuses[name];
  return `${focus.turnId}|${focus.part ?? focus.toolCallId ?? focus.eventIndex ?? "turn"}`;
}

const pinnedUrl = `${harnessOrigin}/?${new URLSearchParams({ theme: "light", view: "pinned-list" })}`;

async function openPinned(page: Page, name: PinnedFocusName) {
  await page.addInitScript(recordFrames);
  await page.goto(`${pinnedUrl}#${name}`);
  const list = page.getByRole("region", { name: "Pinned turn list", exact: true });
  return { list, pinned: list.getByRole("complementary", { name: "Pinned summary" }) };
}

/** The list's one marked element is `name`'s target, in the turn that focus names. */
async function expectMarked(list: Locator, name: PinnedFocusName): Promise<Locator> {
  const focus = pinnedFocuses[name];
  const marked = list.locator('[aria-current="true"]');
  await expect(marked).toHaveCount(1);
  const turn = list.getByRole("article", { name: `Turn ${focus.turnId} from claude-code` });
  await expect(turn.locator('[aria-current="true"]')).toHaveCount(1);
  const [attribute, value] =
    "part" in focus
      ? ["data-turn-part", focus.part]
      : "toolCallId" in focus
        ? ["data-tool-call-id", focus.toolCallId]
        : ["data-event-index", String(focus.eventIndex)];
  await expect(marked).toHaveAttribute(attribute, value);
  return marked;
}

/** A focused reasoning or tool item is open, by its own trigger. */
async function expectOpen(marked: Locator, name: PinnedFocusName) {
  const focus = pinnedFocuses[name];
  if ("part" in focus || ("eventIndex" in focus && focus.eventIndex === focusEventIndex.message))
    return;
  const trigger = "toolCallId" in focus ? "Bash tool details" : "Reasoning";
  await expect(marked.getByRole("button", { name: trigger })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
}

/** Where the marked element and the pinned summary sit in the list's visible area, unscrolled. */
async function placement(list: Locator) {
  return await list.evaluate((container) => {
    const element = container.querySelector('[aria-current="true"]');
    const sticky = container.querySelector('[aria-label="Pinned summary"]');
    if (!element || !sticky) throw new Error("expected a marked element under a pinned summary");
    const box = element.getBoundingClientRect();
    const visibleTop = container.getBoundingClientRect().top + container.clientTop;
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 1);
    return {
      bottom: box.bottom,
      clientHeight: container.clientHeight,
      scrollTop: container.scrollTop,
      stickyBottom: sticky.getBoundingClientRect().bottom,
      topHitsElement: element.contains(hit),
      top: box.top,
      visibleBottom: visibleTop + container.clientHeight,
      visibleTop,
    };
  });
}

/**
 * The first frame painted with `name` marked already has it where it settles, and its top holds
 * still for the two seconds recorded after it. The scroll position is recorded beside it but may
 * move: content above the item settling (a web font arriving) is absorbed by scrolling.
 */
async function expectPlacedFromFirstFrame(page: Page, name: PinnedFocusName, since: number) {
  await page.waitForTimeout(2_000);
  const frames = await recordedFrames(page, since);
  const first = frames.findIndex((frame) => frame.target === targetName(name));
  expect(first, `a recorded frame shows ${name} marked`).toBeGreaterThanOrEqual(0);
  const settled = frames.slice(first);
  const placed = settled.at(-1);
  if (!placed?.top) throw new Error("expected a placed frame");
  expect(placed.time - (settled[0]?.time ?? placed.time)).toBeGreaterThanOrEqual(1_900);
  for (const [offset, frame] of settled.entries()) {
    const at = `frame ${offset} after ${name} was first painted`;
    expect(frame.target, at).toBe(targetName(name));
    expect(frame.marked, at).toBe(1);
    expect(Math.abs((frame.top ?? Number.NaN) - placed.top), at).toBeLessThanOrEqual(1);
    expect(frame.scrollTop, at).not.toBeNull();
  }
  return placed;
}

const fittingFocuses = ["prompt", "answer", "end", "message", "reasoning", "tool"] as const;

for (const name of fittingFocuses) {
  test(`a list pinned at its top opens on a ${name} focus below the fold wholly in view under the pin`, async ({
    page,
  }) => {
    const { list } = await openPinned(page, name);
    const marked = await expectMarked(list, name);
    await expectOpen(marked, name);
    await expectPlacedFromFirstFrame(page, name, 0);
    const box = await placement(list);
    // The package scrolled many screens down to reach it; the journey scrolled nothing.
    expect(box.scrollTop).toBeGreaterThan(10 * box.clientHeight);
    expect(box.top).toBeGreaterThanOrEqual(box.stickyBottom - 0.5);
    expect(box.top - box.stickyBottom).toBeLessThanOrEqual(1);
    expect(box.top).toBeGreaterThanOrEqual(box.visibleTop);
    expect(box.bottom).toBeLessThanOrEqual(box.visibleBottom + 0.5);
    expect(box.topHitsElement, "nothing is painted over its top edge").toBe(true);
  });
}

for (const name of ["tall-prompt", "tall-reasoning"] as const) {
  test(`a list pinned at its top opens on a ${name} focus with its top at the pin`, async ({
    page,
  }) => {
    const { list } = await openPinned(page, name);
    const marked = await expectMarked(list, name);
    await expectOpen(marked, name);
    await expectPlacedFromFirstFrame(page, name, 0);
    const box = await placement(list);
    expect(Math.abs(box.top - box.stickyBottom)).toBeLessThanOrEqual(1);
    expect(box.bottom).toBeGreaterThan(box.visibleBottom);
    expect(box.topHitsElement, "nothing is painted over its top edge").toBe(true);
  });
}

for (const name of ["collapsed-turn-tool", "collapsed-reasoning"] as const) {
  test(`a mounted list scrolled elsewhere moves its focus to the ${name} item, open and placed from its first frame`, async ({
    page,
  }) => {
    const { list } = await openPinned(page, "tool");
    await expectMarked(list, "tool");
    // The reader collapses the turn the tool focus moves into, then scrolls somewhere else.
    await list.getByRole("button", { name: "Collapse turn turn-60" }).click();
    await expect(list.getByRole("button", { name: "Expand turn turn-60" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await list.hover();
    await page.mouse.wheel(0, 2_000);
    const reasoningTurn = list.getByRole("article", { name: "Turn turn-80 from claude-code" });
    await expect(reasoningTurn.getByRole("button", { name: "Reasoning" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    const since = await frameCount(page);
    // A consumer re-renders with the new focus; the harness takes it from the hash in place.
    await page.goto(`${pinnedUrl}#${name}`);
    const marked = await expectMarked(list, name);
    await expectOpen(marked, name);
    // Focus opens the collapsed turn it moves into; a turn it does not name stays as the reader left it.
    const turn60 = name === "collapsed-turn-tool" ? "Collapse turn turn-60" : "Expand turn turn-60";
    await expect(list.getByRole("button", { name: turn60 })).toHaveAttribute(
      "aria-expanded",
      String(name === "collapsed-turn-tool"),
    );
    const placed = await expectPlacedFromFirstFrame(page, name, since);
    const box = await placement(list);
    expect(Math.abs(box.top - box.stickyBottom)).toBeLessThanOrEqual(1);
    expect(Math.abs((placed.top ?? Number.NaN) - box.top)).toBeLessThanOrEqual(1);
    expect(box.bottom).toBeLessThanOrEqual(box.visibleBottom + 0.5);
    expect(box.topHitsElement, "nothing is painted over its top edge").toBe(true);
  });
}
