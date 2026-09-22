import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PhaseFailure, runPhase } from "./phase-runner.ts";

/** How long a phase that ignores its bound keeps running before finishing on its own. */
const HANG_MS = 4_000;
/** Slack over a bound for spawning, stopping and draining the phase on a loaded host. */
const STOP_SLACK_MS = 2_500;

let workspace = "";
let script = { failing: "", hanging: "", passing: "" };

beforeAll(async () => {
  workspace = await mkdtemp(resolve(tmpdir(), "oneharness-ui-phase-runner-"));
  script = {
    failing: resolve(workspace, "failing.ts"),
    hanging: resolve(workspace, "hanging.ts"),
    passing: resolve(workspace, "passing.ts"),
  };
  await Promise.all([
    writeFile(
      script.passing,
      `await Bun.write(Bun.stdout, "packed /tmp/oneharness-ui-0.1.0.tgz\\n");
await Bun.write(Bun.stderr, "resolving offline\\n");
`,
    ),
    writeFile(
      script.failing,
      `await Bun.write(Bun.stdout, "resolving @oneharness/ui\\n");
await Bun.write(Bun.stderr, "offline install refused: package not cached\\n");
process.exit(3);
`,
    ),
    writeFile(
      script.hanging,
      `await Bun.write(Bun.stdout, "install started\\n");
await new Promise((done) => setTimeout(done, ${HANG_MS}));
await Bun.write(Bun.file(process.argv[2]), "finished");
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
      command: ["bun", script.passing],
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
      command: ["bun", script.failing],
      cwd: workspace,
      name: "offline install",
      timeoutMs: 30_000,
    });
    expect(error.phase).toBe("offline install");
    expect(error.timedOut).toBe(false);
    expect(error.exitCode).toBe(3);
    expect(error.stdout).toContain("resolving @oneharness/ui");
    expect(error.stderr).toContain("offline install refused: package not cached");
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

    expect(error.phase).toBe("consumer verification");
    expect(error.timedOut).toBe(false);
    expect(error.exitCode).toBeNull();
    expect(error.message).toContain("consumer verification phase could not start");
    expect(error.stderr.length).toBeGreaterThan(0);
  });

  test("stops an over-bound phase at its bound and reports what it had written", async () => {
    const marker = resolve(workspace, "hanging-finished.txt");
    const startedAt = Date.now();

    const error = await captureFailure({
      command: ["bun", script.hanging, marker],
      cwd: workspace,
      name: "offline install",
      timeoutMs: 500,
    });
    const elapsed = Date.now() - startedAt;

    expect(error.timedOut).toBe(true);
    expect(error.phase).toBe("offline install");
    expect(error.message).toContain("offline install phase timed out after 500 ms");
    expect(error.stdout).toContain("install started");
    expect(elapsed).toBeGreaterThanOrEqual(500);
    expect(elapsed).toBeLessThan(500 + STOP_SLACK_MS);
    await Bun.sleep(HANG_MS);
    expect(await Bun.file(marker).exists()).toBe(false);
  }, 20_000);

  test("bounds each phase separately rather than sharing one budget", async () => {
    const timings = [];
    for (const [name, timeoutMs] of [
      ["pack", 400],
      ["offline install", 1_500],
    ] as const) {
      const startedAt = Date.now();
      const error = await captureFailure({
        command: ["bun", script.hanging, resolve(workspace, `${timeoutMs}.txt`)],
        cwd: workspace,
        name,
        timeoutMs,
      });
      timings.push({ elapsed: Date.now() - startedAt, error, timeoutMs });
    }

    for (const { elapsed, error, timeoutMs } of timings) {
      expect(error.timedOut).toBe(true);
      expect(error.message).toContain(`${error.phase} phase timed out after ${timeoutMs} ms`);
      expect(elapsed).toBeGreaterThanOrEqual(timeoutMs);
      expect(elapsed).toBeLessThan(timeoutMs + STOP_SLACK_MS);
    }
    expect(timings.map(({ error }) => error.phase)).toEqual(["pack", "offline install"]);
  }, 20_000);
});

async function captureFailure(phase: Parameters<typeof runPhase>[0]): Promise<PhaseFailure> {
  try {
    await runPhase(phase);
  } catch (error) {
    if (error instanceof PhaseFailure) return error;
    throw error;
  }
  throw new Error(`the ${phase.name} phase was expected to fail`);
}
