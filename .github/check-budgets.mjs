import { fileURLToPath } from 'node:url';
import { check } from '@onebudgetspec/sdk';
const result = await check({ paths: ['.github/budgets.yaml'], cwd: fileURLToPath(new URL('..', import.meta.url)) });
for (const budget of result.results.filter(budget => budget.verdict !== 'within')) console.error(`${budget.id}: ${budget.verdict} (${budget.actual}); inspect the telemetry and fix workflow routing before retrying`);
if (result.results.some(result => result.verdict !== 'within')) process.exitCode = 1;
