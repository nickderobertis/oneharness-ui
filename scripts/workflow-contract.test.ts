import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const root = resolve(import.meta.dir, "..");

// Branch protection requires these contexts by exact name on every pull request
// to main. Changing when a suite runs must never leave one unreported.
// llmlint: ignore-block[contracts_have_one_source_or_a_drift_gate] Branch protection lives in GitHub settings, which this credential-free test cannot read; the operator's governance verification (setup_github_governance.py --verify) is the drift gate that compares the live required checks with these names, and this list is the repository half it reconciles.
const requiredContexts = [
  "check (macos-15)",
  "check (windows-2025)",
  "check (ubuntu-24.04)",
  "supply-chain",
  "commitlint",
  "llmlint",
  "desktop-e2e (ubuntu-24.04)",
  "desktop-e2e (windows-2025)",
  "macos-native-smoke",
  "install (ubuntu-22.04-arm)",
] as const;
// llmlint: ignore-end[contracts_have_one_source_or_a_drift_gate]
const requiredContextNames: readonly string[] = requiredContexts;

// Workflow files are parsed only as far as these assertions read them.
const stepSchema = z.object({
  id: z.string().optional(),
  if: z.string().optional(),
  name: z.string().optional(),
  run: z.string().optional(),
  uses: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  with: z.record(z.string(), z.unknown()).optional(),
});
const jobSchema = z.object({
  if: z.string().optional(),
  name: z.string().optional(),
  needs: z.union([z.string(), z.array(z.string())]).optional(),
  outputs: z.record(z.string(), z.string()).optional(),
  permissions: z.record(z.string(), z.string()).optional(),
  "runs-on": z.string().optional(),
  steps: z.array(stepSchema).optional(),
  strategy: z
    .object({
      matrix: z.object({
        include: z.array(z.record(z.string(), z.string())).optional(),
        os: z.array(z.string()).optional(),
      }),
    })
    .optional(),
  uses: z.string().optional(),
  with: z.record(z.string(), z.unknown()).optional(),
});
const triggerSchema = z
  .object({
    branches: z.array(z.string()).optional(),
    paths: z.array(z.string()).optional(),
    "paths-ignore": z.array(z.string()).optional(),
    types: z.array(z.string()).optional(),
  })
  .nullable();
const workflowSchema = z.object({
  concurrency: z
    .object({ "cancel-in-progress": z.union([z.boolean(), z.string()]), group: z.string() })
    .optional(),
  jobs: z.record(z.string(), jobSchema),
  name: z.string(),
  on: z.record(z.string(), triggerSchema),
  permissions: z.record(z.string(), z.string()).optional(),
});
type Workflow = z.infer<typeof workflowSchema>;
type Job = z.infer<typeof jobSchema>;

const workflows = new Map<string, Workflow>(
  readdirSync(resolve(root, ".github/workflows"))
    .filter((file) => file.endsWith(".yml"))
    .map((file) => [
      file,
      workflowSchema.parse(
        Bun.YAML.parse(readFileSync(resolve(root, ".github/workflows", file), "utf8")),
      ),
    ]),
);

function workflow(file: string): Workflow {
  const value = workflows.get(file);
  if (!value) {
    throw new Error(`.github/workflows/${file} is missing; restore it or update this contract`);
  }
  return value;
}

function job(file: string, id: string): Job {
  const value = workflow(file).jobs[id];
  if (!value) {
    throw new Error(`${file} has no ${id} job; restore the job or update this contract's job id`);
  }
  return value;
}

// Workflow text quotes GitHub expressions literally; built this way so the
// source never reads as a mistyped JavaScript template.
const githubExpression = (body: string): string => `$${"{{"} ${body} }}`;

const needsOf = (value: Job): string[] =>
  value.needs === undefined ? [] : typeof value.needs === "string" ? [value.needs] : value.needs;

// --- A three-valued evaluator for the GitHub expression subset these workflows
// use. `undefined` means the value depends on something the event alone does not
// decide, so a condition proves a job runs only when it evaluates to `true`.
type Value = string | boolean | undefined;
type Context = {
  values: Record<string, string>;
  needs: Record<string, "success" | "failure" | "cancelled" | "skipped">;
};

function unsupported(detail: string): Error {
  return new Error(
    `${detail}; rewrite the workflow condition in the subset this evaluator reads, or extend the evaluator to cover it`,
  );
}

