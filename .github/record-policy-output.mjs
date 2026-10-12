import { appendFileSync, readFileSync } from 'node:fs';
import { classification, text } from './validation.mjs';
const result = classification(JSON.parse(readFileSync(text(process.argv[2], 'classifier result path'), 'utf8')));
if (typeof result.macosRequired !== 'boolean') throw new Error('Classifier omitted macosRequired; retry classification');
appendFileSync(text(process.env.GITHUB_OUTPUT, 'GITHUB_OUTPUT destination'), `required=${result.macosRequired}\n`);
console.log(result.reason);
