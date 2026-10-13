import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { workflows, resolveRun, sourceDigest, matrixRows, evaluate, interpolate, truthy } from '../workflow-graph.mjs';

const root = resolve(import.meta.dirname, '../..');
const scratch = process.env.ONEPIPELINE_NODE_SCRATCH_DIR ?? tmpdir();
const policy = resolve(root, '.github/macos-policy.mjs');
const identity = { login: 'github-actions[bot]' };
const repo = 'nickderobertis/oneharness-ui';
function history() {
  const cwd = mkdtempSync(resolve(scratch, 'macos-history-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Policy journey');
  writeFileSync(resolve(cwd, 'package.json'), JSON.stringify({ version: '0.1.0', dependencies: { dependency: '1.0.0' } }));
  writeFileSync(resolve(cwd, 'source.ts'), 'export const value = 1;\n');
  writeFileSync(resolve(cwd, 'CHANGELOG.md'), '# History\n');
  git('add', '.'); git('commit', '-qm', 'ci: base'); const base = git('rev-parse', 'HEAD');
  const heads = {};
  for (const diff of ['source', 'version-only', 'dependency']) {
    git('checkout', '-q', base);
    if (diff === 'source') writeFileSync(resolve(cwd, 'source.ts'), 'export const value = 2;\n');
    else writeFileSync(resolve(cwd, 'package.json'), JSON.stringify({ version: '0.2.0', dependencies: { dependency: diff === 'dependency' ? '2.0.0' : '1.0.0' } }, null, 2));
    git('add', '.'); git('commit', '-qm', `ci: ${diff}`); heads[diff] = git('rev-parse', 'HEAD');
  }
  return { cwd, git, base, heads };
}
function classification(cwd, payload, base, head) {
  const event = resolve(cwd, 'event.json'); writeFileSync(event, JSON.stringify(payload));
  return JSON.parse(execFileSync(process.execPath, [policy, 'classify', '--event', event, '--base', base, '--head', head], { cwd, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: payload.event_name } }));
}
function pr(fork = false, bot = false) {
  return { repository: { full_name: repo }, action: 'synchronize', pull_request: { user: { login: bot ? identity.login : 'contributor', type: bot ? 'Bot' : 'User' }, title: 'chore(release): 0.2.0', base: { ref: 'main' }, head: { ref: bot ? 'release/v0.2.0' : 'feature', repo: { full_name: fork ? 'fork/oneharness-ui' : repo } } } };
}
const events = [
  ['pr-opened', 'pull_request', 'opened'], ['pr-synchronize', 'pull_request', 'synchronize'], ['pr-reopened', 'pull_request', 'reopened'],
  ['base-push', 'push'], ['release-pr-merge', 'push'], ['tag-push', 'push'], ['release-published', 'release', 'published'],
  ['downstream', 'workflow_run', 'completed'], ['repository-dispatch', 'repository_dispatch'], ['schedule', 'schedule'],
  ['manual-default', 'workflow_dispatch'], ['manual-opt-in', 'workflow_dispatch'],
];