function tokenize(expression: string): string[] {
  const tokens = expression.match(/'[^']*'|==|!=|&&|\|\||[!()]|[A-Za-z_][\w.-]*/g) ?? [];
  if (tokens.join("") !== expression.replace(/\s+/g, "")) {
    throw unsupported(`unsupported expression syntax: ${expression}`);
  }
  return tokens;
}

function evaluate(raw: string | undefined, context: Context): Value {
  if (raw === undefined) return true;
  const expression = raw
    .trim()
    .replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, "$1")
    .trim();
  const tokens = tokenize(expression);
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const truthy = (value: Value): boolean | undefined =>
    value === undefined ? undefined : value !== false && value !== "";
  const or = (): Value => {
    let left = and();
    while (peek() === "||") {
      take();
      const right = and();
      const [l, r] = [truthy(left), truthy(right)];
      left = l === true || r === true ? true : l === false && r === false ? false : undefined;
    }
    return left;
  };
  const and = (): Value => {
    let left = comparison();
    while (peek() === "&&") {
      take();
      const right = comparison();
      const [l, r] = [truthy(left), truthy(right)];
      left = l === false || r === false ? false : l === true && r === true ? true : undefined;
    }
    return left;
  };
  const comparison = (): Value => {
    const left = unary();
    const operator = peek();
    if (operator !== "==" && operator !== "!=") return left;
    take();
    const right = unary();
    if (left === undefined || right === undefined) return undefined;
    return operator === "==" ? left === right : left !== right;
  };
  const unary = (): Value => {
    if (peek() === "!") {
      take();
      const value = truthy(unary());
      return value === undefined ? undefined : !value;
    }
    return primary();
  };
  const allNeeds = (result: string) =>
    Object.values(context.needs).every((value) => value === result);
  const primary = (): Value => {
    const token = take();
    if (token === undefined) throw unsupported(`incomplete expression: ${expression}`);
    if (token === "(") {
      const value = or();
      if (take() !== ")") throw unsupported(`unbalanced expression: ${expression}`);
      return value;
    }
    if (token.startsWith("'")) return token.slice(1, -1);
    if (peek() === "(") {
      take();
      if (take() !== ")") throw unsupported(`unsupported call arguments: ${expression}`);
      if (token === "always") return true;
      if (token === "cancelled") return Object.values(context.needs).includes("cancelled");
      if (token === "success") return allNeeds("success");
      if (token === "failure") return Object.values(context.needs).includes("failure");
      throw unsupported(`unsupported function ${token}() in: ${expression}`);
    }
    const needsOutput = token.match(/^needs\.([\w-]+)\.(result|outputs\.[\w-]+)$/);
    if (needsOutput?.[1] && needsOutput[2]) {
      const result = context.needs[needsOutput[1]];
      if (needsOutput[2] === "result") return result;
      return context.values[token];
    }
    return context.values[token];
  };
  const value = or();
  if (position !== tokens.length) throw unsupported(`trailing tokens in: ${expression}`);
  return value;
}

const statusFunction = /\b(always|success|failure|cancelled)\(\)/;

// GitHub's scheduler: without a status function a job also requires every needed
// job to have succeeded; with one, the condition alone decides.
function starts(value: Job, context: Context): Value {
  const condition = evaluate(value.if, context);
  if (value.if !== undefined && statusFunction.test(value.if)) return condition;
  const needsSucceeded = needsOf(value).every((name) => context.needs[name] === "success");
  if (!needsSucceeded) return false;
  return condition;
}

const pullRequest = (overrides: Record<string, string> = {}): Context => ({
  needs: {},
  values: {
    "github.base_ref": "main",
    "github.event.action": "synchronize",
    "github.event_name": "pull_request",
    ...overrides,
  },
});
const pushToMain: Context = {
  needs: {},
  values: { "github.event_name": "push", "github.ref": "refs/heads/main" },
};

function triggeredBy(file: string, event: "pull_request" | "push"): boolean {
  const triggers = workflow(file).on;
  if (!(event in triggers)) return false;
  const trigger = triggers[event];
  if (trigger?.paths || trigger?.["paths-ignore"]) return false;
  return trigger?.branches === undefined || trigger.branches.includes("main");
}

