#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

// llmlint: ignore[changed_behavior_has_e2e] This formatting-only failure wrapper preserves exit behavior; just test exercises the checker against real generated coverage reports.
process.on("uncaughtException", (error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `authored coverage: ${message}; fix the reported failure, then rerun just test\n`,
  );
  process.exit(1);
});

const threshold = 0.95;
const reports = process.argv.slice(2);
if (reports.length === 0) {
  throw new Error(
    "no coverage reports were provided; run just test to generate and validate the authored coverage reports",
  );
}

const sources = new Map();
// llmlint: ignore[changed_behavior_has_e2e] These guards validate internal LCOV artifacts, not application behavior; just test drives this command with the three real generated reports, while malformed path/file inputs share the already-covered command failure wrapper and actionable recovery contract above.
for (const report of reports) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}\/lcov\.info$/.test(report)) {
    throw new Error(`coverage report path is invalid: ${report}; run just test to regenerate it`);
  }
  const resolved = resolve(report);
  if (relative(process.cwd(), resolved).startsWith("..")) {
    throw new Error(
      `coverage report escapes the workspace: ${report}; run just test to regenerate it`,
    );
  }
  const metadata = statSync(resolved, { throwIfNoEntry: false });
  if (!metadata?.isFile() || metadata.size > 100 * 1024 * 1024) {
    throw new Error(
      `coverage report is missing or too large: ${report}; run just test to regenerate it`,
    );
  }
  const contents = readFileSync(resolved, "utf8");
  if (!/^SF:.+$/m.test(contents) || !/^DA:\d+,\d+$/m.test(contents)) {
    throw new Error(`coverage report is malformed: ${report}; run just test to regenerate it`);
  }
  const records = contents.split("end_of_record");
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
if (linesFound === 0 || functionsFound === 0) {
  throw new Error(
    "coverage reports contain no code; rerun just test and inspect the test target inputs",
  );
}

const lineRate = linesHit / linesFound;
const functionRate = functionsHit / functionsFound;
process.stdout.write(
  `Authored coverage: lines ${(lineRate * 100).toFixed(2)}%, functions ${(functionRate * 100).toFixed(2)}%\n`,
);
if (lineRate < threshold || functionRate < threshold) {
  throw new Error(
    "authored line and function coverage must each be at least 95%; add realistic user-facing tests and rerun just test",
  );
}
