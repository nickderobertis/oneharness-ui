import { expect, type Locator, type Page, test } from "@playwright/test";
import { harnessOrigin } from "../harness/configuration.ts";
import {
  backgroundBehind,
  contrastRatio,
  paintedColor,
  parseColor,
  type Rgba,
  recordReading,
} from "./support/contrast.ts";
import { type FocusKind, focusEventIndex, focusedTurnIds } from "./support/fixtures.ts";

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
