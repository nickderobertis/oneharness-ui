import { readFile } from "node:fs/promises";
import { $, $$, browser, expect } from "@wdio/globals";
import { validateProviderArgvPath } from "./capabilities.ts";
import { desktopE2eStageLog, runDesktopStage } from "./stage-log.ts";

const providerArgv = validateProviderArgvPath(process.env.ONEHARNESS_UI_E2E_PROVIDER_ARGV);
const legacyHistoryBytes = Number(process.env.ONEHARNESS_UI_E2E_LEGACY_HISTORY_BYTES);
if (!Number.isSafeInteger(legacyHistoryBytes) || legacyHistoryBytes <= 4 * 1024 * 1024) {
  throw new Error("native oversized history fixture must exceed the legacy 4 MiB bridge response");
}

async function conversation(name: string) {
  return await $(`aria/Open conversation ${name}`);
}

async function expectExactResume(sessionId: string): Promise<void> {
  await browser.waitUntil(
    async () => {
      try {
        const args = (await readFile(providerArgv, "utf8")).split("\0");
        const resume = args.indexOf("--resume");
        return resume >= 0 && args[resume + 1] === sessionId;
      } catch {
        return false;
      }
    },
    { timeout: 10_000, timeoutMsg: `provider did not resume exact session ${sessionId}` },
  );
}

describe("packaged native desktop journey", () => {
  it("pages a legacy-overflow history, opens details, continues, and recovers", async () => {
    await runDesktopStage(desktopE2eStageLog, "journey history load", async () => {
      await expect(browser).toHaveTitle("oneharness");
      const history = await $("aria/Conversation history");
      await expect(history).toBeDisplayed();
      expect(await history.getText()).toMatch(/25 of 33/i);
      await expect(await conversation("stopped-tool-session")).toBeDisplayed();
      await expect(await conversation("recoverable-failure")).toBeDisplayed();
      await expect($("aria/Load more conversations")).toBeDisplayed();
      await expect(await conversation("oversized-session-00")).not.toExist();
      expect(legacyHistoryBytes).toBeGreaterThan(4 * 1024 * 1024);
    });

    await runDesktopStage(desktopE2eStageLog, "journey oversized history pagination", async () => {
      const loadMore = await $("aria/Load more conversations");
      await loadMore.click();
      await expect(await conversation("oversized-session-00")).toBeDisplayed();
      await expect(await conversation("plain-session")).toBeDisplayed();
      expect(await $("aria/Conversation history").getText()).toContain("33");
      await (await conversation("oversized-session-00")).click();
      await expect($("aria/oversized-session-00")).toBeDisplayed();
      await expect($("aria/A concise answer")).toBeDisplayed();
    });

    await runDesktopStage(desktopE2eStageLog, "journey plain session", async () => {
      await (await conversation("plain-session")).click();
      await expect($("aria/plain-session")).toBeDisplayed();
      await expect($("aria/A concise answer")).toBeDisplayed();
      expect(await $$("aria/Reasoning")).toHaveLength(0);
    });

    await runDesktopStage(desktopE2eStageLog, "journey stopped session", async () => {
      await (await conversation("stopped-tool-session")).click();
      await expect($("aria/stopped-tool-session")).toBeDisplayed();
      await expect($("aria/Stopped")).toBeDisplayed();
    });

    await runDesktopStage(desktopE2eStageLog, "journey reasoning disclosure", async () => {
      const reasoningText = await $("aria/I checked the native command boundary before answering.");
      await expect(reasoningText).not.toBeDisplayed();
      await $("aria/Reasoning").click();
      await expect(reasoningText).toBeDisplayed();
    });

    await runDesktopStage(desktopE2eStageLog, "journey tool disclosure", async () => {
      const toolDetail = await $("aria/Bash tool input and output");
      await expect(toolDetail).not.toBeDisplayed();
      await $("aria/Bash tool details").click();
      await expect(toolDetail).toBeDisplayed();
      expect(await toolDetail.getText()).toContain('"command": "pwd"');
    });

    await runDesktopStage(desktopE2eStageLog, "journey stopped session continuation", async () => {
      const before = await browser.getUrl();
      await $("aria/Continue this session").setValue("Continue through the native stack");
      await $("aria/Send reply").click();
      await expect($("aria/Native continuation succeeded")).toBeDisplayed();
      await expect($("aria/Completed")).toBeDisplayed();
      expect(await browser.getUrl()).not.toBe(before);
      await expectExactResume("native-stopped-session");
    });

    await runDesktopStage(desktopE2eStageLog, "journey recoverable failure", async () => {
      await (await conversation("recoverable-failure")).click();
      await expect($("aria/recoverable-failure")).toBeDisplayed();
      await expect($("aria/Failure: rate_limit")).toBeDisplayed();
    });

    await runDesktopStage(desktopE2eStageLog, "journey empty recovery rejection", async () => {
      await $("aria/Send reply").click();
      await expect($("aria/Write a message first")).toBeDisplayed();
    });

    await runDesktopStage(desktopE2eStageLog, "journey failed session recovery", async () => {
      await $("aria/Continue this session").setValue("Retry through the deterministic provider");
      await $("aria/Send reply").click();
      await expect($("aria/Native continuation succeeded")).toBeDisplayed();
      await expect($("aria/Completed")).toBeDisplayed();
      await expectExactResume("native-failed-session");
    });
  });
});
