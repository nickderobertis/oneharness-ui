import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { Lexer, Parser, Evaluator, data } from '@actions/expressions';
import { classification, matrix as validateMatrix, workflow as validateWorkflow, object, text, trigger } from './validation.mjs';
import { truthy } from '@actions/expressions/result';
export { truthy };

export const root = resolve(import.meta.dirname, '..');
export function workflows(directory = resolve(root, '.github/workflows')) {
  return Object.fromEntries(readdirSync(directory).filter(name => /\.ya?ml$/.test(name)).sort().map(name => [name, validateWorkflow(parse(readFileSync(resolve(directory, name), 'utf8')))]));
}
/** @param {unknown} value @returns {import('@actions/expressions').data.ExpressionData} */
function expressionData(value) {
  if (value === undefined || value === null) return new data.Null();
  if (typeof value === 'string') return new data.StringData(value);
  if (typeof value === 'boolean') return new data.BooleanData(value);
  if (typeof value === 'number') return new data.NumberData(value);
  if (Array.isArray(value)) return new data.Array(...value.map(expressionData));
  return new data.Dictionary(...Object.entries(value).map(([key, item]) => ({ key, value: expressionData(item) })));
}
/** @param {string | boolean | number} source @param {import('./contracts.js').Context} context */
export function evaluate(source, context) {
  const raw = String(source).trim().replace(/^\$\{\{([\s\S]*)\}\}$/, '$1');
  const functions = new Map(['always', 'success', 'failure', 'cancelled'].map(name => [name, {
    name, minArgs: 0, maxArgs: 0,
    call: () => new data.BooleanData(name === 'always' || (name === 'success' ? Object.values(context.needs ?? {}).every(n => n.result === 'success') : Object.values(context.needs ?? {}).some(n => n.result === name))),
  }]));
  const ast = new Parser(new Lexer(raw).lex().tokens, Object.keys(context), [...functions.values()]).parse();
  const resolved = expressionData(context);
  if (!(resolved instanceof data.Dictionary)) throw new Error('Expression context must be an object');
  return new Evaluator(ast, resolved, functions).evaluate();
}
/** @param {string | boolean | number} source @param {import('./contracts.js').Context} context */
export function interpolate(source, context) {
  return String(source).replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expr) => {
    const result = evaluate(expr, context);
    if (result.kind === data.Kind.Null) throw new Error(`Unresolved expression: ${expr}`);
    return result.coerceString();
  });
}
/** @param {import('./contracts.js').Matrix | string | undefined} matrix @param {import('./contracts.js').Context} [context] @returns {import('./contracts.js').MatrixRow[]} */
export function matrixRows(matrix, context = {}) {
  if (!matrix) return [{}];
  if (typeof matrix === 'string') {
    const parsed = evaluate(matrix, context);
    matrix = validateMatrix(expressionPlain(parsed));
  }
  matrix = validateMatrix(matrix);
  if (typeof matrix.include === 'string') matrix = validateMatrix({ ...matrix, include: expressionPlain(evaluate(matrix.include, context)) });
  /** @type {import('./contracts.js').MatrixRow[]} */
  let rows = [{}];
  for (const [key, values] of Object.entries(matrix)) {
    if (['include', 'exclude'].includes(key)) continue;
    if (!Array.isArray(values)) throw new Error(`Unresolved matrix axis: ${key}`);
    rows = rows.flatMap(row => values.map(value => { if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new Error(`Matrix axis ${key} must contain scalars`); return { ...row, [key]: value }; }));
  }
  rows = rows.filter(row => !(matrix.exclude ?? []).some(excluded => Object.entries(excluded).every(([key, value]) => row[key] === value)));
  const axes = Object.keys(matrix).filter(key => !['include', 'exclude'].includes(key));
  if (!axes.length) return Array.isArray(matrix.include) ? matrix.include : [{}];
  const originals = rows.map(row => ({ ...row }));
  for (const include of Array.isArray(matrix.include) ? matrix.include : []) {
    let added = false;
    rows = rows.map((row, index) => {
      if (axes.every(key => !(key in include) || originals[index]?.[key] === include[key])) { added = true; return { ...row, ...include }; }
      return row;
    });
    if (!added) rows.push(include);
  }
  return rows;
}
/** @param {import('./contracts.js').Workflow} workflow @param {import('./contracts.js').Scenario} scenario */
export function triggers(workflow, scenario) {
  const on = workflow.on;
  if (!on) return false;
  const config = typeof on === 'string' ? (on === scenario.event ? trigger({}, 'trigger') : undefined) : Array.isArray(on) ? (on.includes(scenario.event) ? trigger({}, 'trigger') : undefined) : on[scenario.event];
  if (config === undefined) return false;
  if (config?.paths || config?.['paths-ignore']) throw new Error('Unresolved path-filtered workflow trigger');
  if (config?.types && !config.types.includes(scenario.payload.action ?? '')) return false;
  if (scenario.event === 'push' && scenario.ref.startsWith('refs/tags/')) return Boolean(config?.tags?.some(tag => tag === '*' || scenario.ref.slice(10).startsWith(tag.replace('*', ''))));
  if (config?.branches && !config.branches.includes(scenario.event === 'pull_request' ? 'main' : scenario.ref.replace('refs/heads/', ''))) return false;
  if (scenario.event === 'workflow_run' && config?.workflows && !config.workflows.includes(scenario.payload.workflow_run?.name ?? '')) return false;
  return true;
}
/** @param {string} file @param {import('./contracts.js').Workflow} workflow @param {import('./contracts.js').Scenario} scenario @param {Record<string, import('./contracts.js').Workflow>} [graph] @param {string[]} [stack] @returns {import('./contracts.js').RunRow[]} */
export function resolveRun(file, workflow, scenario, graph = workflows(), stack = []) {
  if (stack.includes(file)) throw new Error(`Recursive workflow call: ${file}`);
  validateWorkflow(workflow);
  /** @type {import('./contracts.js').RunRow[]} */
  const rows = [];
  /** @type {Record<string, import('./contracts.js').JobResult>} */
  const results = {};
  const pending = new Map(Object.entries(workflow.jobs));
  while (pending.size) {
    let progress = false;
    for (const [id, job] of pending) {
      const needs = typeof job.needs === 'string' ? [job.needs] : job.needs ?? [];
      if (needs.some(need => pending.has(need))) continue;
      if (needs.some(need => !results[need])) throw new Error(`Missing job dependency: ${file}:${id}`);
      const context = { github: { event_name: scenario.event, ref: scenario.ref, repository: 'nickderobertis/oneharness-ui', base_ref: 'main', event: scenario.payload }, inputs: scenario.inputs ?? {}, needs: Object.fromEntries(needs.map(need => [need, results[need]])) };
      const implicit = !/\b(always|success|failure|cancelled)\s*\(/.test(job.if ?? '') && needs.some(need => results[need].result !== 'success');
      const active = !implicit && (job.if === undefined || truthy(evaluate(job.if, context)));
      results[id] = { result: active ? 'success' : 'skipped', outputs: active && id === 'macos-policy' ? policyOutputs(job, scenario) : active && id === 'select' ? { capture: 'true' } : {} };
      if (file === 'screencomp.yml' && id === 'arches' && active) results[id].outputs = screencompMatrix(job, context);
      for (const matrix of matrixRows(job.strategy?.matrix, context)) {
        const expanded = { ...context, matrix };
        const name = interpolate(job.name ?? id, expanded);
        if (job.uses) {
          let target;
          let called;
          if (job.uses.startsWith('./.github/workflows/')) {
            target = text(job.uses.split('/').at(-1), 'reusable workflow path'); called = graph[target];
          } else if (job.uses === 'nickderobertis/screencomp/.github/workflows/visual-docs-reusable.yml@4bacdb8b8ad407f775cfade4697bbe02de1d316f') {
            target = 'screencomp.yml'; called = reusableSnapshot(job.uses);
          } else throw new Error(`Unresolved reusable call: ${job.uses}`);
          if (!called) throw new Error(`Missing reusable workflow: ${target}`);
          const callTrigger = typeof called.on === 'object' && !Array.isArray(called.on) ? called.on?.workflow_call : undefined;
          const defaults = Object.fromEntries(Object.entries(callTrigger?.inputs ?? {}).map(([key, value]) => [key, value.default ?? (value.type === 'boolean' ? false : '')]));
          const nestedScenario = { ...scenario, inputs: { ...defaults, ...Object.fromEntries(Object.entries(job.with ?? {}).map(([k,v]) => [k, typeof v === 'string' ? interpolate(v, expanded) : v])) } };
          rows.push(...resolveRun(target, called, nestedScenario, graph, [...stack, file]).map(row => ({ ...row, active: active && row.active, call: `${file}:${id}` })));
          continue;
        }
        const runner = interpolate(text(job['runs-on'], 'job runner'), expanded);
        if (!/^(ubuntu|windows|macos)-[\w.-]+$/.test(runner)) throw new Error(`Unresolved runner: ${file}:${id}: ${runner}`);
        rows.push({ workflow: file, event: scenario.event, scenario: scenario.id, job: id, name, runner, target: String(matrix.platform ?? matrix.os ?? runner), active, macos: runner.startsWith('macos-'), call: undefined });
      }
      pending.delete(id); progress = true;
    }
    if (!progress) throw new Error(`Unresolved dependency graph: ${file}`);
  }
  return rows;
}
export function sourceDigest() {
  const hash = createHash('sha256');
  /** @param {string} directory */
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (['node_modules', '.telemetry', 'budgets.yaml'].includes(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path); else { hash.update(path.slice(root.length)); hash.update(readFileSync(path)); }
    }
  }
  walk(resolve(root, '.github'));
  for (const path of ['package.json', 'bun.lock', 'scripts/verify-macos-artifact.sh', 'screencomp.toml', 'scripts/release-assets.mjs', 'scripts/set-version.mjs', 'scripts/dispatch-release.sh', 'scripts/checkout-release.sh', 'scripts/upload-release.sh', 'justfile']) hash.update(readFileSync(resolve(root, path)));
  return hash.digest('hex');
}

