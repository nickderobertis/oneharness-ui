import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  CAPTURE_DROPPED_PREFIX,
  MAX_CAPTURED_CHARS,
  PhaseFailure,
  runPhase,
  TERMINATION_GRACE_MS,
} from "./phase-runner.ts";

/**
 * How long a phase that ignores its bound keeps running before finishing on its
 * own. Far longer than any bound below plus the grace an ignored stop spends and
 * its slack, so a phase that ran to completion cannot be mistaken for one that
 * was stopped.
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

/** Announced first by the flooding fixture, so it is the part the cap must drop. */
const FLOOD_HEAD = "flood head marker";
/** Announced last by the flooding fixture, so it is the part the cap must keep. */
const FLOOD_TAIL = "flood tail marker";
/**
 * Exactly what the flooding fixture writes, so the test asserts the reported
 * dropped count rather than a bound on it. Twice the cap of filler puts both
 * markers well clear of the boundary the cap cuts at.
 */
const FLOOD_OUTPUT = `${FLOOD_HEAD}\n${"x".repeat(MAX_CAPTURED_CHARS * 2)}\n${FLOOD_TAIL}\n`;

let workspace = "";
let scripts = { failing: "", flooding: "", passing: "" };

beforeAll(async () => {
  workspace = await mkdtemp(resolve(tmpdir(), "oneharness-ui-phase-runner-"));
  scripts = {
    failing: resolve(workspace, "failing.ts"),
    flooding: resolve(workspace, "flooding.ts"),
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
    writeFile(
      scripts.flooding,
      `await Bun.write(Bun.stdout, ${JSON.stringify(FLOOD_OUTPUT)});
process.exit(4);
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

  test("keeps the tail of a flooding phase and reports what it dropped", async () => {
    const error = await captureFailure({
      command: ["bun", scripts.flooding],
      cwd: workspace,
      name: "offline install",
      timeoutMs: 30_000,
    });
    const dropped = FLOOD_OUTPUT.length - MAX_CAPTURED_CHARS;

    expect(error.details.exitCode).toBe(4);
    expect(error.details.stdout).toContain(`${CAPTURE_DROPPED_PREFIX} ${dropped}]`);
    expect(error.details.stdout).toContain(FLOOD_TAIL);
    expect(error.details.stdout).not.toContain(FLOOD_HEAD);
    expect(error.details.stdout.length).toBeLessThan(
      MAX_CAPTURED_CHARS + `${CAPTURE_DROPPED_PREFIX} ${dropped}]\n`.length + 1,
    );
    expect(error.message).toContain("offline install phase exited with code 4");
    expect(error.message).toContain(FLOOD_TAIL);
  }, 60_000);

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

  test("kills an over-bound phase that ignores the polite stop", async () => {
    const hanging = await writeHangingScript("ignores-termination", { ignoresTermination: true });
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
    // Outliving the grace is what says the polite stop was refused; finishing
    // inside the slack after it is what says the force kill is what ended it.
    expect(elapsed).toBeGreaterThanOrEqual(OVER_BOUND_MS + TERMINATION_GRACE_MS);
    expect(elapsed).toBeLessThan(OVER_BOUND_MS + TERMINATION_GRACE_MS + STOP_SLACK_MS);
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
 * {@link HANG_MS} rather than near the bound. An installer wedged on a lock is
 * the phase this stands in for, and `ignoresTermination` makes it the kind that
 * survives the polite stop, so only the force kill can end it.
 */
async function writeHangingScript(
  label: string,
  options: { readonly ignoresTermination?: boolean } = {},
): Promise<string> {
  const path = resolve(workspace, `${label}.ts`);
  const refuseStop = options.ignoresTermination ? 'process.on("SIGTERM", () => undefined);\n' : "";
  await writeFile(
    path,
    `${refuseStop}await Bun.write(Bun.stdout, "install started\\n");
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
