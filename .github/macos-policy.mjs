import { readFileSync, realpathSync } from 'node:fs';
import { options } from './options.mjs';
import { fileURLToPath } from 'node:url';
import { diffClass } from './release-diff.mjs';
import { object, text } from './validation.mjs';

const events = new Set(['pull_request', 'push', 'release', 'workflow_run', 'repository_dispatch', 'schedule', 'workflow_dispatch', 'workflow_call']);
/** @param {{event_name?: unknown, pull_request?: unknown, repository?: unknown} | null | undefined} event @param {string} base @param {string} head */
export function classify(event, base, head) {
  const name = event?.event_name;
  const isPr = typeof name !== 'string' || !events.has(name) || name === 'pull_request';
  if (!isPr) return { isReleaseOnly: false, macosRequired: false, reason: 'Non-PR event: no automatic CI Mac lane' };
  const diff = diffClass(base, head);
  let authorized = false;
  try {
    const config = object(JSON.parse(readFileSync(new URL('./release-pr-policy.json', import.meta.url), 'utf8')), 'release PR policy');
    if (!Array.isArray(config.automation)) throw new Error('Invalid automation configuration');
    const pr = object(event?.pull_request, 'PR');
    const user = object(pr.user, 'PR author'); const branch = object(pr.head, 'PR head');
    const sameRepo = text(object(branch.repo, 'head repository').full_name, 'head repository name') === text(object(event?.repository, 'repository').full_name, 'repository name');
    authorized = config.automation.some(entry => {
      const rule = object(entry, 'automation identity/branch');
      return sameRepo && user.login === text(rule.login, 'automation login') && branch.ref === text(rule.branch, 'automation branch');
    });
  } catch { authorized = false; }
  const isReleaseOnly = name === 'pull_request' && authorized && diff === 'version-only';
  return { isReleaseOnly, macosRequired: !isReleaseOnly, reason: `PR diff: ${diff}; ${isReleaseOnly ? 'configured release automation authorizes omission' : 'Mac coverage required'}` };
}
/** @param {string} policyResult @param {string} macResult @param {string} required */
export function carrier(policyResult, macResult, required) {
  if (policyResult !== 'success' || !['true', 'false'].includes(required)) throw new Error('Mac classification failed, cancelled, or missing; retry classification');
  if (required === 'true' && macResult === 'success') return 'Mac assertions completed successfully';
  if (required === 'false' && macResult === 'skipped') return 'Classifier authorized omission; Mac assertions did not run';
  throw new Error(`Required Mac work is ${macResult || 'missing'}; inspect the Mac job and retry`);
}
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const [command, ...args] = process.argv.slice(2);
  try {
  if (command === 'classify') {
    const option = options(args, ['event', 'base', 'head']);
    let event;
    try { event = JSON.parse(readFileSync(option.event, 'utf8')); } catch { event = { event_name: process.env.GITHUB_EVENT_NAME ?? 'pull_request' }; }
    if (!event || typeof event !== 'object' || Array.isArray(event)) event = {};
    event.event_name = process.env.GITHUB_EVENT_NAME ?? event.event_name ?? 'pull_request';
    console.log(JSON.stringify(classify(event, option.base, option.head)));
  } else if (command === 'carrier') {
    const option = options(args, ['policy', 'mac', 'required']);
    try { console.log(carrier(option.policy, option.mac, option.required)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
  } else { console.error('Use classify --event PATH --base REF --head REF, or carrier --policy RESULT --mac RESULT --required BOOL'); process.exitCode = 2; }
  } catch (error) { console.error(`Mac policy: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