// A job runs on a pull request to main when its workflow triggers there and it
// starts whatever its needed jobs did, or every needed job itself runs.
function runsOnPullRequest(file: string, id: string, seen = new Set<string>()): boolean {
  if (!triggeredBy(file, "pull_request") || seen.has(id)) return false;
  seen.add(id);
  const value = job(file, id);
  const needs = needsOf(value);
  const results = ["success", "failure", "cancelled", "skipped"] as const;
  const regardless = results.every(
    (result) =>
      starts(value, {
        ...pullRequest(),
        needs: Object.fromEntries(needs.map((name) => [name, result])),
      }) === true,
  );
  if (regardless) return true;
  return (
    needs.every((name) => runsOnPullRequest(file, name, seen)) &&
    starts(value, {
      ...pullRequest(),
      needs: Object.fromEntries(needs.map((name) => [name, "success" as const])),
    }) === true
  );
}

function contextNames(id: string, value: Job): string[] {
  const template = value.name ?? id;
  const matrix = value.strategy?.matrix;
  if (!template.includes("${{")) return [template];
  const variants = matrix?.os?.map((os) => ({ os })) ?? matrix?.include ?? [];
  return variants.map((variant) =>
    template.replace(/\$\{\{\s*matrix\.([\w-]+)\s*\}\}/g, (_, key: string) => {
      const replacement = variant[key];
      if (replacement === undefined) {
        throw new Error(`${id} names matrix.${key}, which is unset; define it or fix the job name`);
      }
      return replacement;
    }),
  );
}

function stepsRunning(value: Job, pattern: RegExp) {
  return (value.steps ?? []).filter((step) => step.run !== undefined && pattern.test(step.run));
}

