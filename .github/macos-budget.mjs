import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { report } from '@onebudgetspec/sdk';
import { sourceDigest, root } from './workflow-graph.mjs';
const args = process.argv.slice(2);
const option = name => args[args.indexOf(`--${name}`) + 1];
try {
  const metric = option('metric');
  if (!['jobs-per-run', 'runs-per-change'].includes(metric)) throw new Error('Select --metric jobs-per-run or runs-per-change');
  const file = option('telemetry');
  if (!file) throw new Error('Supply --telemetry .github/.telemetry/macos-policy.json');
  const telemetry = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  if (telemetry.schemaVersion !== 1 || telemetry.sourceDigest !== sourceDigest()) throw new Error('Missing or stale workflow telemetry; rerun github-workflows:test');
  const value = metric === 'jobs-per-run' ? telemetry.jobsPerRun : telemetry.runsPerChange;
  if (!Number.isInteger(value) || !Array.isArray(telemetry.scenarios) || !Array.isArray(telemetry.runs) || !Array.isArray(telemetry.lifecycles)) throw new Error('Invalid scheduling telemetry; rerun github-workflows:test');
  const detail = JSON.stringify(metric === 'jobs-per-run' ? telemetry.runs.map(run => ({ workflow: run.workflow, scenario: run.scenario, jobs: run.rows.filter(row => row.active && row.macos) })) : telemetry.lifecycles);
  report(value, detail);
  console.log(JSON.stringify({ metric, value, detail: JSON.parse(detail) }));
} catch (error) { console.error(`macOS budget: ${error.message}`); process.exitCode = 1; }
