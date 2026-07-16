import { readFile } from "node:fs/promises";
import { $, $$, browser, expect } from "@wdio/globals";

async function conversation(name: string) {
  return await $(`aria/Open conversation ${name}`);
}

async function expectExactResume(sessionId: string): Promise<void> {
  const path = process.env.ONEHARNESS_UI_E2E_PROVIDER_ARGV;
  if (!path) throw new Error("native E2E provider argv path was not configured");
  await browser.waitUntil(
    async () => {
      try {
        const args = (await readFile(path, "utf8")).trim().split("\n");
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
  it("loads real history, reveals optional details, continues, and recovers", async () => {
    await expect(browser).toHaveTitle("oneharness");
    await expect($("aria/Conversation history")).toBeDisplayed();
    await expect(await conversation("plain-session")).toBeDisplayed();
    await expect(await conversation("stopped-tool-session")).toBeDisplayed();
    await expect(await conversation("recoverable-failure")).toBeDisplayed();

    await (await conversation("plain-session")).click();
    await expect($("aria/plain-session")).toBeDisplayed();
    await expect($("aria/A concise answer")).toBeDisplayed();
    expect(await $$("aria/Reasoning")).toHaveLength(0);

    await (await conversation("stopped-tool-session")).click();
    await expect($("aria/stopped-tool-session")).toBeDisplayed();
    await expect($("aria/Stopped")).toBeDisplayed();
    const reasoningText = await $("aria/I checked the native command boundary before answering.");
    await expect(reasoningText).not.toBeDisplayed();
    await $("aria/Reasoning").click();
    await expect(reasoningText).toBeDisplayed();
    const toolDetail = await $("aria/Bash tool input and output");
    await expect(toolDetail).not.toBeDisplayed();
    await $("aria/Bash tool details").click();
    await expect(toolDetail).toBeDisplayed();
    expect(await toolDetail.getText()).toContain('"command": "pwd"');

    const before = await browser.getUrl();
    await $("aria/Continue this session").setValue("Continue through the native stack");
    await $("aria/Send reply").click();
    await expect($("aria/Native continuation succeeded")).toBeDisplayed();
    await expect($("aria/Completed")).toBeDisplayed();
    expect(await browser.getUrl()).not.toBe(before);
    await expectExactResume("native-stopped-session");

    await (await conversation("recoverable-failure")).click();
    await expect($("aria/recoverable-failure")).toBeDisplayed();
    await expect($("aria/Failure: rate_limit")).toBeDisplayed();
    await $("aria/Send reply").click();
    await expect($("aria/Write a message first")).toBeDisplayed();
    await $("aria/Continue this session").setValue("Retry through the deterministic provider");
    await $("aria/Send reply").click();
    await expect($("aria/Native continuation succeeded")).toBeDisplayed();
    await expect($("aria/Completed")).toBeDisplayed();
    await expectExactResume("native-failed-session");
  });
});
