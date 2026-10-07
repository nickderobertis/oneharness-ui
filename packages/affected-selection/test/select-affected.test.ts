import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repository = resolve(import.meta.dir, "../../..");
const selector = "packages/affected-selection/src/select-affected.mjs";

// The selection reads real Nx affected output, so each case commits a change in
// a scratch worktree of HEAD and asks the committed selector about it there.
let scratch = "";
let worktree = "";

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=select-affected test",
      "-c",
      "user.email=select-affected@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=",
      ...args,
    ],
    { cwd, stderr: "pipe", stdout: "pipe" },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} exited ${result.exitCode}: ${result.stderr}; run 'git worktree prune' and check the checkout has its HEAD commit, then rerun`,
    );
  }
  return result.stdout.toString().trim();
}

function select(project: string, base: string) {
  const result = Bun.spawnSync([process.execPath, selector, project], {
    cwd: worktree,
    env: { ...process.env, NX_BASE: base, NX_HEAD: "HEAD" },
    stderr: "pipe",
    stdout: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
}

// Commits one appended line to `path` on top of a clean base and returns that base.
function commitChangeTo(path: string): string {
  git(worktree, ["reset", "--quiet", "--hard", "HEAD"]);
  const base = git(worktree, ["rev-parse", "HEAD"]);
  appendFileSync(resolve(worktree, path), "\n");
  git(worktree, ["commit", "--quiet", "--all", "--message", `test: touch ${path}`]);
  return base;
}

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(resolve(tmpdir(), "oneharness-select-affected-")));
  worktree = resolve(scratch, "tree");
  git(repository, ["worktree", "add", "--quiet", "--detach", worktree, "HEAD"]);
  symlinkSync(resolve(repository, "node_modules"), resolve(worktree, "node_modules"), "junction");
});

afterAll(() => {
  if (worktree) git(repository, ["worktree", "remove", "--force", worktree]);
  if (scratch) rmSync(scratch, { force: true, recursive: true });
});

describe("affected suite selection", () => {
  test("runs the packaged desktop journey only for a change the graph connects to it", () => {
    const reaching = commitChangeTo("apps/desktop-shell/src/runtime.rs");
    expect(select("desktop-shell-e2e", reaching)).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "run=true\n",
    });
    const unrelated = commitChangeTo("docs/visual-testing.md");
    expect(select("desktop-shell-e2e", unrelated).stdout).toBe("run=false\n");
  }, 120_000);

  test("captures visual docs for a rendered file or capture input, not for an unrelated change", () => {
    const rendered = commitChangeTo(
      "apps/conversation-ui/src/features/conversations/components/status-badge.tsx",
    );
    expect(select("conversation-ui-visual", rendered).stdout).toBe("run=true\n");
    const captureInput = commitChangeTo("capture.sh");
    expect(select("conversation-ui-visual", captureInput).stdout).toBe("run=true\n");
    const unrelated = commitChangeTo("apps/desktop-shell-e2e/tests/stage-log.ts");
    expect(select("conversation-ui-visual", unrelated).stdout).toBe("run=false\n");
  }, 120_000);

  test("runs the suite when a push gives no base it can diff from", () => {
    expect(select("desktop-shell-e2e", "0".repeat(40)).stdout).toBe("run=true\n");
    expect(select("desktop-shell-e2e", "f".repeat(40)).stdout).toBe("run=true\n");
  });

  test("rejects a project the workspace does not have rather than skipping its suite", () => {
    const result = select("desktop-shel-e2e", "0".repeat(40));
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("'desktop-shel-e2e' is not an Nx project here");
  });

  test("rejects a base that is not a commit SHA with a remedy", () => {
    const result = select("desktop-shell-e2e", "origin/main");
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("NX_BASE must be a commit SHA");
  });
});
