import { $, browser, expect } from "@wdio/globals";
import { desktopE2eStageLog, runDesktopStage } from "./stage-log.ts";

describe("installed native desktop startup", () => {
  it("renders the release application through the local sidecar", async () => {
    await runDesktopStage(desktopE2eStageLog, "installed application startup", async () => {
      await expect(browser).toHaveTitle("oneharness");
      await expect($("aria/Conversation history")).toBeDisplayed();
      await expect($("aria/No history yet")).toBeDisplayed();
      await expect($("aria/No recorded sessions yet.")).toBeDisplayed();
    });
  });
});
