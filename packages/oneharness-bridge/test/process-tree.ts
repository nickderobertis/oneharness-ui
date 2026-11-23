import { dlopen, FFIType } from "bun:ffi";
import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

type ProcessEntry = { pid: number; ppid: number; live: boolean };
type ProcessTable = { entries: ProcessEntry[]; enumerator: number };

const ENUMERATION_LIMIT_BYTES = 16 * 1024 * 1024;
const PR_SET_CHILD_SUBREAPER = 36;

// On Linux this process adopts every orphan among its descendants, so a native
// CLI whose launcher or parent was killed (by this module, the SDK, or bun's
// own per-test limit) stays in this process's tree, where a stop can reach it.
if (process.platform === "linux") {
  const libc = dlopen("libc.so.6", {
    prctl: {
      args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64],
      returns: FFIType.i32,
    },
  });
  if (libc.symbols.prctl(PR_SET_CHILD_SUBREAPER, 1n, 0n, 0n, 0n) !== 0) {
    throw new Error("the test process could not become a subreaper for its descendants");
  }
}

/// Linux reads `/proc` in this process: listing must not depend on starting a
/// process, which is the very thing a starved runner is slow at.
function procTable(): ProcessTable {
  const entries = readdirSync("/proc").flatMap((name) => {
    if (!/^\d+$/.test(name)) return [];
    let stat: string;
    try {
      stat = readFileSync(`/proc/${name}/stat`, "utf8");
    } catch {
      return []; // It exited after the directory was read.
    }
    // `pid (comm) state ppid ...`, where comm may itself hold spaces or ')'.
    const [state, ppid] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (!state || !ppid) return [];
    return [{ live: state !== "Z" && state !== "X", pid: Number(name), ppid: Number(ppid) }];
  });
  return { entries, enumerator: 0 };
}

/// Elsewhere one listing subprocess, passed as an argument array.
async function listedTable(): Promise<ProcessTable> {
  const [command, args] =
    process.platform === "win32"
      ? [
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} R' -f $_.ProcessId, $_.ParentProcessId }",
          ],
        ]
      : ["ps", ["-A", "-o", "pid=", "-o", "ppid=", "-o", "stat="]];
  let enumerator = 0;
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { maxBuffer: ENUMERATION_LIMIT_BYTES, windowsHide: true },
      (error, output) => (error ? reject(error) : resolve(output)),
    );
    enumerator = child.pid ?? 0;
  });
  const entries = stdout.split(/\r?\n/).flatMap((line) => {
    const [pid, ppid, state] = line.trim().split(/\s+/);
    if (!pid || !ppid || !state) return [];
    return [{ live: !state.startsWith("Z"), pid: Number(pid), ppid: Number(ppid) }];
  });
  return { entries, enumerator };
}

/// Every process on the host. `live` is false for a POSIX zombie, which has
/// exited and only waits for its parent to reap it.
async function processTable(): Promise<ProcessTable> {
  return process.platform === "linux" ? procTable() : await listedTable();
}

/// Live processes descended from this test process, or from any process seen
/// in an earlier round: a Windows child keeps its dead parent's id, so a child
/// whose launcher was already stopped is still found through that id.
function descendants(
  { entries, enumerator }: ProcessTable,
  seen: ReadonlySet<number>,
): ProcessEntry[] {
  const roots = new Set([process.pid, ...seen]);
  const found = new Map<number, ProcessEntry>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of entries) {
      // The listing process is never added, so its own helpers (a console host
      // on Windows) are never reached either.
      if (entry.pid === enumerator || entry.pid === process.pid || found.has(entry.pid)) continue;
      if (roots.has(entry.ppid) || found.has(entry.ppid)) {
        found.set(entry.pid, entry);
        grew = true;
      }
    }
  }
  return [...found.values()].filter((entry) => entry.live);
}

/// The ids of the live processes this test process started, directly or not.
export async function liveDescendantIds(): Promise<number[]> {
  return descendants(await processTable(), new Set()).map(({ pid }) => pid);
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    // It exited between the listing and the signal.
  }
}

/// Stop every process this test process started, directly or through a
/// launcher, and wait until none is left running. On POSIX each one is frozen
/// first, so a launcher cannot start a child between the listing and the kill,
/// and a child already started stays under its frozen parent until the whole
/// tree is listed; only then is everything killed. Returns how many it stopped.
export async function stopProcessTree(): Promise<number> {
  const seen = new Set<number>();
  let killed = false;
  for (;;) {
    const live = descendants(await processTable(), seen);
    if (live.length === 0) return seen.size;
    const fresh = live.filter(({ pid }) => !seen.has(pid));
    for (const { pid } of fresh) {
      seen.add(pid);
      if (process.platform !== "win32") signal(pid, "SIGSTOP");
    }
    if (fresh.length === 0 || process.platform === "win32" || killed) {
      for (const { pid } of live) signal(pid, "SIGKILL");
      killed = true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
