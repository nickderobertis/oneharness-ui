import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
for (const directory of [import.meta.dirname, resolve(import.meta.dirname, 'tests')]) {
  for (const file of readdirSync(directory).filter(file => file.endsWith('.mjs'))) execFileSync(process.execPath, ['--check', resolve(directory, file)], { stdio: 'inherit' });
}
