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
  await expect(page.getByText("Continued from the exact desktop session")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page).not.toHaveURL(before);
  await expect(page.getByRole("main").getByText("Completed", { exact: true })).toBeVisible();
});

test("organizes sessions by project and round-trips local labels", async ({ page }) => {
  await page.goto("/");
  const organize = page.getByRole("combobox", { name: "Organize by" });
  await organize.selectOption("project");
  await expect(page.getByRole("heading", { name: /oneharness-ui/ })).toBeVisible();

  await organize.selectOption("label");
  await page.getByRole("button", { name: "Edit labels" }).first().click();
  await page.getByRole("textbox", { name: /Labels for/ }).fill("review, urgent");
  await page.getByRole("button", { name: "Save labels" }).click();
  await expect(page.getByRole("heading", { name: "review" })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter label" }).selectOption("urgent");
  await expect(page.getByRole("listitem", { name: /Session ID/ })).toHaveCount(1);

  await page.reload();
  await page.getByRole("combobox", { name: "Organize by" }).selectOption("label");
  await expect(page.getByRole("heading", { name: "urgent" })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter label" }).selectOption("urgent");
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
