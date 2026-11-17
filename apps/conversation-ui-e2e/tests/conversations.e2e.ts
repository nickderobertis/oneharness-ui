import { basename } from "node:path";
import { e2eProject } from "@oneharness-ui/bridge/test/e2e-configuration.ts";
import {
  seedE2eHistory,
  seedNarratedE2eSession,
  startInFlightE2eSession,
} from "@oneharness-ui/bridge/test/e2e-history.ts";
import {
  bridgeResponseSchema,
  conversationLabelMaxLength,
  conversationLabelsMaxCount,
} from "@oneharness-ui/ipc-contract";
import { expect, type Page, test } from "@playwright/test";

const e2eProjectHeading = new RegExp(`${basename(e2eProject)}$`);

// Continuing a conversation appends a record to the fixture history, so each
// engine of this target starts from the baseline the server seeded rather than
// from whatever the previous engine left behind.
test.beforeAll(async () => {
  await seedE2eHistory();
});

// WebKit on macOS follows Safari's default of moving Tab focus only between form
// fields; a Safari user reaches buttons with Option+Tab, so the journey presses
// the key that user would.
function focusNextKey(browserName: string): string {
  return browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
}

async function expectTheme(page: Page, selected: string, next: string, resolved: "dark" | "light") {
  await expect(
    page.getByRole("button", { name: `Theme: ${selected}. Switch to ${next}` }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
    .toBe(resolved);
}

test("follows the OS theme and persists an explicit accessible theme choice", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expectTheme(page, "system", "light", "dark");
  await expect(page.getByLabel("oneharness")).toBeVisible();

  const toggle = page.getByRole("button", { name: "Theme: system. Switch to light" });
  await toggle.click();
  await expectTheme(page, "light", "dark", "light");

  await page.reload();
  await expectTheme(page, "light", "dark", "light");

  await page.getByRole("button", { name: "Theme: light. Switch to dark" }).click();
  await expectTheme(page, "dark", "system", "dark");
  await page.reload();
  await expectTheme(page, "dark", "system", "dark");
});

test("lists, selects, restores a deep link, and expands tool details", async ({
  browserName,
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Conversation history" })).toBeVisible();
  await page.getByRole("button", { name: /tool-session/i }).click();
  await expect(page.getByRole("heading", { name: "tool-session" })).toBeFocused();
  const timeline = page.getByRole("region", { name: "Conversation timeline" });
  await expect(timeline).toBeVisible();
  const timelineItems = timeline.getByRole("button", { name: /, (point event|span)$/i });
  await expect(timelineItems).not.toHaveCount(0);
  await expect(timeline.getByRole("list", { name: "Timeline legend" })).toContainText("Turns");
  const timelineItem = timelineItems.first();
  await page.keyboard.press(focusNextKey(browserName));
  const expandTimeline = timeline.getByRole("button", { name: "Expand timeline" });
  await expect(expandTimeline).toBeFocused();
  await expandTimeline.click();
  const toolLaneLabel = timeline
    .getByLabel("Timeline plot. Scroll to zoom or drag to select a range.")
    .getByText("Tools", { exact: true });
  await expect(toolLaneLabel).toHaveCount(1);
  await expect(timeline.getByLabel("Timeline cursor")).toBeVisible();
  const toolActivity = timeline.getByRole("button", { name: "Bash, point event" });
  await toolActivity.click();
  const selectedTurn = page.getByRole("article", { name: /from claude-code/ }).first();
  await expect
    .poll(() => selectedTurn.evaluate((element) => element.getBoundingClientRect().top))
    .toBeLessThan(400);
  await timeline.getByRole("button", { name: "Collapse timeline" }).click();
  await expect(toolLaneLabel).toHaveCount(0);
  await timelineItem.focus();
  await expect(timelineItem).toBeFocused();
  await expect(timeline.getByRole("tooltip")).toBeVisible();
  // The selected conversation follows oneharness's live history stream.
  await expect(page.getByRole("status", { name: "Live updates on" })).toBeVisible();
  await expect(page.getByText('{"command":"pwd"}', { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Bash tool details" }).click();
  await expect(page.getByLabel("Bash tool input")).toContainText('"command": "pwd"');
  await expect(page.getByLabel("Bash tool input").getByText('"command"')).toHaveClass("hljs-attr");
  await expect(page.getByLabel("Bash tool output")).toHaveText("/workspace/product");
  await expect(page.getByText("0", { exact: true })).toBeVisible();

  const deepLink = page.url();
  await page.goto(deepLink);
  await expect(page.getByRole("heading", { name: "tool-session" })).toBeVisible();

  await page.getByRole("button", { name: /plain-session/i }).click();
  await expect(page.getByText("A concise answer")).toBeVisible();
  await expect(page.getByText("Reasoning", { exact: true })).toHaveCount(0);
});

test("renders markdown, highlighted code, and JSON without injecting session HTML", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /markdown-session/i }).click();
  await expect(page.getByText("safely")).toHaveJSProperty("tagName", "STRONG");
  await expect(page.getByText("Highlighted code")).toHaveJSProperty("tagName", "STRONG");
  const keyword = page.getByText("const", { exact: true });
  await expect(keyword).toBeVisible();
  await expect(keyword).toHaveClass(/hljs-keyword/);
  await expect(page.getByRole("main").getByRole("img")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => "injected" in globalThis)).toBe(false);

  await page.getByRole("button", { name: /json-session/i }).click();
  const json = page.getByLabel("Assistant message formatted JSON");
  await expect(json).toBeVisible();
  await expect(json).toContainText('"status": "ready"');
  await expect(json).toContainText('"items": [');
});

test("continues the exact session and selects refreshed history", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /plain-session/i }).click();
  await page.getByRole("button", { name: "Send reply" }).hover();
  await expect(page.getByRole("tooltip", { name: "Send reply" })).toBeVisible();
  const reply = page.getByRole("textbox", { name: "Continue this session" });
  await reply.fill("x".repeat(32_001));
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "at most 32000 characters" }),
  ).toBeVisible();
  await expect(reply).toHaveValue("x".repeat(32_001));

  const before = page.url();
  await reply.fill("Continue with a fix");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Continued from the exact desktop session")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page).not.toHaveURL(before);
  await expect(page.getByRole("main").getByText("Completed", { exact: true })).toBeVisible();
});

