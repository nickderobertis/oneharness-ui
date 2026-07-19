import { expect, type Locator, test } from "@playwright/test";

async function expectInsidePhoneWidth(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
}

test("keeps list, detail, and reply controls usable at phone width", async ({ page }) => {
  await page.goto("/");
  const history = page.getByRole("navigation", { name: "Conversation history" });
  await expect(history).toBeVisible();
  await expect(page.getByRole("main")).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.body.scrollWidth)).toBe(390);

  await page.getByRole("button", { name: /markdown-session/i }).click();
  await expect(history).toBeHidden();
  await expect(page.getByRole("heading", { name: "markdown-session" })).toBeFocused();
  const back = page.getByRole("button", { name: "Back to conversations" });
  const reply = page.getByRole("textbox", { name: "Continue this session" });
  const send = page.getByRole("button", { name: "Send reply" });
  await expect(back).toBeVisible();
  await expect(reply).toBeVisible();
  await expect(send).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.scrollWidth)).toBe(390);
  await expectInsidePhoneWidth(back);
  await expectInsidePhoneWidth(reply);
  await expectInsidePhoneWidth(send);

  await page.getByRole("button", { name: "Back to conversations" }).click();
  await expect(history).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("continues a session without losing the mobile layout", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /plain-session/i })
    .last()
    .click();
  await page.getByRole("textbox", { name: "Continue this session" }).fill("Continue on mobile");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Continued from the exact desktop session")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "Back to conversations" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.scrollWidth)).toBe(390);
  await expectInsidePhoneWidth(page.getByRole("button", { name: "Send reply" }));
});
