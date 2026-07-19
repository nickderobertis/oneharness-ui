import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

const shotsOut = (() => {
  const candidate = process.env.SHOTS_OUT;
  if (
    !candidate ||
    !path.isAbsolute(candidate) ||
    (!candidate.endsWith("/shots/current/x86_64") && !candidate.endsWith("/shots/verify/x86_64"))
  ) {
    throw new Error("SHOTS_OUT must be an absolute screencomp x86_64 capture directory");
  }
  return candidate;
})();
const viewports = [
  { height: 800, name: "desktop", width: 1280 },
  { height: 800, name: "mobile", width: 390 },
] as const;
const shots: Array<{
  hash: string;
  image: string;
  name: string;
  toggles: { viewport: string };
}> = [];

async function settle(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation:none!important;caret-color:transparent!important;transition:none!important}",
  });
  await page.evaluate(async () => await document.fonts.ready);
  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

async function capture(page: Page, name: string, viewport: string) {
  await settle(page);
  const image = `${viewport}/${name}.png`;
  const destination = path.join(shotsOut, image);
  mkdirSync(path.dirname(destination), { recursive: true });
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: destination,
  });
  shots.push({
    hash: createHash("sha256").update(readFileSync(destination)).digest("hex"),
    image,
    name,
    toggles: { viewport },
  });
}

for (const viewport of viewports) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { height: viewport.height, width: viewport.width } });

    test("conversation organization", async ({ page }) => {
      await page.goto("/");
      const organize = page.getByRole("combobox", { name: "Organize by" });
      await organize.click();
      await page.getByRole("option", { name: "Project" }).click();
      await expect(page.getByRole("heading", { name: /oneharness-ui/ })).toBeVisible();
      await capture(page, "conversation-list-project", viewport.name);

      await organize.click();
      await page.getByRole("option", { name: "Label" }).click();
      await page.getByRole("button", { name: "Edit labels" }).first().click();
      await page.getByRole("textbox", { name: /Labels for/ }).fill("review, visual-docs");
      await page.getByRole("button", { name: "Save labels" }).click();
      await expect(page.getByRole("heading", { name: "review" })).toBeVisible();
      await capture(page, "conversation-list-labels", viewport.name);
    });

    test("rich conversation content", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: /markdown-session/i }).click();
      await expect(page.getByText("Highlighted code")).toBeVisible();
      await capture(page, "conversation-rich-markdown", viewport.name);

      if (viewport.name === "mobile") {
        await page.getByRole("button", { name: "Back to conversations" }).click();
      }
      await page.getByRole("button", { name: /json-session/i }).click();
      await expect(page.getByLabel("Assistant message formatted JSON")).toBeVisible();
      await capture(page, "conversation-formatted-json", viewport.name);
    });

    test("continued session", async ({ page }) => {
      await page.goto("/");
      await page
        .getByRole("button", { name: /plain-session/i })
        .first()
        .click();
      await page
        .getByRole("textbox", { name: "Continue this session" })
        .fill("Continue with a fix");
      await page.getByRole("button", { name: "Send reply" }).click();
      await expect(page.getByText("Continued from the exact desktop session")).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Continue this session" })).toHaveValue("");
      await capture(page, "continued-session", viewport.name);
    });
  });
}

test.afterAll(() => {
  shots.sort((left, right) =>
    `${left.name} ${left.toggles.viewport}`.localeCompare(
      `${right.name} ${right.toggles.viewport}`,
    ),
  );
  mkdirSync(shotsOut, { recursive: true });
  writeFileSync(
    path.join(shotsOut, "captures.json"),
    `${JSON.stringify({ schema: 1, shots }, null, 2)}\n`,
  );
});
