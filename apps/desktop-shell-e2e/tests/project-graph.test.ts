import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";

const repository = resolve(import.meta.dir, "../../..");
const project = "apps/desktop-shell-e2e";

// Nx's graph and project payloads are subprocess output: this test reads only
// the parts it asserts on, so it parses only those and fails on anything else.
const projectGraphSchema = z.object({
  graph: z.object({
    dependencies: z.record(z.string(), z.array(z.object({ target: z.string() }))),
    nodes: z.record(z.string(), z.object({ data: z.object({ root: z.string() }) })),
  }),
});
const journeyTargetSchema = z.object({
  targets: z.object({
    "desktop-e2e": z.object({
      dependsOn: z.array(z.string()),
      options: z.object({ command: z.string() }),
    }),
  }),
});
const buildTargetSchema = z.object({ targets: z.object({ build: z.object({}) }) });
const manifestSchema = z.object({ scripts: z.object({ "test:e2e": z.string() }) });

// Nx runs as a subprocess of this test, so it receives the few ambient values
// it needs to find its toolchain rather than the whole host environment.
const forwardedEnvironment: readonly string[] = ["HOME", "PATH", "TMPDIR"];

async function nx(args: string[]): Promise<string> {
  const environment: Record<string, string> = { NX_DAEMON: "false", NX_TUI: "false" };
  for (const key of forwardedEnvironment) {
    const value = process.env[key];
    if (typeof value === "string") environment[key] = value;
  }
  const child = Bun.spawn(["bunx", "nx", ...args], {
    cwd: repository,
    env: environment,
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
      const { graph } = projectGraphSchema.parse(JSON.parse(await readFile(graphFile, "utf8")));

      expect(Object.keys(graph.nodes)).toContain("desktop-shell-e2e");
      expect(graph.nodes["desktop-shell-e2e"]?.data.root).toBe(project);
      expect(graph.dependencies["desktop-shell-e2e"]?.map(({ target }) => target)).toContain(
        "desktop-shell",
      );

      const { targets } = journeyTargetSchema.parse(
        JSON.parse(await nx(["show", "project", "desktop-shell-e2e", "--json"])),
      );
      const journey = targets["desktop-e2e"];
      expect(journey.dependsOn).toContain("desktop-shell:build");
      buildTargetSchema.parse(JSON.parse(await nx(["show", "project", "desktop-shell", "--json"])));

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

      const manifest = manifestSchema.parse(
        JSON.parse(await readFile(resolve(repository, project, "package.json"), "utf8")),
      );
      const configuration = captured(
        manifest.scripts["test:e2e"],
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
