import {
  conversationLabelMaxLength,
  conversationLabelsMaxCount,
} from "@oneharness-ui/ipc-contract";
import { expect, type Page, test } from "@playwright/test";

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

test("lists, selects, restores a deep link, and expands optional details", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Conversation history" })).toBeVisible();
  await page.getByRole("button", { name: /tool-session/i }).click();
  await expect(page.getByRole("heading", { name: "tool-session" })).toBeFocused();
  await expect(page.getByText("I checked the command boundary first.")).toBeHidden();
  await page.getByText("Reasoning", { exact: true }).click();
  await expect(page.getByText("I checked the command boundary first.")).toBeVisible();
  await page.getByText("Bash", { exact: true }).click();
  await expect(page.getByText(/"command": "pwd"/)).toBeVisible();
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
  const before = page.url();
  await page.getByRole("textbox", { name: "Continue this session" }).fill("Continue with a fix");
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

test("organizes sessions by project and round-trips local labels", async ({ page }) => {
  await page.goto("/");
  const organize = page.getByRole("combobox", { name: "Organize by" });
  await page.getByRole("button", { name: "Refresh conversations" }).hover();
  await expect(page.getByRole("tooltip", { name: "Refresh conversations" })).toBeVisible();
  await organize.click();
  await page.getByRole("option", { name: "Project" }).click();
  await expect(page.getByRole("heading", { name: /oneharness-ui/ })).toBeVisible();

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
  expect(response).toMatchObject({ ok: false });
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
