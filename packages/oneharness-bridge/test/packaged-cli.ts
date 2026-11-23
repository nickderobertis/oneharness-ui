import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/// The native CLI the pinned SDK's `oneharness-cli` package ships for this
/// platform, which the desktop app bundles beside its sidecar. The package's
/// `oneharness` command is a Bun launcher that runs this binary as its own
/// child and does not forward termination to it: killing the launcher leaves
/// the native CLI running with no parent this process can find. Calling the
/// binary directly makes every process a test starts one it can stop.
export function packagedNativeCli(): string {
  const sdkRequire = createRequire(import.meta.resolve("@oneharness/sdk"));
  const cliRequire = createRequire(sdkRequire.resolve("oneharness-cli/package.json"));
  const manifest = cliRequire.resolve(
    `@oneharness/cli-${process.platform}-${process.arch}/package.json`,
  );
  const binary = join(
    dirname(manifest),
    "bin",
    `oneharness${process.platform === "win32" ? ".exe" : ""}`,
  );
  if (!existsSync(binary)) throw new Error(`the packaged oneharness CLI is missing: ${binary}`);
  return binary;
}
