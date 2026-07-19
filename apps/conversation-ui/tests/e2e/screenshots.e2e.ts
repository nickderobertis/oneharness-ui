import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Conversation history" })).toBeVisible();
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        caret-color: transparent !important;
        transition: none !important;
      }
    `,
  });
});

test("conversation organization", async ({ page }) => {
  const organize = page.getByRole("combobox", { name: "Organize by" });
  await organize.click();
  await page.getByRole("option", { name: "Project" }).click();
  await expect(page.getByRole("heading", { name: /oneharness-ui/ })).toBeVisible();
  await expect(page).toHaveScreenshot("conversation-list-project.png");

  await organize.click();
  await page.getByRole("option", { name: "Label" }).click();
  await expect(page.getByRole("heading", { name: "Unlabeled" })).toBeVisible();
  await expect(page).toHaveScreenshot("conversation-list-label.png");
});

test("rich markdown, highlighted code, and formatted JSON", async ({ page }) => {
  await page.getByRole("button", { name: /markdown-session/i }).click();
  await expect(page.getByText("const", { exact: true })).toHaveClass(/hljs-keyword/);
  await expect(page).toHaveScreenshot("conversation-rich-markdown.png");

  if (await page.getByRole("button", { name: "Back to conversations" }).isVisible()) {
    await page.getByRole("button", { name: "Back to conversations" }).click();
  }
  await page.getByRole("button", { name: /json-session/i }).click();
  await expect(page.getByLabel("Assistant message formatted JSON")).toContainText(
    '"status": "ready"',
  );
  await expect(page).toHaveScreenshot("conversation-formatted-json.png");
});

test("reply and continued session", async ({ page }) => {
  await page
    .getByRole("button", { name: /plain-session/i })
    .last()
    .click();
  await page.getByRole("textbox", { name: "Continue this session" }).fill("Continue with a fix");
  await expect(page).toHaveScreenshot("conversation-reply.png");

  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Continued from the exact desktop session")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page).toHaveScreenshot("conversation-continued.png");
});
