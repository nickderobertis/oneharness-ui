#!/usr/bin/env bun
// Decides whether an expensive suite runs: prints `run=true` when the change
// between NX_BASE and NX_HEAD reaches the named Nx project, `run=false` when the
// graph does not connect them. CI appends the line to $GITHUB_OUTPUT and gates
// the suite's steps on it.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";

const root = resolve(import.meta.dirname, "..");
const fail = (message, status = 2) => {
  console.error(`affected selection: ${message}`);
  process.exit(status);
};

const project = process.argv[2] ?? "";
if (!/^[a-z][a-z0-9-]{0,63}$/.test(project)) {
  fail("pass the Nx project name to select, for example 'desktop-shell-e2e'");
}
const base = process.env.NX_BASE ?? "";
const head = process.env.NX_HEAD ?? "";
if (!/^[0-9a-f]{40}$/.test(base) || !/^([0-9a-f]{40}|HEAD)$/.test(head)) {
  fail("NX_BASE must be a commit SHA and NX_HEAD must be a commit SHA or HEAD");
}

// A push that creates the branch reports an all-zero `before`, and a force push
// can name a commit the checkout lacks. Neither gives a base to diff from, so
// the suite runs rather than being skipped on a guess.
const baseKnown =
  !/^0{40}$/.test(base) &&
  spawnSync("git", ["cat-file", "-e", `${base}^{commit}`], { cwd: root, stdio: "ignore" })
    .status === 0;
if (!baseKnown) {
  process.stdout.write("run=true\n");
  process.exit(0);
}

// CI runs this under Bun, so `bun x nx` resolves the workspace's pinned Nx on
// every runner OS without a shell.
const nx = spawnSync(
  process.execPath,
  ["x", "nx", "show", "projects", "--affected", `--base=${base}`, `--head=${head}`, "--json"],
  {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NX_DAEMON: "false", NX_TUI: "false" },
  },
);
if (nx.status !== 0) {
  fail(
    `nx could not list the affected projects (exit ${nx.status ?? "signal"}); run 'bun x nx show projects --affected --base=${base} --head=${head}' to see its diagnostic`,
    1,
  );
}
const parsed = z.array(z.string()).safeParse(
  (() => {
    try {
      return JSON.parse(nx.stdout);
    } catch {
      return null;
    }
  })(),
);
if (!parsed.success) {
  fail("nx printed something other than a JSON list of project names; check the pinned Nx", 1);
}
process.stdout.write(`run=${parsed.data.includes(project)}\n`);
