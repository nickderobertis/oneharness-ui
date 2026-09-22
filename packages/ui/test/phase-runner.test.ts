import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PhaseFailure, runPhase } from "./phase-runner.ts";

/**
 * How long a phase that ignores its bound keeps running before finishing on its
 * own. Far longer than any bound below plus its slack, so a phase that ran to
 * completion cannot be mistaken for one that was stopped.
 */
const HANG_MS = 15_000;
/** Slack over a bound for spawning, stopping and draining the phase on a loaded host. */
const STOP_SLACK_MS = 6_000;
/**
 * Bound for the over-bound phases. Comfortably above interpreter startup on a
 * loaded host, so the fixture always writes before it is stopped, and still far
 * below {@link HANG_MS}.
 */
const OVER_BOUND_MS = 2_000;

let workspace = "";
let scripts = { failing: "", passing: "" };

beforeAll(async () => {
  workspace = await mkdtemp(resolve(tmpdir(), "oneharness-ui-phase-runner-"));
  scripts = {
    failing: resolve(workspace, "failing.ts"),
    passing: resolve(workspace, "passing.ts"),
  };
  await Promise.all([
    writeFile(
      scripts.passing,
      `await Bun.write(Bun.stdout, "packed /tmp/oneharness-ui-0.1.0.tgz\\n");
await Bun.write(Bun.stderr, "resolving offline\\n");
`,
    ),
    writeFile(
      scripts.failing,
      `await Bun.write(Bun.stdout, "resolving @oneharness/ui\\n");
await Bun.write(Bun.stderr, "offline install refused: package not cached\\n");
process.exit(3);
`,
    ),
  ]);
});

afterAll(async () => {
  if (workspace) await rm(workspace, { force: true, recursive: true });
});

describe("bounded package-test phases", () => {
  test("returns the output of a phase that finishes inside its bound", async () => {
    const result = await runPhase({
      command: ["bun", scripts.passing],
      cwd: workspace,
      name: "pack",
      timeoutMs: 30_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("packed /tmp/oneharness-ui-0.1.0.tgz");
    expect(result.stderr).toContain("resolving offline");
  });

  test("names the phase and carries its output when the phase exits non-zero", async () => {
    const error = await captureFailure({
      command: ["bun", scripts.failing],
      cwd: workspace,
      name: "offline install",
      timeoutMs: 30_000,
    });
    expect(error.details.phase).toBe("offline install");
    expect(error.details.timedOut).toBe(false);
    expect(error.details.exitCode).toBe(3);
    expect(error.details.stdout).toContain("resolving @oneharness/ui");
    expect(error.details.stderr).toContain("offline install refused: package not cached");
    expect(error.message).toContain("offline install phase exited with code 3");
    expect(error.message).toContain("offline install refused: package not cached");
  });

  test("names the phase when its command cannot be started", async () => {
    const error = await captureFailure({
      command: ["oneharness-ui-command-that-does-not-exist"],
      cwd: workspace,
      name: "consumer verification",
      timeoutMs: 30_000,
    });

    expect(error.details.phase).toBe("consumer verification");
    expect(error.details.timedOut).toBe(false);
    expect(error.details.exitCode).toBeNull();
    expect(error.message).toContain("consumer verification phase could not start");
    expect(error.details.stderr.length).toBeGreaterThan(0);
  });

  test("stops an over-bound phase at its bound and reports what it had written", async () => {
    const hanging = await writeHangingScript("over-bound");
    const startedAt = Date.now();

    const error = await captureFailure({
      command: ["bun", hanging],
      cwd: workspace,
      name: "offline install",
      timeoutMs: OVER_BOUND_MS,
    });
    const elapsed = Date.now() - startedAt;

    expect(error.details.timedOut).toBe(true);
    expect(error.details.phase).toBe("offline install");
    expect(error.message).toContain(`offline install phase timed out after ${OVER_BOUND_MS} ms`);
    expect(error.details.stdout).toContain("install started");
    expect(elapsed).toBeGreaterThanOrEqual(OVER_BOUND_MS);
    expect(elapsed).toBeLessThan(OVER_BOUND_MS + STOP_SLACK_MS);
  }, 60_000);

  test("bounds each phase separately rather than sharing one budget", async () => {
    const bounds: readonly { name: string; timeoutMs: number }[] = [
      { name: "pack", timeoutMs: OVER_BOUND_MS },
      { name: "offline install", timeoutMs: OVER_BOUND_MS * 2 },
    ];
    const timings = [];
    for (const { name, timeoutMs } of bounds) {
      const hanging = await writeHangingScript(`bound-${timeoutMs}`);
      const startedAt = Date.now();
      const error = await captureFailure({
        command: ["bun", hanging],
        cwd: workspace,
        name,
        timeoutMs,
      });
      timings.push({ elapsed: Date.now() - startedAt, error, timeoutMs });
    }

    for (const { elapsed, error, timeoutMs } of timings) {
      expect(error.details.timedOut).toBe(true);
      expect(error.message).toContain(
        `${error.details.phase} phase timed out after ${timeoutMs} ms`,
      );
      expect(elapsed).toBeGreaterThanOrEqual(timeoutMs);
      expect(elapsed).toBeLessThan(timeoutMs + STOP_SLACK_MS);
    }
    expect(timings.map(({ error }) => error.details.phase)).toEqual(["pack", "offline install"]);
  }, 60_000);
});

/**
 * Writes a phase that announces itself and then outlives every bound under test,
 * so a bound that failed to stop it shows up as an elapsed time near
 * {@link HANG_MS} rather than near the bound.
 */
async function writeHangingScript(label: string): Promise<string> {
  const path = resolve(workspace, `${label}.ts`);
  await writeFile(
    path,
    `await Bun.write(Bun.stdout, "install started\\n");
await new Promise((done) => setTimeout(done, ${HANG_MS}));
`,
  );
  return path;
}

async function captureFailure(phase: Parameters<typeof runPhase>[0]): Promise<PhaseFailure> {
  try {
    await runPhase(phase);
  } catch (error) {
    if (error instanceof PhaseFailure) return error;
    throw error;
  }
  throw new Error(`the ${phase.name} phase was expected to fail`);
}
