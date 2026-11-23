import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { posix, resolve } from "node:path";
import { z } from "zod";

// Cargo owns the workspace `target/`: Nx restoring a cache entry that claims any
// part of it rewrites Cargo's fingerprints and deletes the bootstrapped test
// provider under `target/oneharness-ui-test`. These checks read the graph Nx
// itself resolves, so a target inheriting an output from `targetDefaults`
// counts as well as one declaring it.
const repository = resolve(import.meta.dir, "../../..");

const targetSchema = z.object({
  outputs: z.array(z.string()).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});
const graphSchema = z.object({
  graph: z.object({
    nodes: z.record(
      z.string(),
      z.object({
        data: z.object({ root: z.string(), targets: z.record(z.string(), targetSchema) }),
      }),
    ),
  }),
});
const nxJsonSchema = z.object({
  targetDefaults: z.record(z.string(), z.object({ outputs: z.array(z.string()).optional() })),
});

type Graph = z.infer<typeof graphSchema>;

function resolvedGraph(cwd: string): Graph {
  const nx = Bun.spawnSync([process.execPath, "x", "nx", "graph", "--file=stdout"], {
    cwd,
    env: { ...process.env, NX_DAEMON: "false", NX_TUI: "false" },
    stderr: "pipe",
    stdout: "pipe",
  });
  if (nx.exitCode !== 0) {
    throw new Error(
      `nx graph exited ${nx.exitCode}: ${nx.stderr.toString().slice(-4000)}; run 'just install-workspace' and fix the project definition it names, then rerun`,
    );
  }
  return graphSchema.parse(JSON.parse(nx.stdout.toString()));
}

// Interpolates the tokens Nx expands in an output path and reports whether the
// result is the workspace `target/` or anything below it. A negated glob
// excludes paths rather than claiming them.
function claimsCargoTarget(output: string, projectRoot: string, options: Record<string, unknown>) {
  if (output.startsWith("!")) return false;
  const expanded = output
    .replaceAll("{workspaceRoot}", "")
    .replaceAll("{projectRoot}", projectRoot)
    .replaceAll("{projectName}", "")
    .replace(/\{options\.([A-Za-z0-9_]+)\}/g, (_, key: string) => String(options[key] ?? ""));
  const path = posix.normalize(expanded.replace(/^\/+/, ""));
  return path === "target" || path.startsWith("target/") || /^target[*?[{]/.test(path);
}

function cargoTargetClaims(cwd: string): string[] {
  const graph = resolvedGraph(cwd);
  const claims: string[] = [];
  for (const [name, node] of Object.entries(graph.graph.nodes)) {
    for (const [targetName, target] of Object.entries(node.data.targets)) {
      for (const output of target.outputs ?? []) {
        if (claimsCargoTarget(output, node.data.root, target.options ?? {})) {
          claims.push(`${name}:${targetName} ${output}`);
        }
      }
    }
  }
  // A default no current target inherits still reaches the next project that
  // omits its own outputs, so each one is checked against every project root.
  const nxJson = nxJsonSchema.parse(JSON.parse(readFileSync(resolve(cwd, "nx.json"), "utf8")));
  const roots = Object.values(graph.graph.nodes).map((node) => node.data.root);
  for (const [key, defaults] of Object.entries(nxJson.targetDefaults)) {
    for (const output of defaults.outputs ?? []) {
      if (roots.some((root) => claimsCargoTarget(output, root, {}))) {
        claims.push(`targetDefaults.${key} ${output}`);
      }
    }
  }
  return claims.sort();
}

describe("Nx cache outputs", () => {
  test("no target declares or inherits an output in the Cargo target directory", () => {
    expect(cargoTargetClaims(repository)).toEqual([]);
  }, 60_000);

  test("the ipc-contract build, which emits nothing, caches no outputs", () => {
    const build = resolvedGraph(repository).graph.nodes["ipc-contract"]?.data.targets.build;
    expect(build?.outputs).toEqual([]);
  }, 60_000);

  describe("in a scratch copy of the workspace", () => {
    let scratch = "";
    let worktree = "";

    function git(args: string[]) {
      const result = Bun.spawnSync(["git", "-c", "core.hooksPath=", ...args], {
        cwd: repository,
        stderr: "pipe",
      });
      if (result.exitCode !== 0) {
        throw new Error(
          `git ${args.join(" ")} exited ${result.exitCode}: ${result.stderr}; run 'git worktree prune', then rerun`,
        );
      }
    }

    // Starts each case from this checkout's graph definition, uncommitted edits
    // included, then applies the case's edit to the copy.
    function withEdit(path: string, edit: (json: Record<string, unknown>) => void) {
      for (const file of ["nx.json", "packages/ipc-contract/project.json", path]) {
        writeFileSync(resolve(worktree, file), readFileSync(resolve(repository, file)));
      }
      const json = JSON.parse(readFileSync(resolve(worktree, path), "utf8"));
      edit(json);
      writeFileSync(resolve(worktree, path), JSON.stringify(json));
    }

    beforeAll(() => {
      scratch = realpathSync(mkdtempSync(resolve(tmpdir(), "oneharness-cache-outputs-")));
      worktree = resolve(scratch, "tree");
      git(["worktree", "add", "--quiet", "--detach", worktree, "HEAD"]);
      symlinkSync(
        resolve(repository, "node_modules"),
        resolve(worktree, "node_modules"),
        "junction",
      );
    });

    afterAll(() => {
      if (worktree) git(["worktree", "remove", "--force", worktree]);
      if (scratch) rmSync(scratch, { force: true, recursive: true });
    });

    test("reports the Cargo target directory put back on the build default", () => {
      withEdit("nx.json", (json) => {
        const defaults = json.targetDefaults as { build: { outputs: string[] } };
        defaults.build.outputs.push("{workspaceRoot}/target");
      });
      expect(cargoTargetClaims(worktree)).toEqual(["targetDefaults.build {workspaceRoot}/target"]);
    }, 60_000);

    test("reports a project target claiming a path under the Cargo target directory", () => {
      withEdit("apps/desktop-shell/project.json", (json) => {
        const targets = json.targets as { build: { outputs: string[] } };
        targets.build.outputs = ["{projectRoot}/../../target/debug"];
      });
      expect(cargoTargetClaims(worktree)).toEqual([
        "desktop-shell:build {projectRoot}/../../target/debug",
      ]);
    }, 60_000);
  });
});
