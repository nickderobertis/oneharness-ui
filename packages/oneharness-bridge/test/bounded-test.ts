import { test as bunTest } from "bun:test";
import { ProcessOwner, runOwned } from "./owned-processes.ts";

/// Each test body's time budget: bun's default limit, which this suite has
/// always run under. A body that takes longer fails.
export const TEST_BUDGET_MS = 5_000;

/// How long past the budget bun still waits on a test, so the stop below has
/// time to kill the body's processes and the body time to settle. When bun's
/// own limit fires it abandons the body and kills only the CLI launcher the
/// body is awaiting: the rejection surfaces as `oneharness exited null` between
/// later tests, the native CLI the launcher started keeps running while
/// `afterEach` removes its history, and the abandoned body goes on to call the
/// CLI against the next test's history directory.
const STOP_MS = 10_000;

export class TestBudgetError extends Error {}

type Running = { owner: ProcessOwner; settled: Promise<unknown> };

/// Run `body` within `budgetMs`. At the budget, refuse its further launches,
/// stop every process it started, wait for it to settle, and fail. When it ends
/// in time, do the same to whatever it left running: a stream the bridge closes
/// without waiting on its watcher, or a discovery call still running when a
/// sibling failure answered the request. Either way, when this returns or
/// throws the body has finished and nothing it started is still running.
export async function runWithinBudget(
  body: () => Promise<void>,
  budgetMs: number = TEST_BUDGET_MS,
  onStart: (running: Running) => void = () => {},
): Promise<void> {
  const owner = new ProcessOwner();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = runOwned(owner, body).then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ error, ok: false as const }),
  );
  onStart({ owner, settled });
  const outcome = await Promise.race([
    settled,
    new Promise<"overran">((resolve) => {
      timer = setTimeout(() => resolve("overran"), budgetMs);
    }),
  ]);
  clearTimeout(timer);
  const stopped = await settle({ owner, settled });
  if (outcome === "overran") {
    throw new TestBudgetError(
      `test exceeded its ${budgetMs}ms budget; stopped ${stopped} process(es) it started`,
    );
  }
  if (!outcome.ok) throw outcome.error;
}

/// Refuse the body's later launches, stop what it started, and wait for it to
/// finish. Once no launch can succeed and every process it awaited is gone, a
/// body still waiting can only be waiting on its own timers; bun's per-test
/// limit, `TEST_BUDGET_MS + STOP_MS`, bounds that wait.
async function settle({ owner, settled }: Running): Promise<number> {
  owner.cancel();
  // `spawn` captures each PID synchronously, so after the cancel nothing can be
  // added to what this stops.
  const stopped = await owner.stop();
  await settled;
  return stopped;
}

let inFlight: Running | undefined;

/// A `bun:test` test whose body fails past `TEST_BUDGET_MS` without leaving a
/// process it started, or the body itself, running into cleanup or the next test.
export function test(name: string, body: () => Promise<void>): void {
  bunTest(
    name,
    async () => {
      try {
        await runWithinBudget(body, TEST_BUDGET_MS, (running) => {
          inFlight = running;
        });
      } finally {
        inFlight = undefined;
      }
    },
    TEST_BUDGET_MS + STOP_MS,
  );
}

/// Call first in `afterEach`, and remove what the test used only after it.
/// When bun's own limit abandoned a test before its stop finished, this refuses
/// the body's further launches, stops what it started, and waits for the body
/// to finish. The removal waits on that, not on any time limit.
export async function stopAbandonedTest(): Promise<void> {
  const running = inFlight;
  inFlight = undefined;
  if (running) await settle(running);
}
