import { appendFileSync, readFileSync } from 'node:fs';
const result = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (typeof result.macosRequired !== 'boolean') throw new Error('Classifier omitted macosRequired; retry classification');
appendFileSync(process.env.GITHUB_OUTPUT, `required=${result.macosRequired}\n`);
console.log(result.reason);
