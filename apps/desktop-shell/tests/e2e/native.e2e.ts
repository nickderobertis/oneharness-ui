import { readFile } from "node:fs/promises";
import { $, $$, browser, expect } from "@wdio/globals";
import { validateProviderArgvPath } from "./capabilities.ts";
import { desktopE2eStageLog, runDesktopStage } from "./stage-log.ts";
import { type ScrollSnapshot, wheelUntilNextPage } from "./wheel-scroll.ts";

const providerArgv = validateProviderArgvPath(process.env.ONEHARNESS_UI_E2E_PROVIDER_ARGV);
const legacyHistoryBytes = Number(process.env.ONEHARNESS_UI_E2E_LEGACY_HISTORY_BYTES);
if (!Number.isSafeInteger(legacyHistoryBytes) || legacyHistoryBytes <= 4 * 1024 * 1024) {
  throw new Error("native oversized history fixture must exceed the legacy 4 MiB bridge response");
}

function expectedIds(name: string): string[] {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the native pagination journey`);
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((item) => typeof item !== "string") ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new Error(`${name} must contain a non-empty JSON array of unique ids`);
  }
  return parsed as string[];
}

const expectedSessionIds = expectedIds("ONEHARNESS_UI_E2E_SESSION_IDS");
const expectedTurnIds = expectedIds("ONEHARNESS_UI_E2E_TURN_IDS");
const firstExpectedTurnId = expectedTurnIds[0];
if (!firstExpectedTurnId) throw new Error("native turn fixture must contain a first turn id");

type ScrollRegion = ReturnType<typeof $>;

const maxWheelInputsPerPage = 20;
const pageAppendTimeout = 20_000;
const paginationPollInterval = 250;
const requiredAutomaticPageBoundaries = 2;
const wheelProgressTimeout = 750;

async function scrollSnapshot(region: ScrollRegion): Promise<ScrollSnapshot> {
  return await browser.execute((element) => {
    const scrollRegion = element as HTMLElement;
    return {
      clientHeight: scrollRegion.clientHeight,
      scrollHeight: scrollRegion.scrollHeight,
      scrollTop: scrollRegion.scrollTop,
    };
  }, region);
}

async function driveWheelUntilNextPage(
  region: ScrollRegion,
  pageStart: ScrollSnapshot,
): Promise<ScrollSnapshot> {
  const result = await wheelUntilNextPage({
    maxWheelInputs: maxWheelInputsPerPage,
    pageAppendTimeout,
    pageStart,
    pause: async (milliseconds) => {
      await browser.pause(milliseconds);
    },
    pollInterval: paginationPollInterval,
    progressTimeout: wheelProgressTimeout,
    readSnapshot: async () => await scrollSnapshot(region),
    wheel: async () => {
      await browser
        .action("wheel")
        .scroll({ deltaY: 100_000, duration: 250, origin: region, x: 0, y: 0 })
        .perform();
    },
  });
  return result.snapshot;
}

async function wheelThroughAutomaticPages(
  region: ScrollRegion,
  firstItem: ScrollRegion,
): Promise<void> {
  const initial = await scrollSnapshot(region);
  const firstItemTop = await firstItem.getLocation("y");
  expect(initial.scrollHeight).toBeGreaterThan(initial.clientHeight);

  let appendedPages = 0;
  for (
    let automaticPages = 0;
    automaticPages < requiredAutomaticPageBoundaries;
    automaticPages += 1
  ) {
    const pageStart = await scrollSnapshot(region);
    const after = await driveWheelUntilNextPage(region, pageStart);
    expect(after.scrollHeight).toBeGreaterThan(pageStart.scrollHeight);
    appendedPages += 1;
  }

  expect(await firstItem.getLocation("y")).toBeLessThan(firstItemTop);
  expect(appendedPages).toBe(requiredAutomaticPageBoundaries);
}

async function expectUniqueAccessibleIds(
  ids: string[],
  accessibleName: (id: string) => string,
): Promise<void> {
  for (const id of ids) {
    expect(await $$(`aria/${accessibleName(id)}`)).toHaveLength(1);
  }
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
      await browser.setWindowSize(900, 560);
      await expect(browser).toHaveTitle("oneharness");
      const history = await $("aria/Conversation history");
      await expect(history).toBeDisplayed();
      await expect($("aria/25 of 58 conversations loaded")).toBeDisplayed();
      await expect(await conversation("stopped-tool-session")).toBeDisplayed();
      await expect(await conversation("recoverable-failure")).toBeDisplayed();
      await expect($("aria/Load more conversations")).toBeDisplayed();
      await expect(await conversation("oversized-session-00")).not.toExist();
      expect(legacyHistoryBytes).toBeGreaterThan(4 * 1024 * 1024);
    });

    await runDesktopStage(desktopE2eStageLog, "journey oversized history pagination", async () => {
      const history = await $("aria/Conversation history");
      const firstConversation = await conversation("stopped-tool-session");
      const allConversations = await $("aria/All 58 conversations loaded");
      await wheelThroughAutomaticPages(history, firstConversation);
      await expect($("aria/58 of 58 conversations loaded")).toBeDisplayed();
      await expect(allConversations).toBeDisplayed();
      await expectUniqueAccessibleIds(expectedSessionIds, (id) => `Session ID ${id}`);
      await expect(await conversation("oversized-session-00")).toBeDisplayed();
      await expect(await conversation("plain-session")).toBeDisplayed();
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
      await expect($("aria/20 of 45 turns loaded")).toBeDisplayed();
    });

    await runDesktopStage(desktopE2eStageLog, "journey turn history pagination", async () => {
      const turns = await $("aria/Conversation turns");
      const firstTurn = await $(`aria/Turn ${firstExpectedTurnId} from claude-code`);
      const allTurns = await $("aria/All 45 turns loaded");
      await wheelThroughAutomaticPages(turns, firstTurn);
      await expect($("aria/45 of 45 turns loaded")).toBeDisplayed();
      await expect(allTurns).toBeDisplayed();
      await expectUniqueAccessibleIds(expectedTurnIds, (id) => `Turn ${id} from claude-code`);
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
