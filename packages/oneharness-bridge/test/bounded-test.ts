import { test as bunTest } from "bun:test";

/// Each test's time budget: bun's default limit, which this suite runs under.
export const TEST_BUDGET_MS = 5_000;

/// How long past its budget bun still waits on a test. When bun's own limit
/// fires it abandons the body and SIGTERMs the subprocesses it is waiting on:
/// the rejection surfaces as `oneharness exited null` between later tests, the
/// abandoned body keeps calling the CLI after `afterEach` removed its history,
/// and on Windows the native CLI under a killed launcher keeps running with the
/// history directory open. Within this margin an overrunning body instead runs
/// to its end, so every subprocess it started has been awaited before cleanup.
const SETTLE_MS = 10_000;

/// A `bun:test` test that still fails past `TEST_BUDGET_MS`, but only once its
/// body has settled, never by abandoning subprocesses the body is awaiting.
export function test(name: string, body: () => Promise<void>): void {
  bunTest(
    name,
    async () => {
      const started = performance.now();
      await body();
      const elapsed = Math.round(performance.now() - started);
      if (elapsed > TEST_BUDGET_MS) {
        throw new Error(`test took ${elapsed}ms, over its ${TEST_BUDGET_MS}ms budget`);
      }
    },
    TEST_BUDGET_MS + SETTLE_MS,
  );
}