test('classifier subprocess requires Mac for all PR identities/diffs and unreadable or fork input', () => {
  const h = history();
  try {
    for (const diff of Object.keys(h.heads)) for (const fork of [false, true]) for (const bot of [false, true]) {
      const result = classification(h.cwd, { ...pr(fork, bot), event_name: 'pull_request' }, h.base, h.heads[diff]);
      assert.equal(result.isReleaseOnly, false);
      assert.match(result.reason, new RegExp(`PR diff: ${diff === 'version-only' ? 'version-only' : diff === 'dependency' ? 'source-or-dependency' : 'unknown-or-source'}`));
      assert.equal(result.macosRequired, !result.isReleaseOnly);
    }
    for (const altered of [
      { ...pr(false, true), pull_request: { ...pr(false, true).pull_request, user: { login: 'attacker', type: 'User' } } },
      { ...pr(false, true), pull_request: { ...pr(false, true).pull_request, head: { ...pr(false, true).pull_request.head, ref: 'feature' } } },
      {},
    ]) assert.equal(classification(h.cwd, { ...altered, event_name: 'pull_request' }, h.base, h.heads['version-only']).macosRequired, true);
    assert.equal(classification(h.cwd, { ...pr(false, true), event_name: 'pull_request' }, 'unknown', h.heads['version-only']).macosRequired, true);
    writeFileSync(resolve(h.cwd, 'bad.json'), '{');
    const malformed = spawnSync(process.execPath, [policy, 'classify', '--event', resolve(h.cwd, 'bad.json'), '--base', h.base, '--head', h.heads['version-only']], { cwd: h.cwd, encoding: 'utf8' });
    assert.equal(JSON.parse(malformed.stdout).macosRequired, true);
    for (const [, event] of events.filter(([,event]) => event !== 'pull_request')) {
      assert.equal(classification(h.cwd, { event_name: event }, 'unknown', 'unknown').macosRequired, false);
    }
  } finally { rmSync(h.cwd, { recursive: true, force: true }); }
});

