import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { object, telemetry as validateTelemetry } from './validation.mjs';
import { options } from './options.mjs';
import { report } from '@onebudgetspec/sdk';
import { sourceDigest, root } from './workflow-graph.mjs';
const args = process.argv.slice(2);
try {
  const option = options(args, ['metric', 'telemetry']);
  const metric = option.metric;
  if (!['jobs-per-run', 'runs-per-change'].includes(metric)) throw new Error('Select --metric jobs-per-run or runs-per-change');
  const file = option.telemetry;
  if (!file) throw new Error('Supply --telemetry .github/.telemetry/macos-policy.json');
  const document = object(JSON.parse(readFileSync(resolve(root, file), 'utf8')), 'telemetry');
  if (document.schemaVersion !== 1 || document.sourceDigest !== sourceDigest()) throw new Error('Missing or stale workflow telemetry; rerun github-workflows:test');
  const telemetry = validateTelemetry(document);
  const value = metric === 'jobs-per-run' ? telemetry.jobsPerRun : telemetry.runsPerChange;
  if (!Number.isInteger(value) || !Array.isArray(telemetry.scenarios) || !Array.isArray(telemetry.runs) || !Array.isArray(telemetry.lifecycles)) throw new Error('Invalid scheduling telemetry; rerun github-workflows:test');
  const detail = JSON.stringify(metric === 'jobs-per-run' ? telemetry.runs.map(run => ({ workflow: run.workflow, scenario: run.scenario, jobs: run.rows.filter(row => row.active && row.macos) })) : telemetry.lifecycles);
  report(value, detail);
} catch (error) { console.error(`macOS budget: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
