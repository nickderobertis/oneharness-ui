import { expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const lefthook = resolve(root, "node_modules/lefthook/bin/index.js");
// The removed configuration is input to the real installed Lefthook manager.
const oldConfig = `pre-push:
  parallel: false
  commands:
    gate:
      run: just gate
    llmlint-config:
      run: if command -v llmlint >/dev/null 2>&1; then just lint-llm-validate; fi
`;

function run(cwd: string, args: string[], env: Record<string, string | undefined> = {}) {
  const result = Bun.spawnSync(args, { cwd, env: { ...process.env, ...env } });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return result;
}

function fixture() {
  const scratch = process.env.ONEPIPELINE_NODE_SCRATCH_DIR ?? tmpdir();
  if (!scratch || !isAbsolute(scratch) || !statSync(scratch).isDirectory()) {
    throw new Error("hook fixture scratch must be an existing absolute directory");
  }
  const directory = mkdtempSync(resolve(scratch, "hook-journey-"));
  const clone = resolve(directory, "clone");
  mkdirSync(clone);
  run(clone, ["git", "init", "-b", "main"]);
  run(clone, ["git", "config", "user.email", "hooks@example.invalid"]);
  run(clone, ["git", "config", "user.name", "Hook journey"]);
  mkdirSync(resolve(clone, "scripts"));
  copyFileSync(resolve(root, "scripts/setup-hooks.mjs"), resolve(clone, "scripts/setup-hooks.mjs"));
  // Use the real workspace lifecycle command, including on setup reruns.
  const manifest: unknown = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  if (
    !isRecord(manifest) ||
    !isRecord(manifest.scripts) ||
    typeof manifest.scripts.prepare !== "string" ||
    !manifest.scripts.prepare.trim() ||
    !Object.values(manifest.scripts).every((command) => typeof command === "string")
  ) {
    throw new Error("workspace package must declare string scripts and a nonempty prepare command");
  }
  writeFileSync(resolve(clone, "package.json"), JSON.stringify({ scripts: manifest.scripts }));
  return { directory, clone };
}

function installOldHook(clone: string) {
  expect(oldConfig).toContain("just gate");
  writeFileSync(resolve(clone, "lefthook.yml"), oldConfig);
  run(clone, ["bun", lefthook, "install"]);
  const hook = resolve(clone, ".git/hooks/pre-push");
  expect(readFileSync(hook, "utf8")).toContain('call_lefthook run "pre-push"');
  rmSync(resolve(clone, "lefthook.yml"));
  return hook;
}

// The real Git hook boundary proves that no dispatcher (and therefore no gate,
// llmlint validation or capture child process) runs during ordinary pushes.
test("workspace setup retires the installed dispatcher across real local pushes and reruns", () => {
  const { directory, clone } = fixture();
  try {
    const remote = resolve(directory, "remote.git");
    run(directory, ["git", "init", "--bare", remote]);
    run(clone, ["git", "remote", "add", "origin", remote]);
    const hook = installOldHook(clone);
    const artifacts = new Map([
      [
        "shots/baseline/x86_64.json",
        readFileSync(resolve(root, "shots/baseline/x86_64.json"), "utf8"),
      ],
      ["shots/review/index.html", "<html><body>Existing review gallery</body></html>"],
    ]);
    mkdirSync(resolve(clone, "shots/baseline"), { recursive: true });
    mkdirSync(resolve(clone, "shots/review"), { recursive: true });
    for (const [artifact, content] of artifacts) writeFileSync(resolve(clone, artifact), content);
    run(clone, ["git", "add", "."]);
    run(clone, ["git", "commit", "-m", "feat: first fixture commit"]);
    run(clone, ["bun", "run", "prepare"]);
    expect(existsSync(hook)).toBe(false);

    function push() {
      const pushed = run(clone, ["git", "push", "origin", "main"], { GIT_TRACE: "1" });
      const trace = pushed.stderr.toString();
      expect(trace).not.toContain("pre-push");
      expect(trace).not.toMatch(/just gate|lint-llm-validate|capture|lefthook/);
      expect(run(remote, ["git", "rev-parse", "refs/heads/main"]).stdout.toString()).toBe(
        run(clone, ["git", "rev-parse", "HEAD"]).stdout.toString(),
      );
      for (const [artifact, content] of artifacts) {
        expect(readFileSync(resolve(clone, artifact), "utf8")).toBe(content);
      }
      expect(run(clone, ["git", "status", "--porcelain"]).stdout.toString()).toBe("");
    }

    push();
    mkdirSync(resolve(clone, "apps/conversation-ui/src"), { recursive: true });
    writeFileSync(
      resolve(clone, "apps/conversation-ui/src/changed.ts"),
      "export const changed = true;\n",
    );
    run(clone, ["git", "add", "."]);
    run(clone, ["git", "commit", "-m", "fix: change guarded tooling path"]);
    push();
    push();
    // An existing clone may still carry a generated obsolete hook at setup time.
    installOldHook(clone);
    run(clone, ["bun", "run", "prepare"]);
    run(clone, ["bun", "run", "prepare"]);
    expect(existsSync(hook)).toBe(false);
    push();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("setup preserves custom hooks and shared hooksPath, including symlinks", () => {
  const { directory, clone } = fixture();
  try {
    const localHook = resolve(clone, ".git/hooks/pre-push");
    const custom = "#!/bin/sh\nexit 0\n";
    writeFileSync(localHook, custom);
    chmodSync(localHook, 0o755);
    const precommit = resolve(clone, ".git/hooks/pre-commit");
    writeFileSync(precommit, custom);
    run(clone, ["bun", "run", "prepare"]);
    expect(readFileSync(localHook, "utf8")).toBe(custom);
    expect(readFileSync(precommit, "utf8")).toBe(custom);

    const shared = resolve(directory, "shared-hooks");
    mkdirSync(shared);
    const generated = readFileSync(installOldHook(clone), "utf8");
    const sharedHook = resolve(shared, "pre-push");
    writeFileSync(sharedHook, generated);
    run(clone, ["git", "config", "core.hooksPath", shared]);
    run(clone, ["bun", "run", "prepare"]);
    expect(existsSync(localHook)).toBe(false);
    expect(readFileSync(sharedHook, "utf8")).toBe(generated);
    expect(run(clone, ["git", "config", "--get", "core.hooksPath"]).stdout.toString().trim()).toBe(
      shared,
    );
    expect(readFileSync(precommit, "utf8")).toBe(custom);
    symlinkSync(sharedHook, localHook);
    run(clone, ["bun", "run", "prepare"]);
    expect(readFileSync(localHook, "utf8")).toBe(generated);
    expect(readFileSync(sharedHook, "utf8")).toBe(generated);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "setup reports an unreadable obsolete hook and recovers after permissions are repaired",
  () => {
    const { directory, clone } = fixture();
    const hook = installOldHook(clone);
    try {
      chmodSync(hook, 0o000);
      const failed = Bun.spawnSync(["bun", "run", "prepare"], { cwd: clone });
      expect(failed.exitCode).toBe(1);
      expect(failed.stderr.toString()).toContain(
        "check Git availability and repository hook permissions and rerun bun run prepare",
      );
      expect(existsSync(hook)).toBe(true);
      chmodSync(hook, 0o755);
      run(clone, ["bun", "run", "prepare"]);
      expect(existsSync(hook)).toBe(false);
    } finally {
      if (existsSync(hook)) chmodSync(hook, 0o755);
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("setup supports source archives and reports invalid Git metadata before recovery", () => {
  const { directory, clone } = fixture();
  try {
    const archive = resolve(directory, "archive");
    mkdirSync(archive);
    run(archive, ["node", resolve(root, "scripts/setup-hooks.mjs")], {
      GIT_CEILING_DIRECTORIES: directory,
    });
    const metadata = resolve(clone, ".git");
    const saved = resolve(directory, "saved-git");
    renameSync(metadata, saved);
    writeFileSync(metadata, "invalid git metadata\n");
    const failed = Bun.spawnSync(["bun", "run", "prepare"], { cwd: clone });
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr.toString()).toContain("invalid gitfile format");
    expect(failed.stderr.toString()).toContain("check Git availability");
    rmSync(metadata);
    renameSync(saved, metadata);
    run(clone, ["bun", "run", "prepare"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