test("keeps conversation navigation usable in a phone-sized viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/");
  const history = page.getByRole("navigation", { name: "Conversation history" });
  await expect(history).toBeVisible();
  await page.getByRole("button", { name: /markdown-session/i }).click();
  await expect(history).toBeHidden();
  await expect(page.getByRole("heading", { name: "markdown-session" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Continue this session" })).toBeVisible();
  await page.getByRole("button", { name: "Back to conversations" }).click();
  await expect(history).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("validates label limits, organizes sessions, and round-trips local labels", async ({
  page,
}) => {
  await page.goto("/");
  const organize = page.getByRole("combobox", { name: "Organize by" });
  await page.getByRole("button", { name: "Refresh conversations" }).hover();
  await expect(page.getByRole("tooltip", { name: "Refresh conversations" })).toBeVisible();
  await organize.click();
  await page.getByRole("option", { name: "Project" }).click();
  await expect(page.getByRole("heading", { name: e2eProjectHeading })).toBeVisible();

  await organize.click();
  await page.getByRole("option", { name: "Label" }).click();
  await page.getByRole("button", { name: "Edit labels" }).first().hover();
  await expect(page.getByRole("tooltip", { name: "Edit labels" })).toBeVisible();
  await page.getByRole("button", { name: "Edit labels" }).first().click();
  await page.getByRole("textbox", { name: /Labels for/ }).fill("discard-me");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit labels" }).first().click();
  await page
    .getByRole("textbox", { name: /Labels for/ })
    .fill(
      Array.from({ length: conversationLabelsMaxCount + 1 }, (_, index) => `label-${index}`).join(
        ",",
      ),
    );
  await page.getByRole("button", { name: "Save labels" }).click();
  await expect(page.getByRole("alert")).toContainText("no more than 20 labels");
  await page
    .getByRole("textbox", { name: /Labels for/ })
    .fill("x".repeat(conversationLabelMaxLength + 1));
  await page.getByRole("button", { name: "Save labels" }).click();
  await expect(page.getByRole("alert")).toContainText("at most 64 characters");
  await page.getByRole("textbox", { name: /Labels for/ }).fill("review, urgent");
  await page.getByRole("button", { name: "Save labels" }).click();
  await expect(page.getByRole("heading", { name: "review" })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter label" }).click();
  await page.getByRole("option", { name: "urgent" }).click();
  await expect(page.getByRole("listitem", { name: /Session ID/ })).toHaveCount(1);

  await page.reload();
  await page.getByRole("combobox", { name: "Organize by" }).click();
  await page.getByRole("option", { name: "Label" }).click();
  await expect(page.getByRole("heading", { name: "urgent" })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter label" }).click();
  await page.getByRole("option", { name: "urgent" }).click();
  await page.getByRole("button", { name: "Edit labels" }).click();
  await page.getByRole("textbox", { name: /Labels for/ }).fill("");
  await page.getByRole("button", { name: "Save labels" }).click();
  await expect(page.getByRole("listitem", { name: /Session ID/ })).toHaveCount(0);
});

test("rejects labels for an unknown session at the public bridge boundary", async ({ page }) => {
  await page.goto("/");
  const response = await page.evaluate(async () => {
    const result = await fetch("/invoke", {
      body: JSON.stringify({
        kind: "set-labels",
        labels: ["invalid"],
        sessionId: "missing-session",
      }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return await result.json();
  });
  expect(bridgeResponseSchema.parse(response).ok).toBe(false);
});

test("marks ineligible sessions and recovers from a recorded provider failure", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /ineligible-session/i }).click();
  await expect(page.getByRole("note")).toContainText("can’t be continued");
  await expect(page.getByRole("textbox", { name: "Continue this session" })).toHaveCount(0);

  await page.getByRole("button", { name: /failed-session/i }).click();
  await expect(page.getByText("Failed", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("note", { name: "Failure: rate_limit" })).toBeVisible();
  await page.getByRole("textbox", { name: "Continue this session" }).fill("Retry now");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Continued from the exact desktop session")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Completed", { exact: true }).last()).toBeVisible();
});

test("shows the agent's words, reasoning and tool calls in the order it produced them", async ({
  page,
}) => {
  await seedNarratedE2eSession();
  await page.goto("/");
  await page.getByRole("button", { name: /narrated-session/i }).click();
  await expect(page.getByRole("heading", { name: "narrated-session" })).toBeFocused();

  const turn = page.getByRole("article", { name: /from claude-code/ }).last();
  const activity = turn.getByRole("region", { name: "Agent activity" });
  const messages = activity.getByRole("group", { name: "Agent message" });
  const reasoning = activity.getByRole("button", { name: "Reasoning" });
  // The recorded run wrote text at events 0, 4 and 7, reasoned at 3, and called tools at 1 and
  // 5 (their results at 2 and 6): the card draws exactly that sequence as one stream.
  const stream = [
    messages.nth(0),
    activity.getByRole("button", { name: "Bash tool details" }),
    reasoning,
    messages.nth(1),
    activity.getByRole("button", { name: "Read tool details" }),
    messages.nth(2),
  ];
  await expect(messages).toHaveCount(3);
  await expect(messages.nth(0)).toContainText("I will look at the workspace first.");
  await expect(messages.nth(1)).toContainText("Now I will list what it holds.");
  await expect(messages.nth(2)).toContainText("The workspace holds the product README.");
  for (const [index, item] of stream.slice(1).entries()) {
    const previous = await stream[index]?.elementHandle();
    expect(
      await item.evaluate(
        (node, earlier) =>
          Boolean(
            earlier && earlier.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        previous,
      ),
    ).toBe(true);
  }
  const tops = await Promise.all(
    stream.map(async (item) => (await item.boundingBox())?.y ?? Number.NaN),
  );
  expect(tops.every((top, index) => index === 0 || top > (tops[index - 1] ?? Number.NaN))).toBe(
    true,
  );
  await expect(messages.nth(0).getByText("workspace", { exact: true })).toHaveJSProperty(
    "tagName",
    "STRONG",
  );

  // The reasoning sits in the stream, not in a section of its own above it.
  await expect(turn.getByRole("button", { name: "Reasoning" })).toHaveCount(1);
  await expect(turn.getByRole("region", { name: "Tool calls" })).toHaveCount(0);
  await expect(page.getByText("Check what the directory holds before answering.")).toBeHidden();
  await reasoning.click();
  await expect(
    activity.getByText("Check what the directory holds before answering."),
  ).toBeVisible();

  await activity.getByRole("button", { name: "Bash tool details" }).click();
  await expect(activity.getByLabel("Bash tool output")).toHaveText("/workspace/product");
  await activity.getByRole("button", { name: "Read tool details" }).click();
  await expect(activity.getByLabel("Read tool output")).toHaveText("# Product");
  await expect(turn.getByText("Narrated inspection complete")).toBeVisible();
});

test("shows a session whose run is still going as running, with its events so far", async ({
  page,
}) => {
  const live = await startInFlightE2eSession();
  try {
    await page.goto("/");
    const row = page.getByRole("button", { name: "Open conversation live-session" });
    await expect(async () => {
      await page.getByRole("button", { name: "Refresh conversations" }).click();
      await expect(row).toContainText("Running", { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await row.click();
    await expect(page.getByRole("heading", { name: "live-session" })).toBeFocused();
    const main = page.getByRole("main");
    await expect(main.getByText("Running", { exact: true })).toBeVisible();

    const activity = page.getByRole("region", { name: "Agent activity" });
    await expect(activity.getByRole("group", { name: "Agent message" })).toContainText(
      "Inspecting the workspace now.",
    );
    await activity.getByRole("button", { name: "Reasoning" }).click();
    await expect(activity.getByText("Plan the inspection.")).toBeVisible();
    // The live run reasoned, wrote, then called Bash, and its stream shows them in that order.
    const liveTool = activity.getByRole("button", { name: "Bash tool details" });
    await expect(liveTool).toBeVisible();
    const liveTops = await Promise.all(
      [
        activity.getByRole("button", { name: "Reasoning" }),
        activity.getByRole("group", { name: "Agent message" }),
        liveTool,
      ].map(async (item) => (await item.boundingBox())?.y ?? Number.NaN),
    );
    expect(liveTops).toEqual([...liveTops].sort((first, second) => first - second));
    await expect(page.getByRole("region", { name: "Tool calls" })).toHaveCount(0);
    await expect(
      page.getByText("Still running. Its final answer appears when the run finishes."),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Continue this session" })).toHaveCount(0);

    // When the run closes, the same view settles into the finished turn.
    await live.release();
    await expect(page.getByText("Live inspection finished")).toBeVisible({ timeout: 15_000 });
    await expect(main.getByText("Completed", { exact: true })).toBeVisible();
    await expect(page.getByText("Inspect while I watch")).toBeVisible();
    await expect(activity.getByRole("group", { name: "Agent message" })).toContainText(
      "Inspecting the workspace now.",
    );
    await expect(row).not.toContainText("Running");
  } finally {
    await live.release();
  }
});