/** @param {import('./contracts.js').Job} job @param {import('./contracts.js').Context} context */
function screencompMatrix(job, context) {
  const step = job.steps?.find(step => step.id === 'read');
  if (!step) throw new Error('Unresolved screencomp matrix producer');
  const shell = text(step.run, 'screencomp matrix producer shell'); const environment = object(step.env, 'screencomp matrix producer environment');
  for (const value of Object.values(environment)) text(value, 'producer environment expression', true);
  const directory = mkdtempSync(resolve(process.env.ONEPIPELINE_NODE_SCRATCH_DIR ?? root, 'screencomp-matrix-'));
  const output = resolve(directory, 'output');
  try {
    const env = { ...process.env, GITHUB_OUTPUT: output, ...Object.fromEntries(Object.entries(environment).map(([key, value]) => [key, interpolate(text(value, 'producer environment expression', true), context)])) };
    execFileSync('bash', ['-c', shell], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const matrix = readFileSync(output, 'utf8').trim().match(/^matrix=(.+)$/m)?.[1];
    if (!matrix) throw new Error('Unresolved screencomp matrix output');
    const parsed = validateMatrix(JSON.parse(matrix));
    if (!Array.isArray(parsed.include) || !parsed.include.length) throw new Error('screencomp matrix must contain nonempty include rows');
    const keys = new Set();
    for (const row of parsed.include) {
      object(row, 'screencomp matrix row');
      if (!['x86_64', 'arm64', 'aarch64'].includes(text(row.arch, 'screencomp architecture'))) throw new Error('Unsupported screencomp architecture');
      for (const value of Object.values(row)) text(value, 'screencomp matrix field', true);
      const key = `${row.project}/${row.arch}`; if (keys.has(key)) throw new Error('Duplicate screencomp architecture/project lane'); keys.add(key);
    }
    return Object.fromEntries(Object.entries(job.outputs ?? {}).map(([name, expression]) => [name, interpolate(expression, { steps: { [text(step.id, 'matrix producer step id')]: { outputs: { matrix } } } })]));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

/** @type {Map<string, Record<string, string>>} */
const adapterCache = new Map();
/** @param {import('./contracts.js').Job} job @param {import('./contracts.js').Scenario} scenario @returns {Record<string, string>} */
function policyOutputs(job, scenario) {
  classification(scenario.classification);
  const key = JSON.stringify([job.outputs, job.env, job.steps, scenario.event, scenario.payload, scenario.classification]);
  const cached = adapterCache.get(key);
  if (cached) return cached;
  const directory = mkdtempSync(resolve(process.env.ONEPIPELINE_NODE_SCRATCH_DIR ?? root, 'macos-adapter-'));
  const input = resolve(directory, 'event.json'); const output = resolve(directory, 'output');
  try {
    writeFileSync(input, JSON.stringify(scenario.payload));
    const step = job.steps?.find(step => step.id === 'classify');
    if (step?.run !== 'just classify-macos-coverage') throw new Error('Unresolved production classifier adapter');
    const context = { github: { event_name: scenario.event, event: scenario.payload } };
    const declaredEnv = Object.fromEntries(Object.entries({ ...job.env, ...step.env }).map(([key, expression]) => [key, interpolate(expression, context)]));
    execFileSync('just', ['classify-macos-coverage'], { cwd: root, env: { ...process.env, GITHUB_EVENT_NAME: scenario.event, GITHUB_EVENT_PATH: input, RUNNER_TEMP: directory, GITHUB_OUTPUT: output, ...declaredEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    const match = readFileSync(output, 'utf8').match(/^required=(true|false)\n$/);
    if (!match) throw new Error('Classifier adapter must emit exactly required=true or required=false');
    const outputs = { required: text(match[1], 'classifier routing flag') };
    if (outputs.required !== String(scenario.classification.macosRequired)) throw new Error('Production classifier routing disagrees with the subprocess scenario');
    const mapped = Object.fromEntries(Object.entries(job.outputs ?? {}).map(([name, expression]) => [name, interpolate(expression, { steps: { [text(step.id, 'classifier step id')]: { outputs } } })]));
    adapterCache.set(key, mapped); return mapped;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

/** @param {import('@actions/expressions').data.ExpressionData} value @returns {unknown} */
function expressionPlain(value) {
  if (value instanceof data.Dictionary) return Object.fromEntries(value.pairs().map(pair => [pair.key, expressionPlain(pair.value)]));
  if (value instanceof data.Array) return value.values().map(expressionPlain);
  if (value instanceof data.BooleanData || value instanceof data.NumberData || value instanceof data.StringData) return value.value;
  return null;
}

/** @param {string} uses @returns {import('./contracts.js').Workflow} */
function reusableSnapshot(uses) {
  const lock = object(JSON.parse(readFileSync(resolve(root, '.github/reusable-workflows/lock.json'), 'utf8')), 'reusable workflow lock');
  if (text(lock.uses, 'locked reusable call') !== uses) throw new Error('Reusable call differs from its source lock; refresh the pinned source and lock together');
  const annotated = readFileSync(resolve(root, '.github/reusable-workflows/screencomp.yml'), 'utf8');
  const source = annotated.slice(annotated.indexOf('\n') + 1);
  if (createHash('sha256').update(source).digest('hex') !== text(lock.sha256, 'upstream source digest')) throw new Error('Reusable snapshot differs from pinned upstream source; restore its exact bytes before resolving jobs');
  return validateWorkflow(parse(source));
}
