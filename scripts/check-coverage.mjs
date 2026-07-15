#!/usr/bin/env node
import { readFileSync } from "node:fs";

const threshold = 0.95;
const reports = process.argv.slice(2);
if (reports.length === 0) throw new Error("usage: scripts/check-coverage.mjs <lcov.info> [...]");

const sources = new Map();
for (const report of reports) {
  const records = readFileSync(report, "utf8").split("end_of_record");
  for (const record of records) {
    const source = record.match(/^SF:(.+)$/m)?.[1];
    if (!source) continue;
    const current = sources.get(source) ?? { functionsFound: 0, functionsHit: 0, lines: new Map() };
    for (const match of record.matchAll(/^DA:(\d+),(\d+)/gm)) {
      const line = Number(match[1]);
      const hits = Number(match[2]);
      current.lines.set(line, Math.max(current.lines.get(line) ?? 0, hits));
    }
    current.functionsFound = Math.max(
      current.functionsFound,
      Number(record.match(/^FNF:(\d+)$/m)?.[1] ?? 0),
    );
    current.functionsHit = Math.max(
      current.functionsHit,
      Number(record.match(/^FNH:(\d+)$/m)?.[1] ?? 0),
    );
    sources.set(source, current);
  }
}

let linesFound = 0;
let linesHit = 0;
let functionsFound = 0;
let functionsHit = 0;
for (const source of sources.values()) {
  linesFound += source.lines.size;
  linesHit += [...source.lines.values()].filter((hits) => hits > 0).length;
  functionsFound += source.functionsFound;
  functionsHit += source.functionsHit;
}
if (linesFound === 0 || functionsFound === 0) throw new Error("coverage reports contain no code");

const lineRate = linesHit / linesFound;
const functionRate = functionsHit / functionsFound;
process.stdout.write(
  `Authored coverage: lines ${(lineRate * 100).toFixed(2)}%, functions ${(functionRate * 100).toFixed(2)}%\n`,
);
if (lineRate < threshold || functionRate < threshold) {
  throw new Error("authored line and function coverage must each be at least 95%");
}
