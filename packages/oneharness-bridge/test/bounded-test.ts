import { test as bunTest } from "bun:test";
import { stopProcessTree } from "./process-tree.ts";

/// Each test body's time budget: bun's default limit, which this suite has
/// always run under. A body that takes longer fails.
export const TEST_BUDGET_MS = 5_000;

/// How long past the budget bun still waits on a test, so the stop below has
/// time to list, kill and outwait the process tree. When bun's own limit fires
/// it abandons the body and kills only the CLI launcher the body is awaiting:
/// the rejection surfaces as `oneharness exited null` between later tests, the
/// native CLI the launcher started keeps running as an orphan while `afterEach`
/// removes its history, and the abandoned body goes on to call the CLI against
/// the next test's history directory.
const STOP_MS = 10_000;

/// How long an overrun body is given to settle once its processes are gone.
/// One that still has not settled is waiting on something other than a
/// subprocess, and has nothing left running to clean up after.
const SETTLE_AFTER_STOP_MS = 1_000;

export class TestBudgetError extends Error {}

/// Run `body` within `budgetMs`. At the budget, stop every process it started
/// and fail. When it ends in time, stop whatever it left running: a stream the
/// bridge closes without waiting on its watcher, or a discovery call still
/// running when a sibling failure answered the request. Either way, nothing it
/// started is still running when this returns or throws.
export async function runWithinBudget(
  body: () => Promise<void>,
  budgetMs: number = TEST_BUDGET_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = body().then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ error, ok: false as const }),
  );
  const outcome = await Promise.race([
    settled,
    new Promise<"overran">((resolve) => {
      timer = setTimeout(() => resolve("overran"), budgetMs);
    }),
  ]);
  clearTimeout(timer);
  const stopped = await stopProcessTree();
  if (outcome === "overran") {
    await Promise.race([
      settled,
      new Promise((resolve) => setTimeout(resolve, SETTLE_AFTER_STOP_MS)),
    ]);
    // A body that went on to start another process after the stop gets it
    // stopped too, before cleanup can run.
    const late = await stopProcessTree();
    throw new TestBudgetError(
      `test exceeded its ${budgetMs}ms budget; stopped ${stopped + late} process(es) it started`,
    );
  }
  if (!outcome.ok) throw outcome.error;
}

let inFlight = false;

/// A `bun:test` test whose body fails past `TEST_BUDGET_MS` without leaving a
/// process it started running into cleanup or the next test.
export function test(name: string, body: () => Promise<void>): void {
  bunTest(
    name,
    async () => {
      inFlight = true;
      try {
        await runWithinBudget(body);
      } finally {
        inFlight = false;
      }
    },
    TEST_BUDGET_MS + STOP_MS,
  );
}

/// Call first in `afterEach`, and remove what the test used only after it.
/// When bun's own limit abandoned a test before its stop finished, this stops
/// what the test still runs; on Linux that includes every orphan, which this
/// process adopts. The removal waits on the stop, not on any time limit.
export async function stopAbandonedTest(): Promise<void> {
  if (inFlight) await stopProcessTree();
}
