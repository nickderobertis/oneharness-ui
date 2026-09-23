/**
 * Bounded phases for the public-package test.
 *
 * Packing the package, installing it into a fresh consumer and verifying that
 * consumer are slow for unrelated reasons, so one budget shared between them
 * reports host load on any of them as the same opaque whole-test timeout. Each
 * phase here runs under its own bound, is stopped once it exceeds that bound,
 * and fails with its phase name and the output it produced.
 */

/** Grace between the polite stop of an over-bound phase and killing it outright. */
export const TERMINATION_GRACE_MS = 2_000;
/** Bound on draining output a stopped phase left behind in its pipes. */
const OUTPUT_DRAIN_MS = 2_000;
/**
 * Bound on the characters kept per stream. A phase's output is untrusted CLI
 * output of no declared size — a looping install can write without end — and
 * everything kept is held in memory and embedded in the failure message. The
 * most recent output is what says how far a phase got, so the tail is what
 * survives and {@link CAPTURE_DROPPED_PREFIX} reports what did not.
 */
export const MAX_CAPTURED_CHARS = 64 * 1024;
/** Marks output whose head was dropped, so a truncated tail is never read as the whole. */
export const CAPTURE_DROPPED_PREFIX = "[dropped earlier characters:";

export type Phase = {
  /** Argument vector, passed without a shell. */
  readonly command: readonly string[];
  readonly cwd: string;
  readonly name: string;
  readonly timeoutMs: number;
};

export type PhaseResult = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
};

export type PhaseFailureDetails = {
  /** `null` when the phase never started or was stopped before it could exit. */
  readonly exitCode: number | null;
  readonly phase: string;
  readonly stderr: string;
  readonly stdout: string;
  readonly timedOut: boolean;
  readonly timeoutMs: number;
};

export class PhaseFailure extends Error {
  readonly details: PhaseFailureDetails;

  constructor(details: PhaseFailureDetails) {
    super(describeFailure(details));
    this.name = "PhaseFailure";
    this.details = details;
  }
}

/**
 * Runs one phase to completion under its own bound.
 *
 * Resolves with the phase output when it exits cleanly; otherwise throws a
 * {@link PhaseFailure} naming the phase and carrying everything it wrote.
 */
export async function runPhase(phase: Phase): Promise<PhaseResult> {
  const child = spawnPhase(phase);
  const stdout: Sink = { dropped: 0, text: "" };
  const stderr: Sink = { dropped: 0, text: "" };
  const drained = Promise.allSettled([
    collect(child.stdout, stdout),
    collect(child.stderr, stderr),
  ]);
  let timedOut = false;
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const boundTimer = setTimeout(() => {
    timedOut = true;
    child.kill();
    forceKillTimer = setTimeout(() => child.kill("SIGKILL"), TERMINATION_GRACE_MS);
  }, phase.timeoutMs);
  let exitCode: number;
  try {
    exitCode = await child.exited;
  } finally {
    clearTimeout(boundTimer);
    if (forceKillTimer) clearTimeout(forceKillTimer);
  }
  await withDeadline(drained, OUTPUT_DRAIN_MS);
  if (timedOut || exitCode !== 0) {
    throw new PhaseFailure({
      exitCode: timedOut ? null : exitCode,
      phase: phase.name,
      stderr: captured(stderr),
      stdout: captured(stdout),
      timedOut,
      timeoutMs: phase.timeoutMs,
    });
  }
  return { exitCode, stderr: captured(stderr), stdout: captured(stdout) };
}

function spawnPhase(phase: Phase) {
  try {
    return Bun.spawn([...phase.command], {
      cwd: phase.cwd,
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
    });
  } catch (cause) {
    throw new PhaseFailure({
      exitCode: null,
      phase: phase.name,
      stderr: cause instanceof Error ? cause.message : String(cause),
      stdout: "",
      timedOut: false,
      timeoutMs: phase.timeoutMs,
    });
  }
}

/** The tail a phase wrote, plus what was dropped to stay inside {@link MAX_CAPTURED_CHARS}. */
type Sink = { dropped: number; text: string };

/** Accumulates decoded output as it arrives so a stopped phase still reports what it wrote. */
async function collect(stream: ReadableStream<Uint8Array>, sink: Sink): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) append(sink, decoder.decode(chunk, { stream: true }));
  append(sink, decoder.decode());
}

/** Keeps the newest {@link MAX_CAPTURED_CHARS} characters and counts the rest as dropped. */
function append(sink: Sink, text: string): void {
  sink.text += text;
  if (sink.text.length <= MAX_CAPTURED_CHARS) return;
  sink.dropped += sink.text.length - MAX_CAPTURED_CHARS;
  sink.text = sink.text.slice(-MAX_CAPTURED_CHARS);
}

function captured(sink: Sink): string {
  if (sink.dropped === 0) return sink.text;
  return `${CAPTURE_DROPPED_PREFIX} ${sink.dropped}]\n${sink.text}`;
}

async function withDeadline(work: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function describeFailure(details: PhaseFailureDetails): string {
  const reason = details.timedOut
    ? `timed out after ${details.timeoutMs} ms`
    : details.exitCode === null
      ? "could not start"
      : `exited with code ${details.exitCode}`;
  return [
    `${details.phase} phase ${reason}`,
    `${details.phase} stdout:`,
    details.stdout,
    `${details.phase} stderr:`,
    details.stderr,
  ].join("\n");
}
