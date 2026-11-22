import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runWithinBudget, TestBudgetError } from "./bounded-test.ts";
import { type HeldRun, startHeldRun } from "./history-fixture.ts";
import { liveDescendantIds } from "./process-tree.ts";

const repository = resolve(import.meta.dir, "../../..");
const provider =
  process.env.ONEHARNESS_UI_TEST_PROVIDER_BIN ??
  resolve(
    repository,
    `target/oneharness-ui-test/oneharness-mock-harness${process.platform === "win32" ? ".exe" : ""}`,
  );
const cli = process.env.ONEHARNESS_UI_TEST_CLI_BIN;

let historyDir = "";

beforeEach(async () => {
  historyDir = await mkdtemp(resolve(tmpdir(), "oneharness-ui-bounded-"));
});

afterEach(async () => {
  await rm(historyDir, { force: true, recursive: true });
});

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until<T>(read: () => Promise<T | undefined>): Promise<T> {
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("a test body held to its time budget", () => {
  test("stops the launcher, native CLI and provider of a run that never ends", async () => {
    let live: HeldRun | undefined;
    let started: number[] = [];
    // The provider holds until released, and this body never releases it: a
    // run that would outlast any test limit unless something stops it.
    const overrun = runWithinBudget(async () => {
      live = await startHeldRun(
        {
          bins: { "claude-code": provider },
          env: { ONEHARNESS_HISTORY_LABELS: "{}" },
          harnesses: ["claude-code"],
          history: true,
          historyDir,
          historyName: "never-released",
          mode: "bypass",
          prompt: "Hold until stopped",
        },
        { after: [], before: [], ...(cli ? { executable: cli } : {}) },
      );
      // The SDK's launcher, the native CLI it starts, and the provider.
      started = await until(async () => {
        const ids = await liveDescendantIds();
        return ids.length >= (cli ? 2 : 3) ? ids : undefined;
      });
      await new Promise(() => {});
    }, 2_000);

    await expect(overrun).rejects.toBeInstanceOf(TestBudgetError);
    await expect(overrun).rejects.toThrow(/exceeded its 2000ms budget; stopped [1-9]\d* process/);
    expect(started.filter(running)).toEqual([]);
    expect(await liveDescendantIds()).toEqual([]);
    // The stopped run cannot finish; releasing it only removes its hold files.
    await live?.release().catch(() => {});
  });

  test("passes a body that finishes in time and stops what it left running", async () => {
    let leftBehind = 0;
    const finished = runWithinBudget(async () => {
      const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], {
        stdio: "ignore",
        windowsHide: true,
      });
      leftBehind = child.pid ?? 0;
    }, 2_000);
    await expect(finished).resolves.toBeUndefined();
    expect(leftBehind).toBeGreaterThan(0);
    expect(running(leftBehind)).toBe(false);
  });

  test("reports a failing body's own error after stopping what it started", async () => {
    const failing = runWithinBudget(async () => {
      spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], {
        stdio: "ignore",
        windowsHide: true,
      });
      throw new Error("assertion failed in the body");
    }, 2_000);
    await expect(failing).rejects.toThrow("assertion failed in the body");
    expect(await liveDescendantIds()).toEqual([]);
  });
});
