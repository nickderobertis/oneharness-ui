//! What every test-only oneharness stand-in shares: bounding the argv it is
//! given and forwarding a call to the packaged CLI. Only Node builtins load
//! here. Loading the SDK and zod costs a stand-in several times its own Bun
//! startup, and that CPU time grows on a loaded runner. So a stand-in loads
//! them only on the one call whose output it rewrites, never on a call it
//! only forwards.
import { spawnSync } from "node:child_process";
import { packagedNativeCli } from "../packaged-cli.ts";

// The bridge and SDK pass a short argv of flags, ids, and paths; anything
// larger is not a call a stand-in was written for.
const MAX_ARGS = 64;
const MAX_ARG_LENGTH = 4096;

export function boundedArgv(): string[] {
  const argv = process.argv.slice(2);
  if (argv.length > MAX_ARGS || argv.some((arg) => arg.length < 1 || arg.length > MAX_ARG_LENGTH)) {
    throw new Error(
      `a stand-in takes at most ${MAX_ARGS} non-empty arguments of ${MAX_ARG_LENGTH} characters`,
    );
  }
  return argv;
}

export function runPackagedCli(argv: readonly string[], capture: boolean) {
  // The packaged binary itself, not its Bun launcher: one process less per
  // call, and stopping a stand-in's tree reaches the CLI it started.
  const result = spawnSync(packagedNativeCli(), argv, {
    encoding: "utf8",
    shell: false,
    stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result;
}
