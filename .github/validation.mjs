/** @param {unknown} value @param {string} site @returns {Record<string, unknown>} */
export function object(value, site) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${site} must be an object; restore the declared contract and retry`);
  return /** @type {Record<string, unknown>} */ (value);
}
/** @param {unknown} value @param {string} site @param {boolean} [empty] */
export function text(value, site, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim())) throw new Error(`${site} must be a ${empty ? '' : 'nonempty '}string; restore the declared contract and retry`);
  return value;
}
/** @param {unknown} value @param {string} site */
function boolean(value, site) { if (typeof value !== 'boolean') throw new Error(`${site} must be boolean`); return value; }
/** @param {unknown} value @param {string} site */
export function scalar(value, site) {
  if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  throw new Error(`${site} must be a finite scalar`);
}
/** @template T @param {unknown} value @param {string} site @param {(value: unknown, site: string) => T} parse */
function optional(value, site, parse) { return value === undefined ? undefined : parse(value, site); }
/** @template T @param {unknown} value @param {string} site @param {(value: unknown, site: string) => T} parse */
function array(value, site, parse) {
  if (!Array.isArray(value)) throw new Error(`${site} must be an array`);
  return value.map((entry, index) => parse(entry, `${site}[${index}]`));
}
/** @template T @param {unknown} value @param {string} site @param {(value: unknown, site: string) => T} parse @returns {Record<string, T>} */
function record(value, site, parse) {
  /** @type {Record<string, T>} */
  const result = {};
  for (const [key, entry] of Object.entries(object(value, site))) result[key] = parse(entry, `${site}.${key}`);
  return result;
}
/** @param {unknown} value */
export function classification(value) {
  const document = object(value, 'classifier result');
  return { ...document, isReleaseOnly: boolean(document.isReleaseOnly, 'isReleaseOnly'), macosRequired: boolean(document.macosRequired, 'macosRequired'), reason: text(document.reason, 'classifier reason') };
}
/** @param {unknown} value */
export function matrix(value) {
  const document = object(value, 'matrix');
  /** @type {Record<string, ReturnType<typeof scalar>[]>} */
  const axes = {};
  for (const [key, entries] of Object.entries(document)) if (!['include', 'exclude'].includes(key)) axes[key] = array(entries, `matrix.${key}`, scalar);
  return {
    ...axes,
    include: optional(document.include, 'matrix.include', (value, site) => typeof value === 'string' ? text(value, site) : array(value, site, (row, site) => record(row, site, scalar))),
    exclude: optional(document.exclude, 'matrix.exclude', (value, site) => array(value, site, (row, site) => record(row, site, scalar))),
  };
}
/** @param {unknown} value @param {string} site */
function step(value, site) {
  const document = object(value, site);
  return { ...document, name: optional(document.name, `${site}.name`, text), if: optional(document.if, `${site}.if`, text), with: optional(document.with, `${site}.with`, (value, site) => record(value, site, scalar)), id: optional(document.id, `${site}.id`, text), run: optional(document.run, `${site}.run`, text), uses: optional(document.uses, `${site}.uses`, text), env: optional(document.env, `${site}.env`, (value, site) => record(value, site, (value, site) => text(value, site, true))) };
}
/** @param {unknown} value @param {string} site */
export function job(value, site) {
  const document = object(value, site);
  if (document.uses === undefined && document['runs-on'] === undefined) throw new Error(`${site} must declare a runner or reusable call`);
  return {
    ...document,
    name: optional(document.name, `${site}.name`, text), if: optional(document.if, `${site}.if`, text),
    uses: optional(document.uses, `${site}.uses`, text), 'runs-on': optional(document['runs-on'], `${site}.runs-on`, text),
    needs: optional(document.needs, `${site}.needs`, (value, site) => typeof value === 'string' ? text(value, site) : array(value, site, text)),
    strategy: optional(document.strategy, `${site}.strategy`, (value, site) => { const strategy = object(value, site); return { ...strategy, matrix: optional(strategy.matrix, `${site}.matrix`, value => typeof value === 'string' ? text(value, site) : matrix(value)) }; }),
    env: optional(document.env, `${site}.env`, (value, site) => record(value, site, (value, site) => text(value, site, true))),
    steps: optional(document.steps, `${site}.steps`, (value, site) => array(value, site, step)),
    outputs: optional(document.outputs, `${site}.outputs`, (value, site) => record(value, site, text)),
    with: optional(document.with, `${site}.with`, (value, site) => record(value, site, scalar)),
  };
}
/** @param {unknown} value @param {string} site */
function input(value, site) {
  const document = object(value, site); const type = document.type;
  if (type !== 'string' && type !== 'boolean' && type !== 'number') throw new Error(`Unsupported input type: ${site}`);
  const defaultValue = optional(document.default, `${site}.default`, scalar);
  if (defaultValue !== undefined && typeof defaultValue !== type) throw new Error(`${site} has an invalid default`);
  return { ...document, type, required: optional(document.required, `${site}.required`, boolean), default: defaultValue };
}
/** @param {unknown} value @param {string} site */
export function trigger(value, site) {
  if (value === null) return null;
  const document = object(value, site);
  const strings = (/** @type {unknown} */ value, /** @type {string} */ site) => array(value, site, text);
  return { ...document, branches: optional(document.branches, `${site}.branches`, strings), paths: optional(document.paths, `${site}.paths`, strings), 'paths-ignore': optional(document['paths-ignore'], `${site}.paths-ignore`, strings), types: optional(document.types, `${site}.types`, strings), tags: optional(document.tags, `${site}.tags`, strings), workflows: optional(document.workflows, `${site}.workflows`, strings), inputs: optional(document.inputs, `${site}.inputs`, (value, site) => record(value, site, input)) };
}
/** @param {unknown} value */
export function workflow(value) {
  const document = object(value, 'workflow');
  return { ...document, name: optional(document.name, 'workflow name', text), jobs: record(document.jobs, 'workflow jobs', job), on: optional(document.on, 'workflow triggers', (value, site) => typeof value === 'string' ? text(value, site) : Array.isArray(value) ? array(value, site, text) : record(value, site, trigger)) };
}
/** @param {unknown} value @param {string} site */
function payload(value, site) {
  const document = object(value, site);
  return { ...document, action: optional(document.action, `${site}.action`, text), workflow_run: optional(document.workflow_run, `${site}.workflow_run`, (value, site) => { const run = object(value, site); return { ...run, name: optional(run.name, `${site}.name`, text) }; }) };
}
/** @param {unknown} value @param {string} site */
export function scenario(value, site) {
  const document = object(value, site);
  return { ...document, id: text(document.id, `${site}.id`), event: text(document.event, `${site}.event`), ref: text(document.ref, `${site}.ref`), payload: payload(document.payload, `${site}.payload`), inputs: optional(document.inputs, `${site}.inputs`, (value, site) => record(value, site, scalar)), classification: classification(document.classification) };
}
/** @param {unknown} value @param {string} site */
export function runRow(value, site) {
  const document = object(value, site); const runner = text(document.runner, `${site}.runner`); const macos = boolean(document.macos, `${site}.macos`);
  if (!/^(ubuntu|windows|macos)-[\w.-]+$/.test(runner) || macos !== runner.startsWith('macos-')) throw new Error(`${site} has an inconsistent runner`);
  return { ...document, workflow: text(document.workflow, `${site}.workflow`), event: text(document.event, `${site}.event`), scenario: text(document.scenario, `${site}.scenario`), job: text(document.job, `${site}.job`), name: text(document.name, `${site}.name`), runner, target: text(document.target, `${site}.target`), active: boolean(document.active, 'boolean active flag'), macos, call: optional(document.call, `${site}.call`, text) };
}
/** @param {unknown} value @param {string} site */
export function workflowRun(value, site) {
  const document = object(value, site);
  return { ...document, workflow: text(document.workflow, `${site}.workflow`), scenario: text(document.scenario, `${site}.scenario`), rows: array(document.rows, `${site}.rows`, runRow) };
}
/** @param {unknown} value @param {string} site */
export function lifecycleRun(value, site) {
  const document = object(value, site);
  return { ...document, workflow: text(document.workflow, `${site}.workflow`), event: text(document.event, `${site}.event`), scenario: text(document.scenario, `${site}.scenario`), jobs: array(document.jobs, `${site}.jobs`, runRow) };
}
/** @param {unknown} value @param {string} site */
function count(value, site) { if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`${site} must be a nonnegative integer`); return value; }
/** @param {unknown} value */
export function telemetry(value) {
  const document = object(value, 'telemetry');
  if (document.schemaVersion !== 1) throw new Error('Unsupported telemetry schema; rerun github-workflows:test');
  const checked = { ...document, schemaVersion: document.schemaVersion, sourceDigest: text(document.sourceDigest, 'telemetry source digest'), scenarios: array(document.scenarios, 'scenarios', scenario), runs: array(document.runs, 'runs', workflowRun), lifecycles: array(document.lifecycles, 'lifecycles', (value, site) => { const entry = object(value, site); return { ...entry, id: text(entry.id, `${site}.id`), runs: array(entry.runs, `${site}.runs`, lifecycleRun) }; }), jobsPerRun: count(document.jobsPerRun, 'jobsPerRun'), runsPerChange: count(document.runsPerChange, 'runsPerChange') };
  if (!checked.runs.length || !checked.lifecycles.length) throw new Error('Telemetry workload is empty; rerun github-workflows:test');
  if (checked.jobsPerRun !== Math.max(...checked.runs.map(run => run.rows.filter(row => row.active && row.macos).length)) || checked.runsPerChange !== Math.max(...checked.lifecycles.map(lifecycle => lifecycle.runs.length))) throw new Error('Telemetry metrics disagree with their recorded rows; rerun github-workflows:test');
  return checked;
}
