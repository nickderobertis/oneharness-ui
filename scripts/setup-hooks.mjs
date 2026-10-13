import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

// Older workspace installs generated a Lefthook pre-push dispatcher. There are
// no remaining hooks to install; retire only that repository-local dispatcher.
const git = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
  encoding: "utf8",
});
try {
  if (git.status !== 0) {
    // Package installation also supports source archives outside a Git clone.
    if (!git.error && /^fatal: not a git repository\b/.test(git.stderr)) process.exit(0);
    throw git.error ?? new Error(git.stderr.trim() || `git exited with status ${git.status}`);
  }
  const directory = git.stdout.trim();
  if (
    !directory ||
    /[\r\n]/.test(directory) ||
    !isAbsolute(directory) ||
    !statSync(directory).isDirectory()
  ) {
    throw new Error("Git did not return one absolute repository directory");
  }
  const hook = resolve(directory, "hooks/pre-push");
  try {
    // Do not follow a symlink into a shared hook directory.
    if (lstatSync(hook).isFile()) {
      const content = readFileSync(hook, "utf8");
      if (
        content.includes("call_lefthook()") &&
        content.includes('call_lefthook run "pre-push" "$@"')
      ) {
        unlinkSync(hook);
      }
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
} catch (error) {
  console.error(
    `hook setup: ${error instanceof Error ? error.message : "unexpected failure"}; check Git availability and repository hook permissions and rerun bun run prepare`,
  );
  process.exitCode = 1;
}
