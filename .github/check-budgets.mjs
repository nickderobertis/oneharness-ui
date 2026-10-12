import { check } from '@onebudgetspec/sdk';
const result = await check({ paths: ['.github/budgets.yaml'], cwd: new URL('..', import.meta.url).pathname });
for (const budget of result.results) console.log(`${budget.id}: ${budget.verdict} (${budget.actual})`);
if (result.results.some(result => result.verdict !== 'within')) process.exitCode = 1;
