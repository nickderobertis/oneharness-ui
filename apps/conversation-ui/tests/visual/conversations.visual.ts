import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { themeStorageKey, themes } from "../../src/components/theme";

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
  toggles: { theme: string; viewport: string };
}> = [];

async function settle(page: Page, preserveFocus = false) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation:none!important;caret-color:transparent!important;transition:none!important}",
  });
  await page.evaluate(async () => await document.fonts.ready);
  await page.evaluate(async (keepFocus) => {
    if (!keepFocus && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }, preserveFocus);
}

async function capture(
  page: Page,
  name: string,
  viewport: string,
  theme: string,
  preserveFocus = false,
) {
  await settle(page, preserveFocus);
  const image = `${viewport}/${theme}/${name}.png`;
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
    toggles: { theme, viewport },
  });
}

for (const viewport of viewports) {
  for (const theme of themes.filter((candidate) => candidate !== "system")) {
    test.describe(`${viewport.name} ${theme}`, () => {
      test.use({ viewport: { height: viewport.height, width: viewport.width } });
      test.beforeEach(async ({ page }) => {
        await page.addInitScript(
          ({ selectedTheme, storageKey }) => {
            localStorage.setItem(storageKey, selectedTheme);
          },
          { selectedTheme: theme, storageKey: themeStorageKey },
        );
      });

      test("conversation organization", async ({ page }) => {
        await page.goto("/");
        const organize = page.getByRole("combobox", { name: "Organize by" });
        await organize.click();
        await page.getByRole("option", { name: "Project" }).click();
        await expect(page.getByRole("heading", { name: /oneharness-ui/ })).toBeVisible();
        await page.getByRole("button", { name: "Refresh conversations" }).focus();
        await capture(page, "conversation-list-project-focus", viewport.name, theme, true);

        await organize.click();
        await page.getByRole("option", { name: "Label" }).click();
        await page.getByRole("button", { name: "Edit labels" }).first().click();
        await page.getByRole("textbox", { name: /Labels for/ }).fill("review, visual-docs");
        await expect(page.getByRole("dialog")).toBeVisible();
        await capture(page, "conversation-list-label-dialog", viewport.name, theme);
        await page.getByRole("button", { name: "Save labels" }).click();
        await expect(page.getByRole("heading", { name: "review" })).toBeVisible();
      });

      test("rich conversation content", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: /markdown-session/i }).click();
        await expect(page.getByText("Highlighted code")).toBeVisible();
        await capture(page, "conversation-rich-markdown", viewport.name, theme);

        if (viewport.name === "mobile") {
          await page.getByRole("button", { name: "Back to conversations" }).click();
        }
        await page.getByRole("button", { name: /json-session/i }).click();
        await expect(page.getByLabel("Assistant message formatted JSON")).toBeVisible();
        await capture(page, "conversation-formatted-json", viewport.name, theme);
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
        await page.getByRole("textbox", { name: "Continue this session" }).focus();
        await capture(page, "continued-session-reply-focus", viewport.name, theme, true);
      });
    });
  }
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
