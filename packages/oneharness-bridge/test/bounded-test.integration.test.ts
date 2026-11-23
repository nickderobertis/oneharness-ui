import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { OneHarness } from "@oneharness/sdk";
import { runWithinBudget, TestBudgetError } from "./bounded-test.ts";
import { type HeldRun, startHeldRun } from "./history-fixture.ts";
import { currentOwner, LaunchCancelledError } from "./owned-processes.ts";
import { packagedNativeCli } from "./packaged-cli.ts";

const repository = resolve(import.meta.dir, "../../..");
const provider =
  process.env.ONEHARNESS_UI_TEST_PROVIDER_BIN ??
  resolve(
    repository,
    `target/oneharness-ui-test/oneharness-mock-harness${process.platform === "win32" ? ".exe" : ""}`,
  );
const cli = process.env.ONEHARNESS_UI_TEST_CLI_BIN ?? packagedNativeCli();
// A stand-in that forwards `run` to the packaged native CLI it starts itself,
// so the CLI is a process this test process never launched.
const standIn = resolve(
  import.meta.dir,
  `fixtures/text-default-cli.${process.platform === "win32" ? "cmd" : "ts"}`,
);

// A body here overruns a short budget on purpose; stopping it may then take a
// SIGTERM grace and a kill wait (see owned-processes.ts), more than bun's
// default 5000ms allows for the whole test.
const OVERRUN_TEST_MS = 15_000;

let historyDir = "";

beforeEach(async () => {
  historyDir = await mkdtemp(resolve(tmpdir(), "oneharness-ui-bounded-"));
});

afterEach(async () => {
  await rm(historyDir, { force: true, recursive: true });
});

/// `pid` and the processes it started, as far as they are still running; on
/// Windows, `pid` alone. This only observes: `ps` runs through `Bun.spawnSync`,
/// outside any owner, and nothing here signals.
function liveTree(pid: number): number[] {
  if (process.platform === "win32") {
    try {
      process.kill(pid, 0);
      return [pid];
    } catch {
      return [];
    }
  }
  const listed = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid=,stat="], { stdout: "pipe" });
  const rows = listed.stdout
    .toString()
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([, , stat]) => stat && !stat.startsWith("Z"))
    .map(([child, parent]) => ({ child: Number(child), parent: Number(parent) }));
  const tree = rows.some(({ child }) => child === pid) ? [pid] : [];
  for (let index = 0; index < tree.length; index += 1) {
    tree.push(...rows.filter(({ parent }) => parent === tree[index]).map(({ child }) => child));
  }
  return tree;
}

async function until<T>(read: () => T | undefined): Promise<T> {
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function sleepingChild(): number {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  return child.pid ?? 0;
}

describe("a test body held to its time budget", () => {
  for (const [through, executable, depth] of [
    ["the native CLI", cli, 2],
    ["a stand-in", standIn, 3],
  ] as const) {
    test(
      `stops a run that never ends, launched through ${through}, with all it started`,
      async () => {
        let live: HeldRun | undefined;
        let captured: number[] = [];
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
              historyName: `never-released-${depth}`,
              mode: "bypass",
              prompt: "Hold until stopped",
            },
            { after: [], before: [], executable },
          );
          captured = currentOwner()?.pids ?? [];
          // The process the SDK launched and, on POSIX, what it started in turn:
          // the provider, and through a stand-in the native CLI before it. Only the
          // first was captured.
          started = await until(() => {
            const tree = captured.flatMap(liveTree);
            return tree.length >= (process.platform === "win32" ? 1 : depth) ? tree : undefined;
          });
          await live.finished;
        }, 2_000);

        await expect(overrun).rejects.toBeInstanceOf(TestBudgetError);
        await expect(overrun).rejects.toThrow(/exceeded its 2000ms budget; stopped 1 process/);
        expect(captured).toHaveLength(1);
        expect(started.length).toBeGreaterThan(0);
        expect(started.flatMap(liveTree)).toEqual([]);
        // The stopped run cannot finish; releasing it only removes its hold files.
        await live?.release().catch(() => {});
      },
      OVERRUN_TEST_MS,
    );
  }

  test(
    "refuses a CLI call from a body that resumes after its budget, and waits for it",
    async () => {
      let lateCall: unknown = "not attempted";
      let settled = false;
      const overrun = runWithinBudget(async () => {
        // Blocked on a timer rather than a process, so stopping processes alone
        // cannot end it: it wakes well after the budget and tries the CLI again.
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        try {
          await new OneHarness({ executable: cli }).historyList({ allProjects: true, historyDir });
          lateCall = "ran";
        } catch (error) {
          lateCall = error;
        }
        settled = true;
      }, 500);

      await expect(overrun).rejects.toBeInstanceOf(TestBudgetError);
      // Nothing the body does can reach cleanup: it has finished, and its late
      // call never started a process.
      expect(settled).toBe(true);
      expect(lateCall).toBeInstanceOf(LaunchCancelledError);

      // The refusal belongs to the stopped body alone: the next one launches.
      let listed: unknown;
      await runWithinBudget(async () => {
        listed = await new OneHarness({ executable: cli }).historyList({
          allProjects: true,
          historyDir,
        });
      }, 5_000);
      expect(listed).toEqual([]);
    },
    OVERRUN_TEST_MS,
  );

  test("passes a body that finishes in time and stops what it left running", async () => {
    let leftBehind = 0;
    const finished = runWithinBudget(async () => {
      leftBehind = sleepingChild();
    }, 2_000);
    await expect(finished).resolves.toBeUndefined();
    expect(leftBehind).toBeGreaterThan(0);
    expect(liveTree(leftBehind)).toEqual([]);
  });

  test("reports a failing body's own error after stopping what it started", async () => {
    let started = 0;
    const failing = runWithinBudget(async () => {
      started = sleepingChild();
      throw new Error("assertion failed in the body");
    }, 2_000);
    await expect(failing).rejects.toThrow("assertion failed in the body");
    expect(started).toBeGreaterThan(0);
    expect(liveTree(started)).toEqual([]);
  });
});
