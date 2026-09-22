import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repository = resolve(import.meta.dir, "../../..");
const project = "apps/desktop-shell-e2e";

async function nx(args: string[]): Promise<string> {
  const child = Bun.spawn(["bunx", "nx", ...args], {
    cwd: repository,
    env: { ...process.env, NX_DAEMON: "false", NX_TUI: "false" },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0) throw new Error(`nx ${args.join(" ")} exited ${exitCode}: ${stderr.trim()}`);
  return stdout;
}

function captured(source: string, pattern: RegExp, description: string): string {
  const value = source.match(pattern)?.[1];
  if (value === undefined) throw new Error(`the native journey no longer names ${description}`);
  return value;
}

describe("native desktop journey project graph", () => {
  test("resolves the relocated target on its desktop build edge", async () => {
    const scratch = await mkdtemp(resolve(tmpdir(), "oneharness-ui-project-graph-"));
    try {
      const graphFile = resolve(scratch, "graph.json");
      await nx(["graph", "--file", graphFile]);
      const { graph } = JSON.parse(await readFile(graphFile, "utf8"));

      expect(Object.keys(graph.nodes)).toContain("desktop-shell-e2e");
      expect(graph.nodes["desktop-shell-e2e"].data.root).toBe(project);
      expect(
        graph.dependencies["desktop-shell-e2e"].map(
          (dependency: { target: string }) => dependency.target,
        ),
      ).toContain("desktop-shell");

      const journey = JSON.parse(await nx(["show", "project", "desktop-shell-e2e", "--json"]))
        .targets["desktop-e2e"];
      expect(journey.dependsOn).toContain("desktop-shell:build");
      expect(
        JSON.parse(await nx(["show", "project", "desktop-shell", "--json"])).targets.build,
      ).toBeDefined();

      // The target names its entrypoint, the entrypoint names the WebdriverIO
      // runner, and the runner names the journey specs. Every hop has to reach
      // a file the move left in this project, or the target cannot run.
      const entrypoint = captured(
        journey.options.command,
        /(scripts\/[\w.-]+\.mjs)/,
        "its run-desktop-e2e entrypoint",
      );
      expect(entrypoint).toBe("scripts/run-desktop-e2e.mjs");
      expect(existsSync(resolve(repository, entrypoint))).toBe(true);

      const runner = await readFile(resolve(repository, entrypoint), "utf8");
      expect(runner).toContain('"--cwd", "apps/desktop-shell-e2e", "test:e2e"');

      const manifest = await readFile(resolve(repository, project, "package.json"), "utf8");
      const configuration = captured(
        JSON.parse(manifest).scripts["test:e2e"],
        /([\w.-]+\.conf\.ts)/,
        "its WebdriverIO configuration",
      );
      const wdio = await readFile(resolve(repository, project, configuration), "utf8");
      const specs = [...wdio.matchAll(/"\.\/(tests\/[\w.-]+\.e2e\.ts)"/g)].flatMap((match) =>
        match[1] === undefined ? [] : [match[1]],
      );
      expect(specs).toEqual(["tests/native-startup.e2e.ts", "tests/native.e2e.ts"]);
      for (const spec of specs) {
        expect(existsSync(resolve(repository, project, spec))).toBe(true);
      }
    } finally {
      await rm(scratch, { force: true, recursive: true });
    }
  }, 180_000);
});