test('real carriers reject failure/cancellation/missing work and admit only classifier-authorized omission', () => {
  const jobs = Object.values(workflows()['check.yml'].jobs).filter(job => ['check (macos-15)', 'macos-native-smoke'].includes(job.name));
  assert.equal(jobs.length, 2);
  const environments = new Map(jobs.map(job => [JSON.stringify(job.steps.at(-1).env), job.steps.at(-1)]));
  for (const step of environments.values()) {
    assert.equal(step.run, 'just macos-proof-result');
    const run = (policyResult, mac, required) => {
      const context = { needs: { 'macos-policy': { result: policyResult, outputs: { required } }, 'macos-pr': { result: mac, outputs: {} } } };
      const env = Object.fromEntries(Object.entries(step.env).map(([key, value]) => [key, interpolate(value, context)]));
      return spawnSync('just', ['macos-proof-result'], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
    };
    for (const required of ['true', 'false', '', 'unknown']) for (const policyResult of ['success', 'failure', 'cancelled', 'skipped', '']) for (const mac of ['success', 'failure', 'cancelled', 'skipped', '']) {
      const result = run(policyResult, mac, required);
      const permitted = policyResult === 'success' && ((required === 'true' && mac === 'success') || (required === 'false' && mac === 'skipped'));
      assert.equal(result.status, permitted ? 0 : 1, `${policyResult}/${mac}/${required}: ${result.stderr}`);
      if (permitted && required === 'false') assert.match(result.stdout, /did not run/);
    }
  }
});

test('actual graph expands all event/diff/ownership routes, retains protected contexts, and records scheduling telemetry', () => {
  const graph = workflows(); const h = history(); const scenarios = []; const runs = [];
  // Protected names reconcile with the existing governance contract, rather than a second hand-maintained inventory.
  const source = readFileSync(resolve(root, 'scripts/workflow-contract.test.ts'), 'utf8');
  const required = [...source.match(/const requiredContexts = \[([\s\S]*?)\] as const;/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  try {
    for (const [eventClass, event, action] of events) for (const diff of Object.keys(h.heads)) for (const ownership of ['same-repo', 'fork']) for (const bot of [false, true]) {
      const prDocument = pr(ownership === 'fork', bot);
      prDocument.pull_request.base.sha = h.base; prDocument.pull_request.head.sha = h.heads[diff];
      const payload = { ...prDocument, event_name: event, action, workflow_run: { name: 'release', conclusion: 'success', head_sha: h.heads[diff] } };
      const scenario = { id: `${eventClass}/${diff}/${ownership}/${bot ? 'bot' : 'user'}`, event, payload, diff, ownership, bot, ref: eventClass === 'tag-push' ? 'refs/tags/v0.2.0' : event === 'pull_request' ? 'refs/pull/1/merge' : 'refs/heads/main', inputs: event === 'workflow_dispatch' ? { release_tag: 'v0.2.0', macos_diagnostic: eventClass === 'manual-opt-in' } : {}, classification: classification(h.cwd, payload, h.base, h.heads[diff]) };
      scenarios.push(scenario);
      const eventRuns = Object.entries(graph).filter(([, workflow]) => {
        // release dispatch is generated by semantic-release reconciliation, not a diagnostic fan-out.
        if (event === 'workflow_dispatch' && workflow.name === 'release') return false;
        return (triggers(workflow, scenario));
      }).map(([file, workflow]) => ({ scenario: scenario.id, workflow: file, rows: resolveRun(file, workflow, scenario, graph) }));
      runs.push(...eventRuns);
      if (event === 'pull_request') {
        const names = eventRuns.flatMap(run => run.rows.filter(row => row.active).map(row => row.name));
        for (const name of required) assert.equal(names.filter(value => value === name).length, 1, `${scenario.id} missing/duplicate ${name}`);
        const macs = eventRuns.flatMap(run => run.rows.filter(row => row.active && row.macos));
        assert.equal(macs.some(row => row.job === 'macos-pr'), scenario.classification.macosRequired);
        for (const name of ['check (macos-15)', 'macos-native-smoke']) {
          const row = eventRuns.flatMap(run => run.rows).find(row => row.name === name);
          assert.match(row.runner, /^ubuntu-/);
          const job = graph[row.workflow].jobs[row.job];
          assert.match(job.if, /always\(\)/); assert.deepEqual(job.needs, ['macos-policy', 'macos-pr']);
          assert.equal(job.steps.at(-1).run, 'just macos-proof-result');
        }
      }
      if (event !== 'pull_request' && eventClass !== 'manual-opt-in') assert.equal(eventRuns.some(run => run.rows.some(row => row.active && row.macos)), false, scenario.id);
    }
    // The production version job calls dispatch-release, whose exact-tag dispatch forms the release edge.
    assert.match(graph['check.yml'].jobs.version.steps.at(-1).run, /just dispatch-release/);
    const dispatchSource = readFileSync(resolve(root, 'scripts/dispatch-release.sh'), 'utf8');
    const dispatched = [...dispatchSource.matchAll(/gh workflow run ([^\s]+)/g)].map(match => match[1]);
    assert.ok(dispatched.length, 'The production artifact dispatch must resolve a workflow');
    for (const file of dispatched) assert.ok(graph[file], `Unresolved automatic workflow dispatch: ${file}`);
    const releaseScenario = { id: 'pre-publication-release', event: 'workflow_dispatch', payload: {}, ref: 'refs/heads/main', inputs: { release_tag: 'v0.2.0' }, classification: { macosRequired: false } };
    for (const file of dispatched) runs.push({ scenario: releaseScenario.id, workflow: file, rows: resolveRun(file, graph[file], releaseScenario, graph) });
    const release = graph['release.yml'];
    assert.equal(release.jobs.publish['runs-on'], 'ubuntu-24.04'); assert.equal(release.jobs.publish.needs, 'release'); assert.equal(release.jobs['verify-public-arm64'].needs, 'publish');
    for (const target of matrixRows(release.jobs.release.strategy.matrix)) {
      assert.ok(target.bundles.split(',').every(format => ['deb', 'appimage', 'app', 'dmg', 'msi', 'nsis'].includes(format)));
      assert.match(release.jobs.release.steps.find(step => step.run?.includes('checkout-release.sh')).run, /checkout-release/);
      assert.match(release.jobs.release.steps.find(step => step.run?.includes('just set-version')).run, /RELEASE_TAG#v/);
      const prepare = release.jobs.release.steps.find(step => step.run === 'just prepare-release-assets');
      assert.equal(interpolate(prepare.env.RELEASE_PLATFORM, { matrix: target }), target.platform);
      assert.equal(interpolate(prepare.env.RELEASE_ASSET_FORMATS, { matrix: target }), target.assets);
    }
    const mac = release.jobs.release.steps.find(step => step.name === 'Mount, install, and verify native application');
    assert.equal(mac.if, "runner.os == 'macOS'"); assert.match(mac.run, /verify-macos-artifact/);
    const verify = readFileSync(resolve(root, 'scripts/verify-macos-artifact.sh'), 'utf8');
    assert.match(verify, /hdiutil attach/); assert.match(verify, /INVALID_REQUEST/); assert.match(verify, /test -x.*Contents\/MacOS\/oneharness/);
    const verifierSource = release.jobs.release.steps.find(step => step.name === 'Load verification commands from the workflow revision');
    assert.equal(verifierSource.with.ref, '${{ github.workflow_sha }}');
    assert.ok(release.jobs.release.steps.indexOf(verifierSource) < release.jobs.release.steps.indexOf(mac));
    assert.ok(release.jobs.release.steps.indexOf(mac) < release.jobs.release.steps.findIndex(step => step.uses?.startsWith('actions/upload-artifact') && step.name.includes('Stage')));
    const lifecycles = scenarios.filter(s => s.event === 'pull_request' && s.payload.action === 'synchronize').map(s => {
      const lifecycleRuns = runs.filter(run => run.scenario === s.id || run.scenario === `base-push/${s.diff}/${s.ownership}/${s.bot ? 'bot' : 'user'}` || run.scenario === 'pre-publication-release' || run.scenario === 'release-pr-merge/version-only/same-repo/bot' || run.scenario === 'downstream/version-only/same-repo/bot' || run.scenario === 'tag-push/version-only/same-repo/bot' || run.scenario === 'release-published/version-only/same-repo/bot');
      return { id: s.id, runs: lifecycleRuns.filter(run => run.rows.some(row => row.active && row.macos)).map(run => ({ workflow: run.workflow, event: run.rows[0]?.event, scenario: run.scenario, jobs: run.rows.filter(row => row.active && row.macos) })) };
    });
    const telemetry = { schemaVersion: 1, sourceDigest: sourceDigest(), scenarios, runs, lifecycles, jobsPerRun: Math.max(...runs.map(run => run.rows.filter(row => row.active && row.macos).length)), runsPerChange: Math.max(...lifecycles.map(l => l.runs.length)) };
    mkdirSync(resolve(root, '.github/.telemetry'), { recursive: true }); writeFileSync(resolve(root, '.github/.telemetry/macos-policy.json'), `${JSON.stringify(telemetry, null, 2)}\n`);
  } finally { rmSync(h.cwd, { recursive: true, force: true }); }
});
import { triggers as triggers } from '../workflow-graph.mjs';

test('unsupported graph resolution fails loudly, including reusable calls and runner/matrix expressions', () => {
  const scenario = { id: 'test', event: 'pull_request', payload: {}, ref: 'refs/pull/1/merge', classification: { macosRequired: true } };
  assert.throws(() => resolveRun('bad.yml', { jobs: { bad: { 'runs-on': '${{ matrix.unknown }}' } } }, scenario, {}), /Unresolved/);
  assert.throws(() => resolveRun('bad.yml', { jobs: { bad: { uses: 'remote/repo/.github/workflows/test.yml@main' } } }, scenario, {}), /Unresolved reusable call/);
  assert.throws(() => evaluate('unsupported()', {}), /Unrecognized/);
  const graph = { 'child.yml': { jobs: { proof: { 'runs-on': 'macos-15' } } } };
  assert.equal(resolveRun('parent.yml', { jobs: { child: { uses: './.github/workflows/child.yml' } } }, scenario, graph)[0].macos, true);
  assert.deepEqual(matrixRows({ os: ['ubuntu-24.04', 'macos-15'], arch: ['arm64', 'x64'], exclude: [{ os: 'macos-15', arch: 'x64' }] }), [{ os: 'ubuntu-24.04', arch: 'arm64' }, { os: 'ubuntu-24.04', arch: 'x64' }, { os: 'macos-15', arch: 'arm64' }]);
  assert.equal(truthy(evaluate("always() && needs.mac.result == 'failure'", { needs: { mac: { result: 'failure' } } })), true);
});
