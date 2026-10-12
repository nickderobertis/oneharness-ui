import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function classify(event) {
  // semantic-release publishes tags directly. No identity or release-PR branch
  // is configured here, so even a bot-authored version-only PR needs Mac proof.
  const macosRequired = event?.event_name === 'pull_request';
  return { isReleaseOnly: false, macosRequired, reason: macosRequired ? 'This repository releases directly from tags; every PR requires Mac coverage' : 'Non-PR event: no automatic CI Mac lane' };
}
export function carrier(policyResult, macResult, required) {
  if (policyResult !== 'success' || !['true', 'false'].includes(required)) throw new Error('Mac classification failed, cancelled, or missing; retry classification');
  if (required === 'true' && macResult === 'success') return 'Mac assertions completed successfully';
  if (required === 'false' && macResult === 'skipped') return 'Classifier authorized omission; Mac assertions did not run';
  throw new Error(`Required Mac work is ${macResult || 'missing'}; inspect the Mac job and retry`);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  const option = name => args[args.indexOf(`--${name}`) + 1];
  if (command === 'classify') {
    let event;
    try { event = JSON.parse(readFileSync(option('event'), 'utf8')); } catch { event = { event_name: process.env.GITHUB_EVENT_NAME ?? 'pull_request' }; }
    if (!event || typeof event !== 'object' || Array.isArray(event)) event = {};
    event.event_name = process.env.GITHUB_EVENT_NAME ?? event.event_name ?? 'pull_request';
    console.log(JSON.stringify(classify(event, option('base'), option('head'))));
  } else if (command === 'carrier') {
    try { console.log(carrier(option('policy'), option('mac'), option('required'))); } catch (error) { console.error(error.message); process.exitCode = 1; }
  } else { console.error('Use classify --event PATH --base REF --head REF, or carrier --policy RESULT --mac RESULT --required BOOL'); process.exitCode = 2; }
}
