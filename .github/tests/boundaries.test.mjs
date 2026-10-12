import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { workflows, resolveRun, sourceDigest, root } from '../workflow-graph.mjs';

test('routing and output adapter subprocesses validate unknown event names and their document/write boundaries', () => {
  const scratch = mkdtempSync(resolve(process.env.ONEPIPELINE_NODE_SCRATCH_DIR ?? tmpdir(), 'policy-boundary-'));
  try {
    const event = resolve(scratch, 'event.json'); const output = resolve(scratch, 'output');
    for (const name of ['', 12, 'unrecognized']) {
      writeFileSync(event, JSON.stringify({ event_name: name }));
      const result = JSON.parse(execFileSync(process.execPath, [resolve(root, '.github/macos-policy.mjs'), 'classify', '--event', event, '--base', 'bad', '--head', 'bad'], { encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: '' } }));
      assert.equal(result.macosRequired, true);
    }
    const missingFlag = spawnSync(process.execPath, [resolve(root, '.github/macos-policy.mjs'), 'carrier', 'false', '--policy', 'success', '--mac', 'skipped'], { encoding: 'utf8' });
    assert.equal(missingFlag.status, 1);
    assert.match(missingFlag.stderr, /Unexpected argument|Missing --required/);
    const adapter = resolve(root, '.github/record-policy-output.mjs');
    for (const bad of [null, [], { macosRequired: true }, { isReleaseOnly: false, macosRequired: 'true', reason: 'untrusted' }]) {
      writeFileSync(event, JSON.stringify(bad));
      assert.notEqual(spawnSync(process.execPath, [adapter, event], { env: { ...process.env, GITHUB_OUTPUT: output } }).status, 0);
    }
    writeFileSync(event, JSON.stringify({ isReleaseOnly: false, macosRequired: true, reason: 'PR requires Mac' }));
    assert.notEqual(spawnSync(process.execPath, [adapter, event], { env: { ...process.env, GITHUB_OUTPUT: '' } }).status, 0);
    execFileSync(process.execPath, [adapter, event], { env: { ...process.env, GITHUB_OUTPUT: output } });
    assert.equal(readFileSync(output, 'utf8'), 'required=true\n');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('real workflow resolution rejects malformed YAML shapes, adapter drift and invalid producer architectures', () => {
  const scratch = mkdtempSync(resolve(process.env.ONEPIPELINE_NODE_SCRATCH_DIR ?? tmpdir(), 'workflow-boundary-'));
  const scenario = { id: 'boundary', event: 'pull_request', ref: 'refs/pull/1/merge', payload: { action: 'opened', pull_request: { base: { sha: 'HEAD' }, head: { sha: 'HEAD' } } }, classification: { isReleaseOnly: false, macosRequired: true, reason: 'PR requires Mac' } };
  try {
    writeFileSync(resolve(scratch, 'bad.yml'), 'on: pull_request\njobs: nope\n');
    assert.throws(() => workflows(scratch), /workflow jobs must be an object/);
    for (const field of ['strategy', 'outputs', 'with']) {
      writeFileSync(resolve(scratch, 'bad.yml'), `on: pull_request\njobs:\n  proof:\n    runs-on: ubuntu-24.04\n    ${field}: false\n`);
      assert.throws(() => workflows(scratch), /must be an object/);
    }
    writeFileSync(resolve(scratch, 'bad.yml'), 'on:\n  workflow_dispatch:\n    inputs: false\njobs:\n  proof:\n    runs-on: ubuntu-24.04\n');
    assert.throws(() => workflows(scratch), /must be an object/);
    writeFileSync(resolve(scratch, 'bad.yml'), 'on: pull_request\njobs:\n  proof:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo proof\n        env: false\n');
    assert.throws(() => workflows(scratch), /must be an object/);
    for (const [field, value, expected] of [['name', '12', /string/], ['if', 'false', /string/], ['with', 'false', /object/]]) {
      writeFileSync(resolve(scratch, 'bad.yml'), `on: pull_request\njobs:\n  proof:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo proof\n        ${field}: ${value}\n`);
      assert.throws(() => workflows(scratch), expected);
    }
    const graph = workflows(); const actual = structuredClone(graph['check.yml']);
    actual.jobs['macos-policy'].outputs.required = '${{ steps.classify.outputs.missing }}';
    assert.throws(() => resolveRun('check.yml', actual, scenario, graph), /Unresolved expression/);
    const reusable = parse(readFileSync(resolve(root, '.github/reusable-workflows/screencomp.yml'), 'utf8'));
    const defaults = Object.fromEntries(Object.entries(reusable.on.workflow_call.inputs).map(([key, input]) => [key, input.default ?? '']));
    reusable.jobs.arches.outputs.matrix = '${{ steps.read.outputs.missing }}';
    assert.throws(() => resolveRun('screencomp.yml', reusable, { ...scenario, inputs: defaults }, graph), /Unresolved expression.*steps.read.outputs.missing/);
    const call = graph['visual-docs.yml'].jobs['visual-docs'].uses;
    for (const arches of ['["unsupported"]', '["x86_64","x86_64"]']) {
      const parent = { jobs: { producer: { uses: call, with: { arches, 'capture-command': 'true' } } } };
      assert.throws(() => resolveRun('parent.yml', parent, scenario, graph), /Unsupported screencomp architecture|Duplicate screencomp/);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('reusable calls enforce declared input names, required values and types through the real loader', () => {
  const scratch = mkdtempSync(resolve(process.env.ONEPIPELINE_NODE_SCRATCH_DIR ?? tmpdir(), 'reusable-inputs-'));
  const scenario = { id: 'inputs', event: 'pull_request', ref: 'refs/pull/1/merge', payload: {}, classification: { isReleaseOnly: false, macosRequired: true, reason: 'PR requires Mac' } };
  try {
    writeFileSync(resolve(scratch, 'child.yml'), 'on:\n  workflow_call:\n    inputs:\n      enabled:\n        type: boolean\n        required: true\njobs:\n  proof:\n    if: inputs.enabled\n    runs-on: ubuntu-24.04\n');
    for (const [supplied, expected] of [['enabled: true', true], ['enabled: false', false], ['unknown: true', /Unknown reusable input/], ['', /Missing required reusable input/], ['enabled: "true"', /Invalid reusable input type/]]) {
      writeFileSync(resolve(scratch, 'parent.yml'), `on: pull_request\njobs:\n  call:\n    uses: ./.github/workflows/child.yml\n${supplied ? `    with:\n      ${supplied}\n` : ''}`);
      const graph = workflows(scratch);
      const run = () => resolveRun('parent.yml', graph['parent.yml'], scenario, graph);
      if (typeof expected === 'boolean') assert.equal(run()[0].active, expected);
      else assert.throws(run, expected);
    }
    writeFileSync(resolve(scratch, 'child.yml'), readFileSync(resolve(scratch, 'child.yml'), 'utf8').replace('required: true', 'required: "true"'));
    assert.throws(() => workflows(scratch), /required must be boolean/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('reporting subprocess rejects negative metrics and malformed recorded rows without rerunning scenarios', () => {
  const scratch = mkdtempSync(resolve(process.env.ONEPIPELINE_NODE_SCRATCH_DIR ?? tmpdir(), 'telemetry-boundary-'));
  try {
    const event = resolve(scratch, 'event.json');
    const payload = { event_name: 'pull_request', action: 'opened', pull_request: { base: { sha: 'HEAD' }, head: { sha: 'HEAD' } } };
    writeFileSync(event, JSON.stringify(payload));
    const classification = JSON.parse(execFileSync(process.execPath, [resolve(root, '.github/macos-policy.mjs'), 'classify', '--event', event, '--base', 'HEAD', '--head', 'HEAD'], { encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request' } }));
    const scenario = { id: 'reporting-boundary', event: 'pull_request', ref: 'refs/pull/1/merge', payload, classification };
    const graph = workflows();
    const rows = resolveRun('check.yml', graph['check.yml'], scenario, graph);
    const jobs = rows.filter(row => row.active && row.macos);
    const runs = [{ workflow: 'check.yml', scenario: scenario.id, rows }];
    const lifecycles = [{ id: scenario.id, runs: jobs.length ? [{ workflow: 'check.yml', event: scenario.event, scenario: scenario.id, jobs }] : [] }];
    const recorded = { schemaVersion: 1, sourceDigest: sourceDigest(), scenarios: [scenario], runs, lifecycles, jobsPerRun: jobs.length, runsPerChange: lifecycles[0].runs.length };
    const file = resolve(scratch, 'recorded.json');
    for (const mutate of [value => { value.jobsPerRun = -1; }, value => { value.runs[0].rows[0].active = 'true'; }, value => { value.scenarios[0].classification.reason = null; }]) {
      const bad = structuredClone(recorded); mutate(bad); writeFileSync(file, JSON.stringify(bad));
      const result = spawnSync(process.execPath, [resolve(root, '.github/macos-budget.mjs'), '--metric', 'jobs-per-run', '--telemetry', file], { encoding: 'utf8' });
      assert.equal(result.status, 1); assert.match(result.stderr, /nonnegative integer|boolean active|classifier reason/);
    }
    writeFileSync(file, JSON.stringify(recorded));
    const output = resolve(scratch, 'result.json');
    execFileSync(process.execPath, [resolve(root, '.github/macos-budget.mjs'), '--metric', 'jobs-per-run', '--telemetry', file], { env: { ...process.env, ONEBUDGETSPEC_RESULT: output } });
    const result = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(result.value, recorded.jobsPerRun);
    assert.match(result.detail, /workflow/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});


test('the production verifier JSON command identifies parsing and field failures without logging response payloads', () => {
  const shell = readFileSync(resolve(root, 'scripts/verify-macos-artifact.sh'), 'utf8');
  const code = shell.match(/node -e '([^']+)' "\$response"/)[1];
  for (const [response, expected] of [
    ['{"ok":false,"error":{"code":"INVALID_REQUEST"}}', null],
    ['{"ok":', /bridge JSON parsing failed/],
    ['{"private":"do-not-log-this" "ok":false}', /bridge JSON parsing failed: invalid JSON syntax at position 29 \(line 1 column 30\)/],
    ['{"ok":true,"private":"do-not-log-this"}', /ok must be false/],
    ['{"ok":false,"error":{"code":"do-not-log-this"}}', /error.code must be INVALID_REQUEST/],
  ]) {
    const result = spawnSync(process.execPath, ['-e', code, response], { encoding: 'utf8' });
    assert.equal(result.status, expected ? 1 : 0);
    if (expected) assert.match(result.stderr, expected);
    assert.doesNotMatch(result.stderr, /do-not-log-this/);
  }
});
