import { mock } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import * as childProcess from "node:child_process";

/// How long a stop gives each captured process to end on SIGTERM before it
/// kills it. The native CLI stops its provider on SIGTERM; the provider runs in
/// a process group of its own, so this is the only signal that reaches it.
const TERM_GRACE_MS = 2_000;
/// How long a stop waits for the processes it killed to be gone before it
/// reports the ones that are not.
const STOP_WAIT_MS = 10_000;
const POLL_MS = 25;

/// A launch refused because the test body that made it was already stopped.
export class LaunchCancelledError extends Error {}

/// The subprocesses one test body launched, each captured by PID as it was
/// spawned. On POSIX each starts a process group of its own, so one signal to
/// that captured id also reaches what it started in that group, such as the
/// native CLI a stand-in runs. The CLI starts its provider in a group of its
/// own, and stops it itself when sent SIGTERM. Nothing else is ever signalled.
export class ProcessOwner {
  readonly #pids = new Set<number>();
  #cancelled = false;

  get cancelled(): boolean {
    return this.#cancelled;
  }

  /// The captured ids, in launch order.
  get pids(): number[] {
    return [...this.#pids];
  }

  /// Refuse every later launch. A body that resumes after this cannot start
  /// another process; its call fails with `LaunchCancelledError` instead.
  cancel(): void {
    this.#cancelled = true;
  }

  adopt(pid: number): void {
    this.#pids.add(pid);
  }

  /// Kill every captured process with whatever it started, and wait until none
  /// of them is left. Returns how many captured launches were still running.
  async stop(): Promise<number> {
    const live = this.pids.filter(running);
    if (process.platform === "win32") {
      await Promise.all(live.map(killWindowsTree));
    } else {
      for (const pid of live) signalGroup(pid, "SIGTERM");
      const ended = await this.#gone(TERM_GRACE_MS);
      if (!ended) for (const pid of this.pids.filter(running)) signalGroup(pid, "SIGKILL");
    }
    if (!(await this.#gone(STOP_WAIT_MS))) {
      const remaining = this.pids.filter(running);
      throw new Error(`processes ${remaining.join(", ")} survived a kill for ${STOP_WAIT_MS}ms`);
    }
    return live.length;
  }

  async #gone(withinMs: number): Promise<boolean> {
    const deadline = Date.now() + withinMs;
    while (this.pids.some(running)) {
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    return true;
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false; // ESRCH: every process in the group has exited.
  }
}

/// Whether a captured launch, or on POSIX anything left in its group, still
/// runs. A captured id is a group id that the kernel does not hand out again
/// while any member of that group is alive.
function running(pid: number): boolean {
  if (process.platform !== "win32") return signalGroup(pid, 0);
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/// Windows has no process groups: `taskkill /T` kills the captured process and
/// the processes it started, found from that captured id.
async function killWindowsTree(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const killer = originalSpawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => resolve());
    killer.once("close", () => resolve());
  });
}

const scope = new AsyncLocalStorage<ProcessOwner>();
const originalSpawn = childProcess.spawn;

/// Run `body` as `owner`'s: every subprocess it launches, however deep in the
/// SDK or the bridge the call is made, is captured by `owner` at launch.
export function runOwned<T>(owner: ProcessOwner, body: () => Promise<T>): Promise<T> {
  return scope.run(owner, body);
}

/// The owner of the body this call runs in, if any.
export function currentOwner(): ProcessOwner | undefined {
  return scope.getStore();
}

type SpawnArgs = Parameters<typeof childProcess.spawn>;

function ownedSpawn(...args: SpawnArgs): childProcess.ChildProcess {
  const owner = scope.getStore();
  if (!owner) return originalSpawn(...args);
  if (owner.cancelled) {
    throw new LaunchCancelledError(
      `refused to launch ${String(args[0])}: its test body was already stopped`,
    );
  }
  // `spawn(command, options)` has no argument list; every caller here passes one.
  const [command, argv, options] = args as [string, readonly string[], childProcess.SpawnOptions];
  const child = originalSpawn(command, argv, {
    ...options,
    // A group of its own, led by the captured id (see `ProcessOwner`).
    ...(process.platform === "win32" ? {} : { detached: true }),
  });
  if (child.pid !== undefined) owner.adopt(child.pid);
  return child;
}

// llmlint: ignore[e2e_not_mocked] Not a substitute: every call still reaches the real `spawn` with its own command, arguments and options, so the SDK, bridge, CLI and provider run for real. The wrapper only records the PID of a launch a budgeted test body makes, so the budget can stop exactly the processes that body started, and refuses a launch from a body already stopped.
mock.module("node:child_process", () => ({ ...childProcess, spawn: ownedSpawn }));
