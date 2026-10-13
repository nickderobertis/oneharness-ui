import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { workflows, matrixRows, root } from '../workflow-graph.mjs';

test('release matrix retains every production asset format, architecture and built app bundle', () => {
  const source = readFileSync(resolve(root, 'scripts/release-assets.mjs'), 'utf8');
  const literal = source.match(/const platformFormats = (\{[\s\S]*?\n\});/)[1];
  const formats = JSON.parse(JSON.stringify(runInNewContext(`(${literal})`)));
  const release = workflows()['release.yml'];
  const rows = matrixRows(release.jobs.release.strategy.matrix);
  assert.deepEqual(rows.map(row => row.platform).sort(), Object.keys(formats).sort());
  for (const row of rows) {
    assert.deepEqual(row.assets.split(',').sort(), formats[row.platform].sort());
    assert.ok(row.assets.split(',').every(format => row.bundles.split(',').includes(format)));
    if (row.platform.startsWith('macos-')) assert.ok(row.bundles.split(',').includes('app'));
  }
  const checkout = readFileSync(resolve(root, 'scripts/checkout-release.sh'), 'utf8');
  assert.match(checkout, /merge-base --is-ancestor "\$TAG\^\{commit\}" origin\/main/);
  assert.match(checkout, /checkout --quiet --detach "\$TAG\^\{commit\}"/);
  const upload = release.jobs.publish.steps.find(step => step.uses?.startsWith('actions/download-artifact'));
  assert.equal(upload.with.pattern, 'release-*-${{ inputs.release_tag }}');
  assert.equal(upload.with['merge-multiple'], true);
  assert.equal(upload.with['run-id'], undefined, 'Artifact consumption must stay in this exact workflow run');
  const dispatch = readFileSync(resolve(root, 'scripts/dispatch-release.sh'), 'utf8');
  assert.match(dispatch, /workflow run release.yml --ref main --field "release_tag=\$TAG"/);
  assert.doesNotMatch(dispatch, /macos_diagnostic/);
  // Compare real canonical preparation across all declared targets; content is preserved,
  // while only the host-native packaging journey can prove executable compatibility.
  execFileSync('bun', ['test', 'scripts/release-assets.test.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
});

test('budget reporter refuses stale or missing input', () => {
  const scratch = mkdtempSync(resolve(process.env.ONEPIPELINE_NODE_SCRATCH_DIR ?? tmpdir(), 'macos-budget-'));
  try {
    const script = resolve(root, '.github/macos-budget.mjs');
    assert.throws(() => execFileSync(process.execPath, [script, '--metric', 'jobs-per-run', '--telemetry', resolve(scratch, 'missing.json')], { stdio: ['ignore', 'pipe', 'pipe'] }), /Command failed/);
    writeFileSync(resolve(scratch, 'stale.json'), JSON.stringify({ schemaVersion: 1, sourceDigest: 'stale' }));
    assert.throws(() => execFileSync(process.execPath, [script, '--metric', 'runs-per-change', '--telemetry', resolve(scratch, 'stale.json')], { stdio: ['ignore', 'pipe', 'pipe'] }), /stale workflow telemetry/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('the pinned reusable snapshot is the exact upstream source used for scheduling resolution', () => {
  const lock = JSON.parse(readFileSync(resolve(root, '.github/reusable-workflows/lock.json'), 'utf8'));
  const source = readFileSync(resolve(root, '.github/reusable-workflows/screencomp.yml'), 'utf8').split('\n').slice(1).join('\n');
  assert.equal(createHash('sha256').update(source).digest('hex'), lock.sha256);
  assert.equal(workflows()['visual-docs.yml'].jobs['visual-docs'].uses, lock.uses);
});
