import { readFile } from "node:fs/promises";
import { $, $$, browser, expect } from "@wdio/globals";

async function conversation(name: string) {
  return await $(
    `//nav[@aria-label='Conversation history']//button[.//strong[normalize-space()='${name}']]`,
  );
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
    await expect($("nav[aria-label='Conversation history']")).toBeDisplayed();
    await expect(await conversation("plain-session")).toBeDisplayed();
    await expect(await conversation("stopped-tool-session")).toBeDisplayed();
    await expect(await conversation("recoverable-failure")).toBeDisplayed();

    await (await conversation("plain-session")).click();
    await expect($("//main//h1[normalize-space()='plain-session']")).toBeDisplayed();
    await expect($("//main//*[normalize-space()='A concise answer']")).toBeDisplayed();
    expect(await $$("//main//summary[normalize-space()='Reasoning']")).toHaveLength(0);

    await (await conversation("stopped-tool-session")).click();
    await expect($("//main//h1[normalize-space()='stopped-tool-session']")).toBeDisplayed();
    await expect($("//main//*[normalize-space()='Stopped']")).toBeDisplayed();
    const reasoning = await $("//main//details[summary[normalize-space()='Reasoning']]");
    expect(await reasoning.getAttribute("open")).toBeNull();
    await reasoning.$("summary").click();
    await expect(
      $("//main//*[normalize-space()='I checked the native command boundary before answering.']"),
    ).toBeDisplayed();
    const tool = await $("//main//details[summary//*[normalize-space()='Bash']]");
    expect(await tool.getAttribute("open")).toBeNull();
    await tool.$("summary").click();
    expect(await tool.$("pre").getText()).toContain('"command": "pwd"');

    const before = await browser.getUrl();
    await $("#reply").setValue("Continue through the native stack");
    await $("button[aria-label='Send reply']").click();
    await expect($("//main//*[normalize-space()='Native continuation succeeded']")).toBeDisplayed();
    await expect($("//main//*[normalize-space()='Completed']")).toBeDisplayed();
    expect(await browser.getUrl()).not.toBe(before);
    await expectExactResume("native-stopped-session");

    await (await conversation("recoverable-failure")).click();
    await expect($("//main//h1[normalize-space()='recoverable-failure']")).toBeDisplayed();
    await expect($("//main//*[normalize-space()='Failure: rate_limit']")).toBeDisplayed();
    await $("button[aria-label='Send reply']").click();
    await expect(
      $("//*[@role='alert' and normalize-space()='Write a message first']"),
    ).toBeDisplayed();
    await $("#reply").setValue("Retry through the deterministic provider");
    await $("button[aria-label='Send reply']").click();
    await expect($("//main//*[normalize-space()='Native continuation succeeded']")).toBeDisplayed();
    await expect($("//main//*[normalize-space()='Completed']")).toBeDisplayed();
    await expectExactResume("native-failed-session");
  });
});
