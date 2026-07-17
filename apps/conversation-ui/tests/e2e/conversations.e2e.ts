import { expect, test } from "@playwright/test";

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

test("continues the exact session and selects refreshed history", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /plain-session/i }).click();
  const before = page.url();
  await page.getByRole("textbox", { name: "Continue this session" }).fill("Continue with a fix");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Continued from the exact desktop session")).toBeVisible();
  await expect(page).not.toHaveURL(before);
  await expect(page.getByRole("main").getByText("Completed", { exact: true })).toBeVisible();
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
  await expect(page.getByText("Continued from the exact desktop session")).toBeVisible();
  await expect(page.getByText("Completed", { exact: true }).last()).toBeVisible();
});
