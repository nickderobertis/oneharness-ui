import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { Lexer, Parser, Evaluator, data } from '@actions/expressions';
import { truthy } from '@actions/expressions/result';
export { truthy };

export const root = resolve(import.meta.dirname, '..');
export function workflows(directory = resolve(root, '.github/workflows')) {
  return Object.fromEntries(readdirSync(directory).filter(name => /\.ya?ml$/.test(name)).sort().map(name => [name, parse(readFileSync(resolve(directory, name), 'utf8'))]));
}
function expressionData(value) {
  if (value === undefined || value === null) return new data.Null();
  if (typeof value === 'string') return new data.StringData(value);
  if (typeof value === 'boolean') return new data.BooleanData(value);
  if (typeof value === 'number') return new data.NumberData(value);
  if (Array.isArray(value)) return new data.Array(...value.map(expressionData));
  return new data.Dictionary(...Object.entries(value).map(([key, item]) => ({ key, value: expressionData(item) })));
}
export function evaluate(source, context) {
  const raw = String(source).trim().replace(/^\$\{\{([\s\S]*)\}\}$/, '$1');
  const functions = new Map(['always', 'success', 'failure', 'cancelled'].map(name => [name, {
    name, minArgs: 0, maxArgs: 0,
    call: () => new data.BooleanData(name === 'always' || (name === 'success' ? Object.values(context.needs ?? {}).every(n => n.result === 'success') : Object.values(context.needs ?? {}).some(n => n.result === name))),
  }]));
  const ast = new Parser(new Lexer(raw).lex().tokens, Object.keys(context), [...functions.values()]).parse();
  return new Evaluator(ast, expressionData(context), functions).evaluate();
}
export function interpolate(source, context) {
  return String(source).replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expr) => {
    const result = evaluate(expr, context);
    if (result.kind === data.Kind.Null) throw new Error(`Unresolved expression: ${expr}`);
    return result.coerceString();
  });
}
export function matrixRows(matrix, context = {}) {
  if (!matrix) return [{}];
  if (typeof matrix === 'string') {
    const parsed = evaluate(matrix, context);
    matrix = JSON.parse(parsed.coerceString());
  }
  if (typeof matrix.include === 'string') matrix = { ...matrix, include: evaluate(matrix.include, context).values().map(row => Object.fromEntries(row.pairs().map(pair => [pair.key, pair.value.coerceString()]))) };
  let rows = [{}];
  for (const [key, values] of Object.entries(matrix)) {
    if (['include', 'exclude'].includes(key)) continue;
    if (!Array.isArray(values)) throw new Error(`Unresolved matrix axis: ${key}`);
    rows = rows.flatMap(row => values.map(value => ({ ...row, [key]: value })));
  }
  rows = rows.filter(row => !(matrix.exclude ?? []).some(excluded => Object.entries(excluded).every(([key, value]) => row[key] === value)));
  const axes = Object.keys(matrix).filter(key => !['include', 'exclude'].includes(key));
  if (!axes.length) return matrix.include ?? [{}];
  const originals = rows.map(row => ({ ...row }));
  for (const include of matrix.include ?? []) {
    let added = false;
    rows = rows.map((row, index) => {
      if (axes.every(key => !(key in include) || originals[index]?.[key] === include[key])) { added = true; return { ...row, ...include }; }
      return row;
    });
    if (!added) rows.push(include);
  }
  return rows;
}
export function triggers(workflow, scenario) {
  const on = workflow.on;
  const config = typeof on === 'string' ? (on === scenario.event ? {} : undefined) : Array.isArray(on) ? (on.includes(scenario.event) ? {} : undefined) : on[scenario.event];
  if (config === undefined) return false;
  if (config?.paths || config?.['paths-ignore']) throw new Error('Unresolved path-filtered workflow trigger');
  if (config?.types && !config.types.includes(scenario.payload.action)) return false;
  if (scenario.event === 'push' && scenario.ref.startsWith('refs/tags/')) return Boolean(config?.tags?.some(tag => tag === '*' || scenario.ref.slice(10).startsWith(tag.replace('*', ''))));
  if (config?.branches && !config.branches.includes(scenario.event === 'pull_request' ? 'main' : scenario.ref.replace('refs/heads/', ''))) return false;
  if (scenario.event === 'workflow_run' && config?.workflows && !config.workflows.includes(scenario.payload.workflow_run?.name)) return false;
  return true;
}
export function resolveRun(file, workflow, scenario, graph = workflows(), stack = []) {
  if (stack.includes(file)) throw new Error(`Recursive workflow call: ${file}`);
  const rows = []; const results = {};
  const pending = new Map(Object.entries(workflow.jobs));
  while (pending.size) {
    let progress = false;
    for (const [id, job] of pending) {
      const needs = job.needs ? [].concat(job.needs) : [];
      if (needs.some(need => pending.has(need))) continue;
      if (needs.some(need => !results[need])) throw new Error(`Missing job dependency: ${file}:${id}`);
      const context = { github: { event_name: scenario.event, ref: scenario.ref, repository: 'nickderobertis/oneharness-ui', base_ref: 'main', event: scenario.payload }, inputs: scenario.inputs ?? {}, needs: Object.fromEntries(needs.map(need => [need, results[need]])) };
      const implicit = !/\b(always|success|failure|cancelled)\s*\(/.test(job.if ?? '') && needs.some(need => results[need].result !== 'success');
      const active = !implicit && (job.if === undefined || truthy(evaluate(job.if, context)));
      results[id] = { result: active ? 'success' : 'skipped', outputs: id === 'macos-policy' ? { required: String(scenario.classification.macosRequired) } : id === 'select' ? { capture: 'true' } : {} };
      if (file === 'screencomp.yml' && id === 'arches' && active) results[id].outputs = screencompMatrix(job, context);
      for (const matrix of matrixRows(job.strategy?.matrix, context)) {
        const expanded = { ...context, matrix };
        const name = interpolate(job.name ?? id, expanded);
        if (job.uses) {
          let target;
          let called;
          if (job.uses.startsWith('./.github/workflows/')) {
            target = job.uses.split('/').at(-1); called = graph[target];
          } else if (job.uses === 'nickderobertis/screencomp/.github/workflows/visual-docs-reusable.yml@4bacdb8b8ad407f775cfade4697bbe02de1d316f') {
            target = 'screencomp.yml'; called = parse(readFileSync(resolve(root, '.github/reusable-workflows/screencomp.yml'), 'utf8'));
          } else throw new Error(`Unresolved reusable call: ${job.uses}`);
          if (!called) throw new Error(`Missing reusable workflow: ${target}`);
          const defaults = Object.fromEntries(Object.entries(called.on?.workflow_call?.inputs ?? {}).map(([key, value]) => [key, value.default ?? (value.type === 'boolean' ? false : '')]));
          const nestedScenario = { ...scenario, inputs: { ...defaults, ...Object.fromEntries(Object.entries(job.with ?? {}).map(([k,v]) => [k, typeof v === 'string' ? interpolate(v, expanded) : v])) } };
          rows.push(...resolveRun(target, called, nestedScenario, graph, [...stack, file]).map(row => ({ ...row, active: active && row.active, call: `${file}:${id}` })));
          continue;
        }
        const runner = interpolate(job['runs-on'], expanded);
        if (!/^(ubuntu|windows|macos)-[\w.-]+$/.test(runner)) throw new Error(`Unresolved runner: ${file}:${id}: ${runner}`);
        rows.push({ workflow: file, event: scenario.event, scenario: scenario.id, job: id, name, runner, target: matrix.platform ?? matrix.os ?? runner, active, macos: runner.startsWith('macos-') });
      }
      pending.delete(id); progress = true;
    }
    if (!progress) throw new Error(`Unresolved dependency graph: ${file}`);
  }
  return rows;
}
export function sourceDigest() {
  const hash = createHash('sha256');
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (['node_modules', '.telemetry'].includes(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path); else { hash.update(path.slice(root.length)); hash.update(readFileSync(path)); }
    }
  }
  walk(resolve(root, '.github'));
  for (const path of ['screencomp.toml', 'scripts/release-assets.mjs', 'scripts/set-version.mjs', 'scripts/dispatch-release.sh', 'scripts/checkout-release.sh', 'scripts/upload-release.sh', 'justfile']) hash.update(readFileSync(resolve(root, path)));
  return hash.digest('hex');
}

function screencompMatrix(job, context) {
  const step = job.steps.find(step => step.id === 'read');
  if (!step?.run || !step.env) throw new Error('Unresolved screencomp matrix producer');
  const directory = mkdtempSync(resolve(process.env.ONEPIPELINE_NODE_SCRATCH_DIR ?? root, 'screencomp-matrix-'));
  const output = resolve(directory, 'output');
  try {
    const env = { ...process.env, GITHUB_OUTPUT: output, ...Object.fromEntries(Object.entries(step.env).map(([key, value]) => [key, interpolate(value, context)])) };
    execFileSync('bash', ['-c', step.run], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const matrix = readFileSync(output, 'utf8').trim().match(/^matrix=(.+)$/m)?.[1];
    if (!matrix) throw new Error('Unresolved screencomp matrix output');
    return { matrix };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