describe("required status-check contexts", () => {
  test("every fixed context is reported on every pull request to main", () => {
    const reported = new Map<string, string>();
    for (const [file, value] of workflows) {
      for (const [id, definition] of Object.entries(value.jobs)) {
        if (!runsOnPullRequest(file, id)) continue;
        for (const name of contextNames(id, definition)) reported.set(name, `${file}:${id}`);
      }
    }
    for (const context of requiredContexts) {
      expect({ context, reportedBy: reported.get(context) ?? null }).toEqual({
        context,
        reportedBy: expect.any(String),
      });
    }
  });

  test("the evaluator refuses a condition that would hide a context", () => {
    const hidden: Job = { if: "github.event_name == 'push'", name: "desktop-e2e" };
    expect(starts(hidden, pullRequest())).toBe(false);
    const afterSkipped: Job = { name: "install", needs: "full-check" };
    expect(starts(afterSkipped, { ...pullRequest(), needs: { "full-check": "skipped" } })).toBe(
      false,
    );
    const unknown: Job = { if: "needs.select.outputs.run == 'true'", name: "x" };
    expect(starts(unknown, pullRequest())).toBeUndefined();
  });

  test("no matrix job reporting a required context carries a job-level condition", () => {
    for (const [file, id] of [
      ["desktop-e2e.yml", "desktop-e2e"],
      ["desktop-e2e.yml", "macos-native-smoke"],
      ["check.yml", "supply-chain"],
    ] as const) {
      expect({ job: `${file}:${id}`, if: job(file, id).if ?? null }).toEqual({
        job: `${file}:${id}`,
        if: null,
      });
    }
  });

  test("the notignored review comment is its own workflow, outside every required context", () => {
    const notignored = workflow("notignored.yml");
    expect(Object.keys(notignored.on)).toEqual(["pull_request"]);
    expect(notignored.permissions).toEqual({ contents: "read", "pull-requests": "write" });
    const [id, suppressions] = Object.entries(notignored.jobs)[0] ?? [];
    expect(Object.keys(notignored.jobs)).toHaveLength(1);
    if (!id || !suppressions) {
      throw new Error("notignored.yml has no job; restore its suppressions job");
    }
    expect(suppressions.if).toBe(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    const steps = suppressions.steps ?? [];
    expect(steps[0]?.uses).toMatch(/^actions\/checkout@[0-9a-f]{40}$/);
    expect(steps[0]?.with?.["fetch-depth"]).toBe(0);
    expect(steps.some((step) => step.uses === "nickderobertis/notignored@v0")).toBe(true);
    for (const name of contextNames(id, suppressions)) {
      expect(requiredContextNames).not.toContain(name);
    }
  });
});

describe("release ordering", () => {
  const releasing = [...workflows].flatMap(([file, value]) =>
    Object.entries(value.jobs)
      .filter(([, definition]) => stepsRunning(definition, /\bjust publish-release\b/).length > 0)
      .map(([id]) => ({ file, id })),
  );

  test("exactly one job runs semantic-release, and it waits on the full-check sweep", () => {
    expect(releasing).toEqual([{ file: "check.yml", id: "version" }]);
    const version = job("check.yml", "version");
    expect(needsOf(version)).toContain("full-check");
    const sweep = job("check.yml", "full-check");
    expect(stepsRunning(sweep, /^just check$/m)).toHaveLength(1);
    expect(starts(sweep, pushToMain)).toBe(true);
  });

  test("the version job starts on main only after full-check succeeded for that commit", () => {
    const version = job("check.yml", "version");
    const outcomes = Object.fromEntries(
      (["success", "failure", "cancelled", "skipped"] as const).map((result) => [
        result,
        starts(version, { ...pushToMain, needs: { "full-check": result } }),
      ]),
    );
    expect(outcomes).toEqual({
      cancelled: false,
      failure: false,
      skipped: false,
      success: true,
    });
    expect(starts(version, { ...pullRequest(), needs: { "full-check": "success" } })).toBe(false);
  });

  test("a run on main is never cancelled mid-release, and pull-request runs still supersede", () => {
    const concurrency = workflow("check.yml").concurrency;
    const cancel = String(concurrency?.["cancel-in-progress"]);
    expect(evaluate(cancel, pushToMain)).toBe(false);
    expect(evaluate(cancel, pullRequest())).toBe(true);
  });

  test("the version job reconciles the artifact workflow with the built-in token", () => {
    const version = job("check.yml", "version");
    for (const recipe of ["seed-release", "publish-release", "dispatch-release"]) {
      const [step] = stepsRunning(version, new RegExp(`^just ${recipe}$`, "m"));
      expect(step?.env?.GH_TOKEN).toBe(githubExpression("github.token"));
    }
    expect(version.permissions?.actions).toBe("write");
    expect(version.permissions?.contents).toBe("write");
  });
});

const justRecipeSchema = z.object({
  body: z.array(z.array(z.union([z.string(), z.array(z.unknown())]))),
});
const justDumpSchema = z.object({ recipes: z.record(z.string(), justRecipeSchema) });

function justRecipes(): Record<string, string> {
  const dump = Bun.spawnSync(["just", "--dump", "--dump-format", "json"], { cwd: root });
  if (dump.exitCode !== 0) {
    throw new Error(
      `just --dump failed: ${dump.stderr.toString()}; fix the justfile so 'just --list' parses, or run 'just bootstrap' if just is missing`,
    );
  }
  const { recipes } = justDumpSchema.parse(JSON.parse(dump.stdout.toString()));
  return Object.fromEntries(
    Object.entries(recipes).map(([name, recipe]) => [
      name,
      recipe.body
        .map((line) => line.map((part) => (typeof part === "string" ? part : "{{…}}")).join(""))
        .join("\n"),
    ]),
  );
}

// The commands a recipe runs, following its nested `just <recipe>` calls.
function expand(recipes: Record<string, string>, name: string, seen = new Set<string>()): string {
  if (seen.has(name)) return "";
  seen.add(name);
  const body = recipes[name];
  if (body === undefined) {
    throw new Error(
      `the justfile has no ${name} recipe; restore it or fix the 'just ${name}' call`,
    );
  }
  const nested = [...body.matchAll(/\bjust ([a-z][\w-]*)/g)].map((match) => match[1] ?? "");
  return [body, ...nested.map((child) => expand(recipes, child, seen))].join("\n");
}

describe("gate tiers", () => {
  const recipes = justRecipes();
  const supplyChain = /cargo deny|cargo machete|bun audit/;

  test("supply-chain checks run only in the Linux supply-chain job, on pull requests and main", () => {
    for (const gate of ["check", "check-affected", "gate"]) {
      expect({ gate, supplyChain: supplyChain.test(expand(recipes, gate)) }).toEqual({
        gate,
        supplyChain: false,
      });
    }
    const audit = expand(recipes, "supply-chain");
    for (const tool of ["cargo deny", "cargo machete", "bun audit"]) expect(audit).toContain(tool);

    const jobRunningAudit = [...workflows].flatMap(([file, value]) =>
      Object.entries(value.jobs)
        .filter(([, definition]) => stepsRunning(definition, /\bjust supply-chain\b/).length > 0)
        .map(([id]) => `${file}:${id}`),
    );
    expect(jobRunningAudit).toEqual(["check.yml:supply-chain"]);
    const supplyChainJob = job("check.yml", "supply-chain");
    expect(supplyChainJob["runs-on"]).toMatch(/^ubuntu-/);
    expect(triggeredBy("check.yml", "pull_request")).toBe(true);
    expect(triggeredBy("check.yml", "push")).toBe(true);
    expect(starts(supplyChainJob, pullRequest())).toBe(true);
    expect(starts(supplyChainJob, pushToMain)).toBe(true);
  });

  test("pull requests run the affected tier from an explicit merge base", () => {
    expect(recipes["check-affected"]).toContain('--base="$NX_BASE" --head="$NX_HEAD"');
    const [step] = stepsRunning(job("check.yml", "check"), /just check-affected/);
    expect(step?.run).toContain('base="$(git merge-base HEAD "origin/$GITHUB_BASE_REF")"');
    expect(step?.run).toContain('NX_BASE="$base" NX_HEAD=HEAD just check-affected');
  });
});

describe("expensive suites run only when affected", () => {
  const selection = (value: Job, project: string) => {
    const index = (value.steps ?? []).findIndex(
      (step) =>
        step.id === "select" &&
        step.run?.includes(`just select-affected ${project} >> "$GITHUB_OUTPUT"`),
    );
    if (index < 0) {
      throw new Error(
        `no step with id 'select' runs 'just select-affected ${project}'; restore the selection step`,
      );
    }
    return { index, step: value.steps?.[index] };
  };

  test("the packaged desktop journey is skipped per step, so both contexts still report", () => {
    const desktop = job("desktop-e2e.yml", "desktop-e2e");
    expect(desktop.if).toBeUndefined();
    const { index, step } = selection(desktop, "desktop-shell-e2e");
    expect(step?.run).toContain('base="$(git merge-base HEAD "origin/$GITHUB_BASE_REF")"');
    expect(desktop.steps?.[0]?.with?.["fetch-depth"]).toBe(0);

    const later = (desktop.steps ?? []).slice(index + 1);
    const journeys = later.filter((candidate) => candidate.run?.includes("just test-desktop-e2e"));
    expect(journeys).toHaveLength(2);
    for (const candidate of later) {
      if (candidate.if === "failure()") continue;
      const label = candidate.name ?? candidate.uses ?? "unnamed step";
      for (const run of ["true", "false"]) {
        const context = pullRequest({ "runner.os": "Linux", "steps.select.outputs.run": run });
        const gated = evaluate(candidate.if, context);
        if (run === "false") expect({ label, runs: gated }).toEqual({ label, runs: false });
      }
    }
    for (const os of ["Linux", "Windows"]) {
      const selected = pullRequest({ "runner.os": os, "steps.select.outputs.run": "true" });
      expect(
        journeys.filter((candidate) => evaluate(candidate.if, selected) === true),
      ).toHaveLength(1);
    }
  });

  test("visual docs capture only when affected and still clean up a closed pull request", () => {
    const select = job("visual-docs.yml", "select");
    selection(select, "conversation-ui-visual");
    expect(select.permissions).toEqual({ contents: "read" });
    expect(select.outputs?.capture).toBe(githubExpression("steps.select.outputs.run"));
    const capture = job("visual-docs.yml", "visual-docs");
    expect(needsOf(capture)).toEqual(["select"]);

    const decide = (action: string, selected: string) => {
      const context = pullRequest({
        "github.event.action": action,
        "needs.select.outputs.capture": selected,
      });
      const selectResult = starts(select, context) === true ? "success" : "skipped";
      return starts(capture, { ...context, needs: { select: selectResult } });
    };
    expect(decide("synchronize", "true")).toBe(true);
    expect(decide("synchronize", "false")).toBe(false);
    expect(decide("closed", "")).toBe(true);
    expect(
      starts(capture, {
        needs: { select: "success" },
        // A push event carries no action, which GitHub reads as null.
        values: {
          ...pushToMain.values,
          "github.event.action": "",
          "needs.select.outputs.capture": "false",
        },
      }),
    ).toBe(false);
  });

  test("the visual project runs no capture from a gate target", () => {
    const project = z
      .object({ targets: z.record(z.string(), z.object({ command: z.string().optional() })) })
      .parse(
        JSON.parse(readFileSync(resolve(root, "apps/conversation-ui-visual/project.json"), "utf8")),
      );
    for (const target of ["format-check", "lint", "typecheck", "test"]) {
      expect({ target, command: project.targets[target]?.command ?? "" }).not.toEqual({
        target,
        command: expect.stringMatching(/verify-visual|capture\.sh|playwright/),
      });
    }
    expect(project.targets.visual?.command).toBe("./scripts/verify-visual.sh");
    expect(project.targets.test?.command).toBe("bun test scripts/visual-docs.test.ts");
  });
});
